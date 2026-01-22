/**
 * Prep Event Emitter
 * 
 * Emits prep events to both the app DB (source of truth) and see-it-monitor (for UI/alerts).
 * All operations are fire-and-forget for monitor writes - never blocks merchant flows.
 */

import prisma from "../db.server";
import { logger, createLogContext } from "../utils/logger.server";

// Monitor endpoint for prep events (separate from analytics SDK)
const MONITOR_PREP_EVENTS_URL = process.env.MONITOR_PREP_EVENTS_URL || 
  'https://see-it-monitor.vercel.app/api/prep/events';

export interface PrepEventPayload {
  before?: unknown;
  after?: unknown;
  confidence?: string | number; // "high" | "medium" | "low" or numeric
  source?: "auto" | "manual";
  fieldName?: string;
  confidenceBefore?: string | number;
  confidenceAfter?: string | number;
  issue?: string; // For cutout issues
  actor?: {
    userId?: string;
    email?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown; // Allow additional fields
}

export interface PrepEventData {
  assetId: string;
  productId: string;
  shopId: string;
  eventType: string;
  payload: PrepEventPayload;
  actorType: "system" | "merchant";
  actorId?: string | null; // Best-effort: Shopify userId if available, else null
  timestamp?: Date; // Optional, defaults to now
}

/**
 * Extract actor info from Shopify session (best-effort)
 */
function extractActorFromSession(session: { userId?: string | number | bigint; email?: string } | null): {
  actorId: string | null;
  actorPayload: PrepEventPayload['actor'];
} {
  if (!session) {
    return { actorId: null, actorPayload: undefined };
  }

  const userId = session.userId ? String(session.userId) : null;
  const email = session.email || undefined;

  return {
    actorId: userId || null,
    actorPayload: userId || email ? { userId: userId || undefined, email } : undefined,
  };
}

/**
 * Emit a prep event to both app DB and monitor (fire-and-forget for monitor)
 */
export async function emitPrepEvent(
  data: PrepEventData,
  session?: { userId?: string | number | bigint; email?: string } | null,
  requestId?: string
): Promise<void> {
  const logContext = createLogContext("prepare", requestId || "prep-event", "emit", {
    assetId: data.assetId,
    eventType: data.eventType,
  });

  // Extract actor info if merchant event
  let actorId = data.actorId;
  let actorPayload = data.payload.actor;

  if (data.actorType === "merchant" && session) {
    const extracted = extractActorFromSession(session);
    if (!actorId) {
      actorId = extracted.actorId;
    }
    if (!actorPayload) {
      actorPayload = extracted.actorPayload;
    }
  }

  // Merge actor into payload if we have it
  const finalPayload: PrepEventPayload = {
    ...data.payload,
    ...(actorPayload && { actor: actorPayload }),
  };

  const timestamp = data.timestamp || new Date();

  try {
    // 1. Insert into app DB (source of truth) - this must succeed
    await prisma.prepEvent.create({
      data: {
        assetId: data.assetId,
        productId: data.productId,
        shopId: data.shopId,
        timestamp,
        actorType: data.actorType,
        actorId,
        eventType: data.eventType,
        payload: finalPayload as any, // Prisma Json type
      },
    });

    logger.debug(logContext, `Prep event emitted: ${data.eventType}`);
  } catch (error) {
    // DB write failure is critical - log but don't throw (don't break merchant flow)
    logger.error(
      logContext,
      `Failed to emit prep event to DB: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
    // Don't throw - we don't want to break merchant flows
    return;
  }

  // 2. Fire-and-forget copy to monitor (never blocks)
  sendToMonitor(data, finalPayload, actorId, timestamp, logContext).catch((error) => {
    // Silently log monitor failures - they're not critical
    logger.debug(
      logContext,
      `Monitor copy failed (non-critical): ${error instanceof Error ? error.message : String(error)}`
    );
  });
}

/**
 * Send event copy to monitor (fire-and-forget, never throws)
 */
async function sendToMonitor(
  data: PrepEventData,
  payload: PrepEventPayload,
  actorId: string | null | undefined,
  timestamp: Date,
  logContext: ReturnType<typeof createLogContext>
): Promise<void> {
  try {
    const monitorEvent = {
      assetId: data.assetId,
      productId: data.productId,
      shopId: data.shopId,
      timestamp: timestamp.toISOString(),
      actorType: data.actorType,
      actorId: actorId || null,
      eventType: data.eventType,
      payload,
    };

    // Fire-and-forget POST to monitor
    const response = await fetch(MONITOR_PREP_EVENTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ events: [monitorEvent] }),
      // Don't wait too long - 2s timeout
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      throw new Error(`Monitor API returned ${response.status}: ${text.substring(0, 200)}`);
    }
  } catch (error) {
    // Swallow all errors - monitor copy is non-critical
    // Already logged in calling code
    throw error; // Re-throw so caller can log if needed
  }
}
