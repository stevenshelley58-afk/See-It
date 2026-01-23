/**
 * Session Logger - Fire-and-forget logging for See It sessions
 *
 * Logs session data to GCS bucket 'see-it-sessions' for monitoring.
 * CRITICAL: Never await in calling code - this must not block user flows.
 *
 * Integrates with MonitorArtifact when shopId is provided - session logs
 * are indexed as artifacts for visibility in the monitor UI.
 */

import { getGcsClient } from "../utils/gcs-client.server";
import { storeArtifact, ArtifactType, RetentionClass } from "./telemetry";

const SESSION_BUCKET = process.env.GCS_SESSION_BUCKET || 'see-it-sessions';

type StepName = 'room' | 'mask' | 'inpaint' | 'placement' | 'final';

// ============================================================================
// SEE IT NOW - Session Event Types
// ============================================================================

export type SeeItNowEventType = 
  | 'session_started'
  | 'room_uploaded'
  | 'variants_generated'
  | 'variant_selected'
  | 'error'
  | 'session_ended';

export interface SeeItNowEventData {
  // Common fields
  sessionId: string;
  shop: string;
  productId?: string;
  productTitle?: string;
  timestamp?: string;

  // Optional telemetry integration fields
  // When provided, session logs are indexed as MonitorArtifact
  shopId?: string; // Internal shop ID (not domain)
  runId?: string; // RenderRun ID for correlation
  requestId?: string; // Request ID for correlation
  
  // session_started
  device?: {
    userAgent?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
    screenWidth?: number;
    screenHeight?: number;
  };
  
  // room_uploaded
  roomSessionId?: string;
  imageSize?: string;
  
  // variants_generated
  variantCount?: number;
  variantIds?: string[];
  durationMs?: number;
  imageUrls?: string[];
  
  // variant_selected
  selectedVariantId?: string;
  selectedImageUrl?: string;
  upscaled?: boolean;
  
  // error
  errorCode?: string;
  errorMessage?: string;
  step?: string;
  
  // session_ended
  status?: 'completed' | 'abandoned' | 'error';
  totalDurationMs?: number;
}

interface SeeItNowSession {
  sessionId: string;
  shop: string;
  productId?: string;
  productTitle?: string;
  startedAt: string;
  updatedAt: string;
  status: 'in_progress' | 'completed' | 'abandoned' | 'error';
  device?: SeeItNowEventData['device'];
  roomSessionId?: string;
  events: Array<{
    type: SeeItNowEventType;
    at: string;
    data: Partial<SeeItNowEventData>;
  }>;
  variants?: Array<{
    id: string;
    imageUrl: string;
    selected?: boolean;
  }>;
  selectedVariant?: string;
  error?: {
    code: string;
    message: string;
    step?: string;
  };
  totalDurationMs?: number;
}

/**
 * Log a See It Now session event to GCS. Fire-and-forget - never await this.
 * 
 * @example
 * // In your route handler (do NOT await):
 * logSeeItNowEvent('variants_generated', {
 *   sessionId: 'see-it-now_abc123',
 *   shop: 'myshop.myshopify.com',
 *   variantCount: 5,
 *   durationMs: 4500
 * });
 */
export function logSeeItNowEvent(
  eventType: SeeItNowEventType,
  data: SeeItNowEventData
): void {
  // Fire and forget - run in background
  doLogSeeItNowEvent(eventType, data).catch((error) => {
    console.error('[SessionLogger] Failed to log See It Now event:', eventType, error?.message || error);
  });
}

/**
 * Internal async implementation for See It Now logging
 */
