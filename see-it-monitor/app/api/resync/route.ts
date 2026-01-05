/**
 * Resync endpoint
 * Scans GCS bucket for all session folders and rebuilds index/cache
 * Useful if data gets out of sync
 */

import { NextResponse } from 'next/server';
import { listSessions, getAllSessions } from '@/lib/gcs';

export async function POST() {
  try {
    // Trigger a full rescan
    const sessionIds = await listSessions();
    const sessions = await getAllSessions();

    return NextResponse.json({
      status: 'ok',
      message: 'Resync completed',
      sessionCount: sessions.length,
      sessionsProcessed: sessionIds.length,
      sessionsFound: sessions.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({
      status: 'error',
      message: error.message || 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
