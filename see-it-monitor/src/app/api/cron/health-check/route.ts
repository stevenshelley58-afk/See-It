/**
 * Health Check Cron Job
 * Runs every 5 minutes to check system health
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { systemHealth } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

async function checkService(name: string, url: string): Promise<{ status: string; responseTime?: number; error?: string }> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const responseTime = Date.now() - start;

    if (response.ok) {
      return { status: 'healthy', responseTime };
    } else {
      return { status: 'degraded', responseTime, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    const responseTime = Date.now() - start;
    return {
      status: 'down',
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function GET(request: NextRequest) {
  // Verify cron secret if needed
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const checks = await Promise.allSettled([
      // Check Replicate (example endpoint)
      checkService('replicate', 'https://api.replicate.com/v1/models'),
      // Check FAL (example endpoint)
      checkService('fal', 'https://fal.run/fal-ai'),
    ]);

    const results = checks.map((result, index) => {
      const serviceName = index === 0 ? 'replicate' : 'fal';
      if (result.status === 'fulfilled') {
        return { service: serviceName, ...result.value };
      } else {
        return {
          service: serviceName,
          status: 'down',
          error: result.reason?.message || 'Check failed'
        };
      }
    });

    // Update database
    for (const result of results) {
      const existing = await db
        .select()
        .from(systemHealth)
        .where(eq(systemHealth.service, result.service))
        .limit(1);

      if (existing[0]) {
        await db
          .update(systemHealth)
          .set({
            status: result.status as 'healthy' | 'degraded' | 'down',
            responseTimeMs: 'responseTime' in result ? result.responseTime : null,
            lastCheckedAt: new Date(),
            lastHealthyAt: result.status === 'healthy' ? new Date() : existing[0].lastHealthyAt,
            lastErrorMessage: result.error || null,
          })
          .where(eq(systemHealth.service, result.service));
      } else {
        await db.insert(systemHealth).values({
          service: result.service,
          status: result.status as 'healthy' | 'degraded' | 'down',
          responseTimeMs: 'responseTime' in result ? result.responseTime : null,
          lastCheckedAt: new Date(),
          lastHealthyAt: result.status === 'healthy' ? new Date() : null,
          lastErrorMessage: result.error || null,
        });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('[Health Check] Error:', error);
    return NextResponse.json(
      { error: 'Health check failed' },
      { status: 500 }
    );
  }
}
