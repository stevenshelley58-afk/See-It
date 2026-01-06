import { NextResponse } from 'next/server';
import { getSessionStats } from '@/lib/db/queries';
import { listSessions } from '@/lib/gcs';

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

    const sessions = await listSessions({ limit: 1000, offset: 0 });

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === 'complete' || s.status === 'completed').length;
    const successRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

    const activeShops = new Set(
      sessions
        .filter(s => s.status === 'in_progress' && new Date(s.updatedAt) > tenMinutesAgo)
        .map(s => s.shop)
    ).size;

    const todayCount = sessions.filter(s => new Date(s.startedAt) >= today).length;

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
}
