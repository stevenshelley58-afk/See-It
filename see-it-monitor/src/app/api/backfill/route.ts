/**
 * Backfill API - Import historical sessions from GCS into database
 * This imports sessions that were saved to GCS before the database migration
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { sessions, shops, analyticsEvents } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { listSessions, deriveSessionsFromAnalytics } from '@/lib/gcs';

// Simple auth - require a secret token
const BACKFILL_SECRET = process.env.BACKFILL_SECRET || process.env.MIGRATE_SECRET || 'change-me-in-production';

export async function POST(request: NextRequest) {
  try {
    // Check auth token
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || request.nextUrl.searchParams.get('token');
    
    if (token !== BACKFILL_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized. Provide ?token=<BACKFILL_SECRET> or Authorization: Bearer <BACKFILL_SECRET>' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const daysBack = body.daysBack ?? 7; // Default: last 7 days
    const maxSessions = body.maxSessions ?? 1000; // Default: max 1000 sessions
    const source = body.source || 'both'; // 'gcs', 'analytics', or 'both'

    const results = {
      gcsSessions: { found: 0, imported: 0, skipped: 0, errors: 0 },
      analyticsSessions: { found: 0, imported: 0, skipped: 0, errors: 0 },
      shops: { created: 0, existing: 0 },
    };

    // Import from GCS meta.json files
    if (source === 'gcs' || source === 'both') {
      try {
        const gcsSessions = await listSessions({ limit: maxSessions, offset: 0 });
        results.gcsSessions.found = gcsSessions.length;

        for (const gcsSession of gcsSessions) {
          try {
            // Check if session already exists
            const existing = await db
              .select()
              .from(sessions)
              .where(eq(sessions.sessionId, gcsSession.sessionId))
              .limit(1);

            if (existing.length > 0) {
              results.gcsSessions.skipped++;
              continue;
            }

            // Get or create shop
            let shop = await db
              .select()
              .from(shops)
              .where(eq(shops.domain, gcsSession.shop))
              .limit(1)
              .then(r => r[0]);

            if (!shop) {
              const [newShop] = await db.insert(shops).values({
                domain: gcsSession.shop,
                installedAt: new Date(),
              }).returning();
              shop = newShop;
              results.shops.created++;
            } else {
              results.shops.existing++;
            }

            // Map GCS status to database status
            let status = 'in_progress';
            if (gcsSession.status === 'complete') status = 'completed';
            else if (gcsSession.status === 'failed') status = 'error';
            else if (gcsSession.status === 'abandoned') status = 'abandoned';

            // Import session
            await db.insert(sessions).values({
              sessionId: gcsSession.sessionId,
              shopId: shop.id,
              shopDomain: gcsSession.shop,
              productTitle: gcsSession.productTitle || null,
              status,
              startedAt: new Date(gcsSession.startedAt),
              updatedAt: new Date(gcsSession.updatedAt),
              endedAt: gcsSession.status === 'complete' || gcsSession.status === 'failed' 
                ? new Date(gcsSession.updatedAt) 
                : null,
              currentStep: gcsSession.currentStep || null,
              stepsCompleted: gcsSession.stepsCompleted || 0,
              deviceType: gcsSession.device || null,
              browser: gcsSession.browser || null,
            });

            results.gcsSessions.imported++;
          } catch (error) {
            console.error(`[Backfill] Failed to import GCS session ${gcsSession.sessionId}:`, error);
            results.gcsSessions.errors++;
          }
        }
      } catch (error) {
        console.error('[Backfill] Failed to list GCS sessions:', error);
        results.gcsSessions.errors++;
      }
    }

    // Import from analytics events
    if (source === 'analytics' || source === 'both') {
      try {
        const lookbackMs = daysBack * 24 * 60 * 60 * 1000;
        const derived = await deriveSessionsFromAnalytics({ lookbackMs, maxFilesTotal: 500 });
        results.analyticsSessions.found = derived.sessions.length;

        for (const analyticsSession of derived.sessions) {
          try {
            // Check if session already exists
            const existing = await db
              .select()
              .from(sessions)
              .where(eq(sessions.sessionId, analyticsSession.sessionId))
              .limit(1);

            if (existing.length > 0) {
              results.analyticsSessions.skipped++;
              continue;
            }

            // Get or create shop
            let shop = await db
              .select()
              .from(shops)
              .where(eq(shops.domain, analyticsSession.shopDomain))
              .limit(1)
              .then(r => r[0]);

            if (!shop) {
              const [newShop] = await db.insert(shops).values({
                domain: analyticsSession.shopDomain,
                installedAt: new Date(),
              }).returning();
              shop = newShop;
              results.shops.created++;
            } else {
              results.shops.existing++;
            }

            // Import session
            await db.insert(sessions).values({
              sessionId: analyticsSession.sessionId,
              shopId: shop.id,
              shopDomain: analyticsSession.shopDomain,
              productTitle: analyticsSession.productTitle || null,
              status: analyticsSession.status,
              startedAt: new Date(analyticsSession.startedAt),
              updatedAt: new Date(analyticsSession.updatedAt),
              endedAt: analyticsSession.endedAt ? new Date(analyticsSession.endedAt) : null,
              currentStep: analyticsSession.currentStep || null,
              stepsCompleted: analyticsSession.stepsCompleted || 0,
              deviceType: analyticsSession.deviceType || null,
              browser: analyticsSession.browser || null,
            });

            results.analyticsSessions.imported++;
          } catch (error) {
            console.error(`[Backfill] Failed to import analytics session ${analyticsSession.sessionId}:`, error);
            results.analyticsSessions.errors++;
          }
        }
      } catch (error) {
        console.error('[Backfill] Failed to derive sessions from analytics:', error);
        results.analyticsSessions.errors++;
      }
    }

    const totalImported = results.gcsSessions.imported + results.analyticsSessions.imported;
    const totalSkipped = results.gcsSessions.skipped + results.analyticsSessions.skipped;
    const totalErrors = results.gcsSessions.errors + results.analyticsSessions.errors;

    return NextResponse.json({
      success: totalErrors === 0,
      message: `Backfill completed: ${totalImported} sessions imported, ${totalSkipped} skipped, ${totalErrors} errors`,
      results,
      summary: {
        totalImported,
        totalSkipped,
        totalErrors,
        shopsCreated: results.shops.created,
        shopsExisting: results.shops.existing,
      },
    });
  } catch (error) {
    console.error('[Backfill API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Backfill failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check backfill status
export async function GET() {
  try {
    // Count sessions in database
    const dbCount = await db.execute(
      sql`SELECT COUNT(*)::int as count FROM sessions`
    ).then(r => Number((r.rows[0] as { count: number })?.count || 0));

    // Try to get GCS count (may fail if GCS not configured)
    let gcsCount = 0;
    try {
      const gcsSessions = await listSessions({ limit: 1000, offset: 0 });
      gcsCount = gcsSessions.length;
    } catch (error) {
      console.warn('[Backfill] Could not count GCS sessions:', error);
    }

    return NextResponse.json({
      databaseSessions: dbCount,
      gcsSessions: gcsCount,
      needsBackfill: gcsCount > dbCount,
      difference: gcsCount - dbCount,
    });
  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Failed to check backfill status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
