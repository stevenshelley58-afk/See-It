/**
 * Live Sessions Polling API
 * Returns active sessions and recent updates for real-time dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { sessions, errors } from '@/lib/db/schema';
import { eq, and, gte, desc, or, isNotNull } from 'drizzle-orm';
import { deriveSessionsFromAnalytics, listSessions } from '@/lib/gcs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sinceParam = searchParams.get('since');

    const now = new Date();

    // Prefer DB if available, but fall back to GCS so "live" works even when Postgres isn't migrated yet.
    try {
      // Active sessions: updated in last 10 minutes, status = 'in_progress'
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const activeSessions = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.status, 'in_progress'),
            gte(sessions.updatedAt, tenMinutesAgo)
          )
        )
        .orderBy(desc(sessions.updatedAt))
        .limit(100);

      // Recent completions: completed in last 5 minutes
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const recentCompletions = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.status, 'completed'),
            or(
              and(isNotNull(sessions.endedAt), gte(sessions.endedAt, fiveMinutesAgo)),
              and(isNotNull(sessions.updatedAt), gte(sessions.updatedAt, fiveMinutesAgo))
            )
          )
        )
        .orderBy(desc(sessions.endedAt), desc(sessions.updatedAt))
        .limit(50);

      // Recent errors: occurred in last 5 minutes
      const recentErrorsRaw = await db
        .select()
        .from(errors)
        .where(gte(errors.occurredAt, fiveMinutesAgo))
        .orderBy(desc(errors.occurredAt))
        .limit(50);

      // Get session info for errors (simplified - just use error data)
      const recentErrors = recentErrorsRaw.map((error) => {
        return {
          id: error.id,
          sessionId: null, // We'd need to join to get this, simplified for now
          shopDomain: null,
          errorType: error.errorType,
          errorCode: error.errorCode,
          errorMessage: error.errorMessage,
          severity: error.severity,
          step: error.step,
          occurredAt: error.occurredAt.toISOString(),
        };
      });

      // Get latest timestamp from all sources
      const latestTimestamps = [
        ...activeSessions.map(s => s.updatedAt?.getTime() || 0),
        ...recentCompletions.map(s => (s.endedAt || s.updatedAt)?.getTime() || 0),
        ...recentErrors.map(e => Date.parse(e.occurredAt)),
      ].filter(Boolean);

      const latestTimestamp = latestTimestamps.length > 0
        ? new Date(Math.max(...latestTimestamps))
        : now;

      return NextResponse.json({
        activeSessions: activeSessions.map(formatSession),
        recentCompletions: recentCompletions.map(formatSession),
        recentErrors,
        latestTimestamp: latestTimestamp.toISOString(),
        source: 'db',
      });
    } catch (dbError) {
      console.warn('[Live Sessions API] DB unavailable, falling back to GCS:', dbError);

      const tenMinutesAgoMs = now.getTime() - 10 * 60 * 1000;
      const fiveMinutesAgoMs = now.getTime() - 5 * 60 * 1000;

      let gcsSessions: Awaited<ReturnType<typeof listSessions>> = [];
      try {
        gcsSessions = await listSessions({ limit: 200, offset: 0 });
      } catch (err) {
        console.warn('[Live Sessions API] listSessions failed, will fall back to analytics events:', err);
      }

      if (gcsSessions.length > 0) {
        const active = gcsSessions
          .filter((s) => s.status === 'in_progress' && new Date(s.updatedAt).getTime() > tenMinutesAgoMs)
          .slice(0, 100);

        const recentCompletions = gcsSessions
          .filter((s) => s.status === 'complete' && new Date(s.updatedAt).getTime() > fiveMinutesAgoMs)
          .slice(0, 50);

        // Basic recent errors: sessions marked failed in the last 5 minutes (best-effort from GCS meta)
        const recentErrors = gcsSessions
          .filter((s) => new Date(s.updatedAt).getTime() > fiveMinutesAgoMs)
          .filter((s) => s.status === 'failed')
          .slice(0, 50)
          .map((s) => ({
            id: `gcs_${s.sessionId}`,
            sessionId: s.sessionId,
            shopDomain: s.shop,
            errorCode: 'SESSION_FAILED',
            errorMessage: 'Session failed (from GCS)',
            severity: 'error',
            occurredAt: s.updatedAt,
          }));

        const latestTimestamp = gcsSessions.length > 0 ? gcsSessions[0].updatedAt : now.toISOString();

        return NextResponse.json({
          activeSessions: active.map((s) => ({
            id: s.sessionId,
            sessionId: s.sessionId,
            shopDomain: s.shop,
            productTitle: s.productTitle || null,
            status: s.status === 'complete' ? 'completed' : s.status,
            currentStep: s.currentStep,
            stepsCompleted: s.stepsCompleted,
            startedAt: s.startedAt,
            updatedAt: s.updatedAt,
            endedAt: null,
            deviceType: s.device || null,
            browser: s.browser || null,
          })),
          recentCompletions: recentCompletions.map((s) => ({
            id: s.sessionId,
            sessionId: s.sessionId,
            shopDomain: s.shop,
            productTitle: s.productTitle || null,
            status: 'completed',
            currentStep: s.currentStep,
            stepsCompleted: s.stepsCompleted,
            startedAt: s.startedAt,
            updatedAt: s.updatedAt,
            endedAt: s.updatedAt,
            deviceType: s.device || null,
            browser: s.browser || null,
          })),
          recentErrors,
          latestTimestamp,
          source: 'gcs',
        });
      }

      // If no session meta/index data exists, derive from analytics event logs.
      const derived = await deriveSessionsFromAnalytics({ lookbackMs: 24 * 60 * 60 * 1000 });
      const active = derived.sessions
        .filter((s) => s.status === 'in_progress' && Date.parse(s.updatedAt) > tenMinutesAgoMs)
        .slice(0, 100);

      const recentCompletions = derived.sessions
        .filter((s) => s.status === 'completed' && s.endedAt && Date.parse(s.endedAt) > fiveMinutesAgoMs)
        .slice(0, 50);

      const recentErrors = derived.recentErrors
        .filter((e) => Date.parse(e.occurredAt) > fiveMinutesAgoMs)
        .slice(0, 50);

      const latestTimestamps = [
        ...active.map((s) => Date.parse(s.updatedAt)),
        ...recentCompletions.map((s) => Date.parse(s.endedAt || s.updatedAt)),
        ...recentErrors.map((e) => Date.parse(e.occurredAt)),
      ].filter((n) => Number.isFinite(n));

      const latestTimestamp = latestTimestamps.length > 0 ? new Date(Math.max(...latestTimestamps)).toISOString() : now.toISOString();

      return NextResponse.json({
        activeSessions: active.map((s) => ({
          id: s.sessionId,
          sessionId: s.sessionId,
          shopDomain: s.shopDomain,
          productTitle: s.productTitle,
          status: s.status,
          currentStep: s.currentStep,
          stepsCompleted: s.stepsCompleted,
          startedAt: s.startedAt,
          updatedAt: s.updatedAt,
          endedAt: s.endedAt,
          deviceType: s.deviceType,
          browser: s.browser,
        })),
        recentCompletions: recentCompletions.map((s) => ({
          id: s.sessionId,
          sessionId: s.sessionId,
          shopDomain: s.shopDomain,
          productTitle: s.productTitle,
          status: s.status,
          currentStep: s.currentStep,
          stepsCompleted: s.stepsCompleted,
          startedAt: s.startedAt,
          updatedAt: s.updatedAt,
          endedAt: s.endedAt,
          deviceType: s.deviceType,
          browser: s.browser,
        })),
        recentErrors,
        latestTimestamp,
        source: 'gcs_analytics',
      });
    }
  } catch (error) {
    console.error('[Live Sessions API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch live sessions' },
      { status: 500 }
    );
  }
}

function formatSession(session: typeof sessions.$inferSelect) {
  return {
    id: session.id,
    sessionId: session.sessionId,
    shopDomain: session.shopDomain,
    productTitle: session.productTitle,
    status: session.status,
    currentStep: session.currentStep,
    stepsCompleted: session.stepsCompleted,
    startedAt: session.startedAt?.toISOString(),
    updatedAt: session.updatedAt?.toISOString(),
    endedAt: session.endedAt?.toISOString(),
    deviceType: session.deviceType,
    browser: session.browser,
  };
}

function formatError(error: typeof errors.$inferSelect & {
  session?: {
    sessionId: string | null;
    shopDomain: string | null;
    productTitle: string | null;
  } | null;
}) {
  return {
    id: error.id,
    sessionId: error.session?.sessionId || null,
    shopDomain: error.session?.shopDomain || null,
    errorType: error.errorType,
    errorCode: error.errorCode,
    errorMessage: error.errorMessage,
    severity: error.severity,
    step: error.step,
    occurredAt: error.occurredAt.toISOString(),
  };
}
