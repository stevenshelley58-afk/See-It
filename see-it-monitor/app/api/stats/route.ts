import { NextResponse } from 'next/server';
import { getSessionStats } from '@/lib/db/queries';
import { deriveSessionsFromAnalytics, listSessions } from '@/lib/gcs';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await getSessionStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.warn('[Stats API] DB unavailable, falling back to GCS stats:', error);

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    // First try "sessions/*/meta.json" (best fidelity). If none exist, fall back to analytics event logs.
    let sessions: Awaited<ReturnType<typeof listSessions>> = [];
    try {
      sessions = await listSessions({ limit: 1000, offset: 0 });
    } catch (err) {
      console.warn('[Stats API] listSessions failed, will fall back to analytics events:', err);
    }

    if (sessions.length > 0) {
      const totalSessions = sessions.length;
      const completedSessions = sessions.filter((s) => s.status === 'complete').length;
      const successRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

      const activeShops = new Set(
        sessions
          .filter((s) => s.status === 'in_progress' && new Date(s.updatedAt) > tenMinutesAgo)
          .map((s) => s.shop)
      ).size;

      const todayCount = sessions.filter((s) => new Date(s.startedAt) >= today).length;

      return NextResponse.json({
        totalSessions,
        completedSessions,
        successRate,
        activeShops,
        todayErrors: 0,
        todayCost: 0,
        todayCount,
        source: 'gcs',
      });
    }

    const derived = await deriveSessionsFromAnalytics({ lookbackMs: 24 * 60 * 60 * 1000 });
    const derivedSessions = derived.sessions;

    const totalSessions = derivedSessions.length;
    const completedSessions = derivedSessions.filter((s) => s.status === 'completed').length;
    const successRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

    const activeShops = new Set(
      derivedSessions
        .filter((s) => s.status === 'in_progress' && new Date(s.updatedAt) > tenMinutesAgo)
        .map((s) => s.shopDomain)
    ).size;

    const todayCount = derivedSessions.filter((s) => new Date(s.startedAt) >= today).length;

    return NextResponse.json({
      totalSessions,
      completedSessions,
      successRate,
      activeShops,
      todayErrors: derived.recentErrors.filter((e) => new Date(e.occurredAt) >= today).length,
      todayCost: 0,
      todayCount,
      source: 'gcs_analytics',
    });
  }
}