async function doLogSeeItNowEvent(
  eventType: SeeItNowEventType,
  data: SeeItNowEventData
): Promise<void> {
  const storage = getGcsClient();
  const bucket = storage.bucket(SESSION_BUCKET);
  const basePath = `see-it-now/${data.sessionId}`;
  const now = data.timestamp || new Date().toISOString();

  // Read existing session or create new
  let session: SeeItNowSession;
  const sessionFile = bucket.file(`${basePath}/session.json`);

  try {
    const [exists] = await sessionFile.exists();
    if (exists) {
      const [content] = await sessionFile.download();
      session = JSON.parse(content.toString());
    } else {
      session = {
        sessionId: data.sessionId,
        shop: data.shop,
        productId: data.productId,
        productTitle: data.productTitle,
        startedAt: now,
        updatedAt: now,
        status: 'in_progress',
        events: [],
      };
    }
  } catch {
    // Create fresh if can't read
    session = {
      sessionId: data.sessionId,
      shop: data.shop,
      productId: data.productId,
      productTitle: data.productTitle,
      startedAt: now,
      updatedAt: now,
      status: 'in_progress',
      events: [],
    };
  }

  // Add event
  session.events.push({
    type: eventType,
    at: now,
    data,
  });
  session.updatedAt = now;

  // Update session based on event type
  switch (eventType) {
    case 'session_started':
      session.device = data.device;
      break;

    case 'room_uploaded':
      session.roomSessionId = data.roomSessionId;
      break;

    case 'variants_generated':
      if (data.variantIds && data.imageUrls) {
        session.variants = data.variantIds.map((id, i) => ({
          id,
          imageUrl: data.imageUrls?.[i] || '',
        }));
      }
      break;

    case 'variant_selected':
      session.selectedVariant = data.selectedVariantId;
      if (session.variants && data.selectedVariantId) {
        const variant = session.variants.find(v => v.id === data.selectedVariantId);
        if (variant) variant.selected = true;
      }
      break;

    case 'error':
      session.status = 'error';
      session.error = {
        code: data.errorCode || 'UNKNOWN',
        message: data.errorMessage || 'Unknown error',
        step: data.step,
      };
      break;

    case 'session_ended':
      session.status = data.status || 'completed';
      session.totalDurationMs = data.totalDurationMs;
      break;
  }

  // Save session
  const sessionContent = JSON.stringify(session, null, 2);
  await sessionFile.save(sessionContent, {
    contentType: 'application/json',
    resumable: false,
  });

  // Index session log as MonitorArtifact when shopId is provided
  // This makes session logs visible in the monitor UI
  if (data.shopId && eventType === 'session_ended') {
    try {
      // Store a copy in the main monitor bucket so MonitorArtifact URLs work
      await storeArtifact({
        shopId: data.shopId,
        requestId: data.requestId || data.sessionId,
        runId: data.runId,
        type: ArtifactType.SESSION_LOG,
        buffer: Buffer.from(sessionContent),
        contentType: 'application/json',
        retentionClass: RetentionClass.STANDARD,
        meta: {
          sessionId: data.sessionId,
          shop: data.shop,
          status: session.status,
          eventCount: session.events.length,
        },
      });
    } catch {
      // Ignore - artifact indexing is secondary
      console.warn('[SessionLogger] Failed to index session as artifact');
    }
  }

  // Update shop index (best effort)
  try {
    await updateSeeItNowShopIndex(bucket, data.shop, data.sessionId, session);
  } catch {
    // Ignore - shop index is secondary
  }
}

/**
 * Update the per-shop See It Now sessions index
 */
async function updateSeeItNowShopIndex(
  bucket: ReturnType<typeof getGcsClient>['bucket'] extends (name: string) => infer R ? R : never,
  shop: string,
  sessionId: string,
  session: SeeItNowSession
): Promise<void> {
  const shopIndexPath = `shops/${shop}/see-it-now-sessions.json`;
  const indexFile = bucket.file(shopIndexPath);

  interface ShopIndex {
    shop: string;
    totalSessions: number;
    sessions: Array<{
      sessionId: string;
      startedAt: string;
      status: SeeItNowSession['status'];
      variantCount: number;
      selectedVariant?: string;
    }>;
  }

  let index: ShopIndex;
  try {
    const [exists] = await indexFile.exists();
    if (exists) {
      const [content] = await indexFile.download();
      index = JSON.parse(content.toString());
    } else {
      index = { shop, totalSessions: 0, sessions: [] };
    }
  } catch {
    index = { shop, totalSessions: 0, sessions: [] };
  }

  // Update or add session entry
  const existingIdx = index.sessions.findIndex(s => s.sessionId === sessionId);
  const sessionEntry = {
    sessionId,
    startedAt: session.startedAt,
    status: session.status,
    variantCount: session.variants?.length || 0,
    selectedVariant: session.selectedVariant,
  };

  if (existingIdx >= 0) {
    index.sessions[existingIdx] = sessionEntry;
  } else {
    index.sessions.unshift(sessionEntry);
    index.totalSessions++;
  }

  // Keep only last 100 sessions per shop
  if (index.sessions.length > 100) {
    index.sessions = index.sessions.slice(0, 100);
  }

  await indexFile.save(JSON.stringify(index, null, 2), {
    contentType: 'application/json',
    resumable: false,
  });
}
type SessionStatus = 'in_progress' | 'complete' | 'failed' | 'abandoned';

interface StepData {
    // Common fields
    status?: 'success' | 'failed';
    durationMs?: number;
    processingTimeMs?: number;

    // Error info
    error?: {
        code: string;
        message: string;
        retryCount?: number;
    };

