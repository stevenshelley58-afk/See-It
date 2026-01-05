/**
 * Get a single session by ID
 */

import { NextResponse } from 'next/server';
import { getSession, getSignedImageUrl } from '@/lib/gcs';

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const includeImages = searchParams.get('includeImages') === 'true';

    const session = await getSession(params.sessionId);

    if (!session) {
      return NextResponse.json({
        error: 'Session not found',
      }, { status: 404 });
    }

    // Optionally add signed URLs for images
    if (includeImages) {
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

    return NextResponse.json(session);
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Unknown error',
    }, { status: 500 });
  }
}
