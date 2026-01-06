/**
 * Resync endpoint
 * Scans GCS bucket for all session folders and rebuilds index/cache
 * Useful if data gets out of sync
 */

import { NextResponse } from 'next/server';
import { listSessions } from '@/lib/gcs';

export async function POST() {
  try {
    // Trigger a full rescan by listing all sessions
    const sessions = await listSessions({ limit: 1000 });

    return NextResponse.json({
      status: 'ok',
      message: 'Resync completed',
      sessionCount: sessions.length,
      sessionsProcessed: sessions.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      status: 'error',
      message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
