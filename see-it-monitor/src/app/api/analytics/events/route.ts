/**
 * Analytics Events Ingestion API
 * Accepts batched events from the client SDK
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { analyticsEvents, sessions, sessionSteps, errors, aiRequests, shops } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { writeAnalyticsEventsToGcs } from '@/lib/gcs';

// Data retention: 1 year
const MAX_EVENT_AGE_MS = 365 * 24 * 60 * 60 * 1000;

interface AnalyticsEvent {
  type: string;
  sessionId?: string;
  shopDomain: string;
  data: Record<string, unknown>;
  timestamp: string;
  deviceContext?: {
    deviceType?: string;
    os?: string;
    osVersion?: string;
    browser?: string;
    browserVersion?: string;
    screenWidth?: number;
    screenHeight?: number;
    hasCamera?: boolean;
    hasGyroscope?: boolean;
    webglSupport?: boolean;
    connectionType?: string;
  };
}

function isValidEvent(event: unknown): event is AnalyticsEvent {
  if (!event || typeof event !== 'object') return false;
  const e = event as Partial<AnalyticsEvent>;
  return (
    typeof e.type === 'string' &&
    typeof e.shopDomain === 'string' &&
    typeof e.data === 'object' &&
    e.data !== null &&
    typeof e.timestamp === 'string'
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

function getOriginFromRequest(request: NextRequest): string | null {
  return request.headers.get('origin') || request.headers.get('referer');
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // Allow *.myshopify.com
    if (hostname.endsWith('.myshopify.com')) {
      return true;
    }
    
    // Allow custom domains (you can add more validation here)
    // For now, we'll allow any domain - you may want to restrict this
    return true;
  } catch {
    return false;
  }
}

function buildCorsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (origin && isAllowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}

export async function POST(request: NextRequest) {
  const origin = getOriginFromRequest(request);
  const corsHeaders = buildCorsHeaders(origin);

  try {
    const body = await request.json();
    const { events } = body;

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'Events array is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const processedEvents: AnalyticsEvent[] = [];
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

    // Always persist raw events to both GCS (backup) and database (primary)
    // Database is the primary source - all events are saved to analytics_events table
    // GCS is kept as a backup/archive
    const gcsResult = await writeAnalyticsEventsToGcs({
      events: processedEvents.map((e) => ({
        type: e.type,
        sessionId: e.sessionId,
        shopDomain: e.shopDomain,
        data: e.data,
        timestamp: e.timestamp,
        deviceContext: e.deviceContext as Record<string, unknown> | undefined,
      })),
      requestInfo: {
        origin,
        userAgent: request.headers.get('user-agent'),
        ip: request.headers.get('x-forwarded-for')?.split(',')[0] || null,
      },
    });

    // Process events in batch
    const insertPromises: Promise<unknown>[] = [];

    for (const event of processedEvents) {
      // Always insert raw event
      insertPromises.push(
        db.insert(analyticsEvents).values({
          eventType: event.type,
          sessionId: event.sessionId || null,
          shopDomain: event.shopDomain,
          data: event.data,
          clientTimestamp: new Date(event.timestamp),
          serverTimestamp: new Date(),
          userAgent: request.headers.get('user-agent') || null,
          ip: request.headers.get('x-forwarded-for')?.split(',')[0] || null,
        })
      );

      // Process specific event types to update structured tables
      // ALL events are already saved to analytics_events table above
      // These handlers update the structured tables (sessions, steps, errors, etc.)
      if (event.type === 'session_started' && event.sessionId) {
        const deviceCtx = event.deviceContext || {};
        insertPromises.push(
          handleSessionStarted(event, deviceCtx)
        );
      } else if (event.type === 'step_update' && event.sessionId) {
        insertPromises.push(
          handleStepUpdate(event)
        );
      } else if (event.type === 'session_ended' && event.sessionId) {
        insertPromises.push(
          handleSessionEnded(event)
        );
      } else if (event.type === 'error' && event.sessionId) {
        insertPromises.push(
          handleError(event, request)
        );
      } else if (event.type === 'ai_request' && event.sessionId) {
        insertPromises.push(
          handleAIRequest(event)
        );
      }
      // Note: Other event types (user_action, post_ar_action, ar_button_click, etc.)
      // are saved to analytics_events table and can be queried from there
      // They're visible in the monitor through the analytics_events table
    }

    // Execute all inserts
    const insertResults = await Promise.allSettled(insertPromises);
    
    // Log any database errors
    const dbErrors: string[] = [];
    insertResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        dbErrors.push(`Insert ${index} failed: ${errorMsg}`);
        console.error(`[Analytics API] Database insert failed:`, result.reason);
      }
    });

    return NextResponse.json({
      success: true,
      processed: processedEvents.length,
      errors: errors.length > 0 ? errors : undefined,
      dbErrors: dbErrors.length > 0 ? dbErrors : undefined,
      stored: {
        gcs: gcsResult.ok,
        gcsPath: gcsResult.ok ? gcsResult.path : null,
        gcsError: gcsResult.ok ? null : gcsResult.error,
        db: dbErrors.length === 0,
        dbErrorCount: dbErrors.length,
      },
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[Analytics API] Error processing events:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { 
        error: 'Failed to process events',
        details: errorMessage,
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function handleSessionStarted(event: AnalyticsEvent, deviceCtx: AnalyticsEvent['deviceContext']) {
  const data = event.data as {
    productId?: string;
    productTitle?: string;
    productPrice?: number;
    entryPoint?: string;
    referrer?: string;
    timeOnPageBeforeArMs?: number;
  };

  // Get or create shop
  const existingShops = await db
    .select()
    .from(shops)
    .where(eq(shops.domain, event.shopDomain))
    .limit(1);
  
  let shop = existingShops[0];

  if (!shop) {
    const [newShop] = await db.insert(shops).values({
      domain: event.shopDomain,
      installedAt: new Date(),
    }).returning();
    shop = newShop;
  }

  // Create session
  await db.insert(sessions).values({
    sessionId: event.sessionId!,
    shopId: shop.id,
    shopDomain: event.shopDomain,
    productTitle: data.productTitle || null,
    productPrice: data.productPrice || null,
    status: 'in_progress',
    startedAt: new Date(event.timestamp),
    currentStep: null,
    stepsCompleted: 0,
    deviceType: deviceCtx?.deviceType || null,
    os: deviceCtx?.os || null,
    osVersion: deviceCtx?.osVersion || null,
    browser: deviceCtx?.browser || null,
    browserVersion: deviceCtx?.browserVersion || null,
    screenWidth: deviceCtx?.screenWidth || null,
    screenHeight: deviceCtx?.screenHeight || null,
    hasCamera: deviceCtx?.hasCamera || null,
    hasGyroscope: deviceCtx?.hasGyroscope || null,
    webglSupport: deviceCtx?.webglSupport || null,
    connectionType: deviceCtx?.connectionType || null,
    entryPoint: data.entryPoint || null,
    referrer: data.referrer || null,
    timeOnPageBeforeAr: data.timeOnPageBeforeArMs || null,
  });
}

async function handleStepUpdate(event: AnalyticsEvent) {
  const data = event.data as {
    step?: string;
    status?: string;
    durationMs?: number;
    retakeCount?: number;
    maskEditCount?: number;
    placementAdjustments?: number;
    regenerationCount?: number;
    autoVsManual?: string;
    autoConfidence?: number;
    errorCode?: string;
    errorMessage?: string;
  };

  // Get session
  const existingSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, event.sessionId!))
    .limit(1);
  
  const session = existingSessions[0];
  if (!session) return;

  // Create or update step
  await db.insert(sessionSteps).values({
    sessionId: session.id,
    step: data.step || 'unknown',
    status: data.status || 'started',
    startedAt: new Date(event.timestamp),
    completedAt: data.status === 'completed' ? new Date() : null,
    durationMs: data.durationMs || null,
    retakeCount: data.retakeCount || 0,
    maskEditCount: data.maskEditCount || 0,
    placementAdjustments: data.placementAdjustments || 0,
    regenerationCount: data.regenerationCount || 0,
    autoVsManual: data.autoVsManual || null,
    autoConfidence: data.autoConfidence || null,
    errorCode: data.errorCode || null,
    errorMessage: data.errorMessage || null,
  });

  // Update session
  const stepsCompleted = data.status === 'completed' ? (session.stepsCompleted || 0) + 1 : session.stepsCompleted;
  await db.update(sessions)
    .set({
      currentStep: data.step || null,
      stepsCompleted,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, session.id));
}

async function handleSessionEnded(event: AnalyticsEvent) {
  const data = event.data as {
    status?: string;
    durationMs?: number;
    abandonmentStep?: string;
    abandonmentReason?: string;
    postArAction?: string;
    addedToCart?: boolean;
  };

  const existingSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, event.sessionId!))
    .limit(1);
  
  const session = existingSessions[0];

  if (!session) return;

  await db.update(sessions)
    .set({
      status: data.status || 'completed',
      endedAt: new Date(event.timestamp),
      durationMs: data.durationMs || null,
      abandonmentStep: data.abandonmentStep || null,
      abandonmentReason: data.abandonmentReason || null,
      postArAction: data.postArAction || null,
      addedToCart: data.addedToCart || false,
      addedToCartAt: data.addedToCart ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, session.id));
}

async function handleError(event: AnalyticsEvent, request: NextRequest) {
  const data = event.data as {
    errorCode?: string;
    errorMessage?: string;
    severity?: string;
    step?: string;
    isUserFacing?: boolean;
  };

  const existingSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, event.sessionId!))
    .limit(1);
  
  const session = existingSessions[0];

  let shop = null;
  if (session?.shopId) {
    const shopsList = await db
      .select()
      .from(shops)
      .where(eq(shops.id, session.shopId))
      .limit(1);
    shop = shopsList[0];
  }
  
  if (!shop) {
    const shopsList = await db
      .select()
      .from(shops)
      .where(eq(shops.domain, event.shopDomain))
      .limit(1);
    shop = shopsList[0];
  }

  await db.insert(errors).values({
    sessionId: session?.id || null,
    shopId: shop?.id || null,
    errorType: 'client',
    errorCode: data.errorCode || 'UNKNOWN_ERROR',
    errorMessage: data.errorMessage || 'Unknown error',
    severity: (data.severity as 'critical' | 'error' | 'warning') || 'error',
    step: data.step || null,
    isUserFacing: data.isUserFacing ?? true,
    deviceType: event.deviceContext?.deviceType || null,
    os: event.deviceContext?.os || null,
    browser: event.deviceContext?.browser || null,
    userAgent: request.headers.get('user-agent') || null,
    occurredAt: new Date(event.timestamp),
  });

  // Update session error count
  if (session) {
    await db.update(sessions)
      .set({
        hadError: true,
        errorCount: (session.errorCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, session.id));
  }
}

async function handleAIRequest(event: AnalyticsEvent) {
  const data = event.data as {
    requestId?: string;
    provider?: string;
    model?: string;
    modelVersion?: string;
    operation?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    status?: string;
    costUsd?: number;
    isRegeneration?: boolean;
    regenerationReason?: string;
    errorMessage?: string;
  };

  const existingSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, event.sessionId!))
    .limit(1);
  
  const session = existingSessions[0];

  if (!session) return;

  await db.insert(aiRequests).values({
    sessionId: session.id,
    requestId: data.requestId || null,
    provider: (data.provider as 'replicate' | 'fal' | 'openai') || 'replicate',
    model: data.model || 'unknown',
    modelVersion: data.modelVersion || null,
    operation: (data.operation as 'inpaint' | 'segment' | 'remove_bg' | 'upscale') || 'inpaint',
    startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
    completedAt: data.completedAt ? new Date(data.completedAt) : null,
    durationMs: data.durationMs || null,
    status: (data.status as 'pending' | 'success' | 'failed' | 'timeout') || 'pending',
    costUsd: data.costUsd || null,
    isRegeneration: data.isRegeneration || false,
    regenerationReason: data.regenerationReason || null,
    errorMessage: data.errorMessage || null,
  });

  // Update session cost
  if (data.costUsd) {
    await db.update(sessions)
      .set({
        totalAiCost: (session.totalAiCost || 0) + data.costUsd,
        regenerationCount: data.isRegeneration
          ? (session.regenerationCount || 0) + 1
          : session.regenerationCount,
        regenerationCost: data.isRegeneration
          ? (session.regenerationCost || 0) + data.costUsd
          : session.regenerationCost,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, session.id));
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS(request: NextRequest) {
  const origin = getOriginFromRequest(request);
  const headers = buildCorsHeaders(origin);
  return new NextResponse(null, { status: 204, headers });
}
