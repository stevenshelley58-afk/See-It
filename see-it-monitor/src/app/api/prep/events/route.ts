/**
 * Prep Events Ingestion API
 * Accepts prep events from the main app (server-to-server)
 * 
 * This is separate from the analytics SDK - it's for product prep audit events.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { prepEvents } from '@/lib/db/schema';

// Data retention: 1 year
const MAX_EVENT_AGE_MS = 365 * 24 * 60 * 60 * 1000;

interface PrepEventInput {
  assetId: string;
  productId: string;
  shopId: string;
  timestamp: string; // ISO string
  actorType: 'system' | 'merchant';
  actorId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}

function isValidEvent(event: unknown): event is PrepEventInput {
  if (!event || typeof event !== 'object') return false;
  const e = event as Partial<PrepEventInput>;
  return (
    typeof e.assetId === 'string' &&
    typeof e.productId === 'string' &&
    typeof e.shopId === 'string' &&
    typeof e.timestamp === 'string' &&
    (e.actorType === 'system' || e.actorType === 'merchant') &&
    typeof e.eventType === 'string' &&
    typeof e.payload === 'object' &&
    e.payload !== null
  );
}

function isEventTooOld(timestamp: string): boolean {
  try {
    const eventTime = new Date(timestamp).getTime();
    const now = Date.now();
    return now - eventTime > MAX_EVENT_AGE_MS;
  } catch {
    return true; // Invalid timestamp, reject
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { events } = body;

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'Events array is required' },
        { status: 400 }
      );
    }

    const processedEvents: PrepEventInput[] = [];
    const errors: string[] = [];

    // Validate and filter events
    for (const event of events) {
      if (!isValidEvent(event)) {
        errors.push('Invalid event structure');
        continue;
      }

      if (isEventTooOld(event.timestamp)) {
        errors.push(`Event too old: ${event.timestamp}`);
        continue;
      }

      processedEvents.push(event);
    }

    if (processedEvents.length === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'No valid events to process',
          errors 
        },
        { status: 400 }
      );
    }

    // Insert all valid events
    const insertPromises = processedEvents.map((event) =>
      db.insert(prepEvents).values({
        assetId: event.assetId,
        productId: event.productId,
        shopId: event.shopId,
        timestamp: new Date(event.timestamp),
        actorType: event.actorType,
        actorId: event.actorId || null,
        eventType: event.eventType,
        payload: event.payload,
      })
    );

    const insertResults = await Promise.allSettled(insertPromises);

    // Count successes and failures
    let successCount = 0;
    const dbErrors: string[] = [];
    
    insertResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        dbErrors.push(`Event ${index} failed: ${errorMsg}`);
        console.error(`[Prep Events API] Database insert failed:`, result.reason);
      }
    });

    return NextResponse.json({
      success: true,
      processed: successCount,
      total: processedEvents.length,
      errors: errors.length > 0 || dbErrors.length > 0 ? [...errors, ...dbErrors] : undefined,
    });
  } catch (error) {
    console.error('[Prep Events API] Error processing request:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}
