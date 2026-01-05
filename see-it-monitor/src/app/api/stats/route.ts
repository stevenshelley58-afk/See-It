import { NextResponse } from 'next/server';
import { getSessionStats } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await getSessionStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('[Stats API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
