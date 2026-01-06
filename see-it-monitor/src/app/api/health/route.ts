/**
 * Health check endpoint
 * Returns GCS connection status, number of sessions found, latest session timestamp
 */

import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/gcs';

const SESSION_BUCKET = process.env.GCS_SESSION_BUCKET || 'see-it-sessions';

type HealthSessionSummary = {
  sessionId: string;
  shop: string;
  updatedAt: string;
  stepsCompleted: number;
};

export async function GET() {
  try {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);

    // Check bucket exists
    const [bucketExists] = await bucket.exists();

    if (!bucketExists) {
      return NextResponse.json({
        status: 'error',
        message: `Bucket ${SESSION_BUCKET} does not exist`,
        gcsConnected: false,
        sessionCount: 0,
        latestSession: null,
      }, { status: 200 }); // Return 200 so health checks can still see the status
    }

    // Try to list some sessions to verify access
    let sessionCount = 0;
    let latestSession: HealthSessionSummary | null = null;

    try {
      const [files] = await bucket.getFiles({
        prefix: 'sessions/',
        maxResults: 100,
      });

      // Count unique session directories
      const sessionIds = new Set<string>();
      for (const file of files) {
        const match = file.name.match(/^sessions\/([^\/]+)\//);
        if (match && match[1]) {
          sessionIds.add(match[1]);
        }
      }
      sessionCount = sessionIds.size;

      // Try to get the latest session
      if (sessionIds.size > 0) {
        const sessionId = Array.from(sessionIds)[0];
        const metaFile = bucket.file(`sessions/${sessionId}/meta.json`);
        const [exists] = await metaFile.exists();
        if (exists) {
          const [content] = await metaFile.download();
          const meta: unknown = JSON.parse(content.toString());
          const m = meta as Partial<{
            sessionId: string;
            shop: string;
            updatedAt: string;
            steps: Array<{ status?: string }>;
          }>;
          latestSession = {
            sessionId: m.sessionId || sessionId,
            shop: m.shop || '',
            updatedAt: m.updatedAt || '',
            stepsCompleted: Array.isArray(m.steps)
              ? m.steps.filter((s) => s?.status === 'success').length
              : 0,
          };
        }
      }
    } catch (error: unknown) {
      console.error('[Health] Error checking sessions:', error);
      // Continue with available info
    }

    return NextResponse.json({
      status: 'ok',
      gcsConnected: true,
      bucketName: SESSION_BUCKET,
      sessionCount,
      latestSession,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      status: 'error',
      message,
      gcsConnected: false,
      sessionCount: 0,
      latestSession: null,
    }, { status: 500 });
  }
}