    // Room step
    imageBuffer?: Buffer;
    imageSize?: string;
    fileSize?: number;

    // Mask step
    maskBuffer?: Buffer;
    overlayBuffer?: Buffer;

    // Inpaint step
    inpaintBuffer?: Buffer;
    model?: string;

    // Placement step
    productId?: string;
    productTitle?: string;
    productBuffer?: Buffer;
    position?: { x: number; y: number };
    scale?: number;

    // Final step
    finalBuffer?: Buffer;
}

interface SessionMeta {
    sessionId: string;
    shop: string;
    userAgent?: string;
    device?: string;
    browser?: string;
    platform?: string;
    screenSize?: string;
    referrer?: string;
    productPageUrl?: string;
    startedAt: string;
    updatedAt: string;
    totalDurationMs?: number;
    status: SessionStatus;
    abandonedAt?: StepName;
    failedAt?: StepName;
    failureReason?: string;
    steps: StepEntry[];
    product?: {
        id?: string;
        title?: string;
        price?: string;
        hasAR?: boolean;
        isPrepared?: boolean;
    };
}

interface StepEntry {
    step: StepName;
    status: 'success' | 'failed';
    at: string;
    sinceStartMs?: number;
    sincePrevMs?: number;
    durationMs?: number;
    processingTimeMs?: number;
    file?: string;
    files?: string[];
    model?: string;
    metadata?: Record<string, unknown>;
    error?: {
        code: string;
        message: string;
        retryCount?: number;
    };
}

/**
 * Log a session step to GCS. Fire-and-forget - never await this.
 * 
 * @example
 * // In your route handler (do NOT await):
 * logSessionStep(roomSessionId, shop, 'room', { imageBuffer, imageSize: '1920x1080' });
 */
export function logSessionStep(
    sessionId: string,
    shop: string,
    step: StepName,
    data: StepData
): void {
    // Fire and forget - run in background
    doLogStep(sessionId, shop, step, data).catch((error) => {
        console.error('[SessionLogger] Failed to log step:', step, error?.message || error);
    });
}

/**
 * Internal async implementation
 */
