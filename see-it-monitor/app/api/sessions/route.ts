/**
 * Get all sessions
 */

import { NextResponse } from 'next/server';
import { getAllSessions, getSignedImageUrl } from '@/lib/gcs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeImages = searchParams.get('includeImages') === 'true';

    const sessions = await getAllSessions();

    // Optionally add signed URLs for images
    if (includeImages) {
      for (const session of sessions) {
        if (session.imageKeys.mask) {
          try {
            session.imageKeys.mask = await getSignedImageUrl(session.imageKeys.mask, 60 * 60 * 1000);
          } catch (error) {
            console.error(`[API] Failed to generate signed URL for mask:`, error);
          }
        }
        if (session.imageKeys.inpaint) {
          try {
            session.imageKeys.inpaint = await getSignedImageUrl(session.imageKeys.inpaint, 60 * 60 * 1000);
          } catch (error) {
            console.error(`[API] Failed to generate signed URL for inpaint:`, error);
          }
        }
      }
    }

    return NextResponse.json({
      sessions,
      count: sessions.length,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Unknown error',
    }, { status: 500 });
  }
}
