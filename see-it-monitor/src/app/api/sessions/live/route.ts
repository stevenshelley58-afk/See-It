/**
 * Live Sessions Polling API
 * Returns active sessions and recent updates for real-time dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { sessions, errors } from '@/lib/db/schema';
import { eq, and, gte, desc, or, isNotNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sinceParam = searchParams.get('since');

    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 5 * 60 * 1000); // Default: last 5 minutes
    const now = new Date();

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

    // Format response
    const response = {
      activeSessions: activeSessions.map(formatSession),
      recentCompletions: recentCompletions.map(formatSession),
      recentErrors: recentErrors,
      latestTimestamp: latestTimestamp.toISOString(),
    };

    return NextResponse.json(response);
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