async function doLogStep(
    sessionId: string,
    shop: string,
    step: StepName,
    data: StepData
): Promise<void> {
    const storage = getGcsClient();
    const bucket = storage.bucket(SESSION_BUCKET);
    const basePath = `sessions/${sessionId}`;
    const now = new Date().toISOString();

    // Read existing meta.json or create new
    let meta: SessionMeta;
    const metaFile = bucket.file(`${basePath}/meta.json`);

    try {
        const [exists] = await metaFile.exists();
        if (exists) {
            const [content] = await metaFile.download();
            meta = JSON.parse(content.toString());
        } else {
            meta = {
                sessionId,
                shop,
                startedAt: now,
                updatedAt: now,
                status: 'in_progress',
                steps: [],
            };
        }
    } catch {
        // Create fresh if can't read
        meta = {
            sessionId,
            shop,
            startedAt: now,
            updatedAt: now,
            status: 'in_progress',
            steps: [],
        };
    }

    // Calculate timing
    const startTime = new Date(meta.startedAt).getTime();
    const sinceStartMs = Date.now() - startTime;
    const lastStep = meta.steps[meta.steps.length - 1];
    const sincePrevMs = lastStep
        ? Date.now() - new Date(lastStep.at).getTime()
        : sinceStartMs;

    // Build step entry
    const stepEntry: StepEntry = {
        step,
        status: data.status || (data.error ? 'failed' : 'success'),
        at: now,
        sinceStartMs,
        sincePrevMs,
    };

    if (data.durationMs) stepEntry.durationMs = data.durationMs;
    if (data.processingTimeMs) stepEntry.processingTimeMs = data.processingTimeMs;
    if (data.model) stepEntry.model = data.model;
    if (data.error) stepEntry.error = data.error;

    // Upload files based on step type
    const uploadedFiles: string[] = [];

    try {
        if (step === 'room' && data.imageBuffer) {
            const filename = '01_room.jpg';
            await bucket.file(`${basePath}/${filename}`).save(data.imageBuffer, {
                contentType: 'image/jpeg',
                resumable: false,
            });
            uploadedFiles.push(filename);
            if (data.imageSize || data.fileSize) {
                stepEntry.metadata = { imageSize: data.imageSize, fileSize: data.fileSize };
            }
        }

        if (step === 'mask') {
            if (data.maskBuffer) {
                const maskFile = '02_mask.png';
                await bucket.file(`${basePath}/${maskFile}`).save(data.maskBuffer, {
                    contentType: 'image/png',
                    resumable: false,
                });
                uploadedFiles.push(maskFile);
            }
            if (data.overlayBuffer) {
                const overlayFile = '02_mask_overlay.jpg';
                await bucket.file(`${basePath}/${overlayFile}`).save(data.overlayBuffer, {
                    contentType: 'image/jpeg',
                    resumable: false,
                });
                uploadedFiles.push(overlayFile);
            }
        }

        if (step === 'inpaint' && data.inpaintBuffer) {
            const filename = '03_inpaint.jpg';
            await bucket.file(`${basePath}/${filename}`).save(data.inpaintBuffer, {
                contentType: 'image/jpeg',
                resumable: false,
            });
            uploadedFiles.push(filename);
        }

        if (step === 'placement') {
            if (data.productBuffer) {
                const productFile = '04_product.png';
                await bucket.file(`${basePath}/${productFile}`).save(data.productBuffer, {
                    contentType: 'image/png',
                    resumable: false,
                });
                uploadedFiles.push(productFile);
            }
            // Store placement metadata
            const placementData = {
                productId: data.productId,
                productTitle: data.productTitle,
                position: data.position,
                scale: data.scale,
            };
            const placementFile = '04_placement.json';
            await bucket.file(`${basePath}/${placementFile}`).save(
                JSON.stringify(placementData, null, 2),
                { contentType: 'application/json', resumable: false }
            );
            uploadedFiles.push(placementFile);

            // Store product info in meta
            if (data.productId || data.productTitle) {
                meta.product = {
                    id: data.productId,
                    title: data.productTitle,
                };
            }
        }

        if (step === 'final' && data.finalBuffer) {
            const filename = '05_final.jpg';
            await bucket.file(`${basePath}/${filename}`).save(data.finalBuffer, {
                contentType: 'image/jpeg',
                resumable: false,
            });
            uploadedFiles.push(filename);
        }
    } catch (uploadError) {
        console.error('[SessionLogger] File upload failed:', uploadError);
        // Continue anyway - we still want to update meta
    }

    // Set file references
    if (uploadedFiles.length === 1) {
        stepEntry.file = uploadedFiles[0];
    } else if (uploadedFiles.length > 1) {
        stepEntry.files = uploadedFiles;
    }

    // Update meta
    meta.steps.push(stepEntry);
    meta.updatedAt = now;
    meta.totalDurationMs = sinceStartMs;

    // Update status
    if (data.error) {
        meta.status = 'failed';
        meta.failedAt = step;
        meta.failureReason = data.error.code;
    } else if (step === 'final' && stepEntry.status === 'success') {
        meta.status = 'complete';
    }

    // Save meta.json
    await metaFile.save(JSON.stringify(meta, null, 2), {
        contentType: 'application/json',
        resumable: false,
    });

    // Update shop sessions index (best effort)
    try {
        await updateShopIndex(bucket, shop, sessionId, meta);
    } catch {
        // Ignore - shop index is secondary
    }
}

/**
 * Update the per-shop sessions index
 */
async function updateShopIndex(
    bucket: ReturnType<typeof getGcsClient>['bucket'] extends (name: string) => infer R ? R : never,
    shop: string,
    sessionId: string,
    meta: SessionMeta
): Promise<void> {
    const shopIndexPath = `shops/${shop}/sessions.json`;
    const indexFile = bucket.file(shopIndexPath);

    interface ShopIndex {
        shop: string;
        totalSessions: number;
        sessions: Array<{
            sessionId: string;
            startedAt: string;
            status: SessionStatus;
            stepsCompleted: number;
        }>;
    }

    let index: ShopIndex;
    try {
        const [exists] = await indexFile.exists();
        if (exists) {
            const [content] = await indexFile.download();
            index = JSON.parse(content.toString());
        } else {
            index = { shop, totalSessions: 0, sessions: [] };
        }
    } catch {
        index = { shop, totalSessions: 0, sessions: [] };
    }

    // Update or add session entry
    const existingIdx = index.sessions.findIndex(s => s.sessionId === sessionId);
    const sessionEntry = {
        sessionId,
        startedAt: meta.startedAt,
        status: meta.status,
        stepsCompleted: meta.steps.filter(s => s.status === 'success').length,
    };

    if (existingIdx >= 0) {
        index.sessions[existingIdx] = sessionEntry;
    } else {
        index.sessions.unshift(sessionEntry);
        index.totalSessions++;
    }

    // Keep only last 100 sessions per shop
    if (index.sessions.length > 100) {
        index.sessions = index.sessions.slice(0, 100);
    }

    await indexFile.save(JSON.stringify(index, null, 2), {
        contentType: 'application/json',
        resumable: false,
    });
}
