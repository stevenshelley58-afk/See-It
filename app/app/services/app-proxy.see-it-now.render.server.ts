// See It Now - Hero Shot Generation Endpoint
// Uses 2-LLM pipeline: extractedFacts → resolvedFacts → placementSet → renderAllVariants
//
// Access: Only shops in SEE_IT_NOW_ALLOWED_SHOPS can use this feature

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkQuota, incrementQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import sharp from "sharp";
import crypto from "crypto";
import { isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";
import { emit, EventSource, EventType } from "~/services/telemetry";
import { getCorsHeaders } from "./cors.server";
import { downloadAndProcessImage, downloadRawImage } from "./image-download.server";
import {
  getOrRefreshGeminiFile,
  isGeminiFileValid,
  validateMagicBytes,
} from "../services/gemini-files.server";

const FILES_API_SAFE_MODE_AVOIDABLE_DOWNLOAD_EVENT_TYPE =
  "sf_files_api_safe_mode_avoidable_download_ms";

// Import from 2-LLM pipeline
import {
  renderAllVariants,
  type CompositeInput,
  type ProductFacts,
  type PlacementSet,
  type ImageMeta,
  type ExtractionInput,
  extractProductFacts,
  resolveProductFacts,
  buildPlacementSet,
} from "../services/see-it-now/index";

// ============================================================================
// Error Response Helper
// ============================================================================
function errorJson(
  error: string,
  message: string,
  requestId: string,
  headers: Record<string, string>,
  status: number = 400,
  _extra: unknown = null
) {
  return json(
    {
      success: false,
      error,
      message,
      request_id: requestId,
    },
    { status, headers }
  );
}

/**
 * Hash a buffer using SHA256 (first 16 chars)
 */
function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

// (Shopify product fetching moved to ~/services/shopify-product.server.ts)

// ============================================================================
// Main Action Handler
// ============================================================================
export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = getRequestId(request);
  const logContext = createLogContext("render", requestId, "see-it-now-start", {
    version: "see-it-now-v2",
  });

  const { session } = await authenticate.public.appProxy(request);
  const corsHeaders = getCorsHeaders(session?.shop ?? null);

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!session) {
    logger.warn(
      { ...logContext, stage: "auth" },
      `[See It Now] App proxy auth failed: no session`
    );
    return errorJson("forbidden", "Forbidden", requestId, corsHeaders, 403, null);
  }

  // ============================================================================
  // SEE IT NOW ALLOWLIST CHECK
  // ============================================================================
  if (!isSeeItNowAllowedShop(session.shop)) {
    logger.info(
      { ...logContext, stage: "allowlist", shop: session.shop },
      `[See It Now] Shop not in allowlist`
    );
    return errorJson(
      "see_it_now_not_enabled",
      "See It Now features are not enabled for this shop",
      requestId,
      corsHeaders,
      403,
      null
    );
  }

  const startTime = Date.now();
  let body: { room_session_id?: string; product_id?: string };

  try {
    body = await request.json();
  } catch {
    return errorJson(
      "invalid_json",
      "Request body must be valid JSON",
      requestId,
      corsHeaders,
      400,
      null
    );
  }

  const { room_session_id, product_id } = body;

  // Validate required fields
  if (!room_session_id) {
    return errorJson(
      "missing_room_session",
      "room_session_id is required",
      requestId,
      corsHeaders,
      400,
      null
    );
  }

  if (!product_id) {
    return errorJson(
      "missing_product_id",
      "product_id is required",
      requestId,
      corsHeaders,
      400,
      null
    );
  }

  // Rate limiting
  if (!checkRateLimit(room_session_id)) {
    return errorJson(
      "rate_limit_exceeded",
      "Too many requests. Please wait a moment.",
      requestId,
      corsHeaders,
      429,
      null
    );
  }

  // Fetch shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      accessToken: true,
      shopDomain: true,
      runtimeConfig: {
        select: { skipGcsDownloadWhenGeminiUriValid: true },
      },
    },
  });
  if (!shop) {
    logger.error(
      { ...logContext, stage: "shop-lookup" },
      `[See It Now] Shop not found: ${session.shop}`
    );
    return errorJson(
      "shop_not_found",
      "Shop not found",
      requestId,
      corsHeaders,
      404,
      null
    );
  }

  const shopLogContext = {
    ...logContext,
    shopId: shop.id,
    productId: product_id,
  };

  // Emit SF_RENDER_REQUESTED event
  emit({
    shopId: shop.id,
    requestId,
    source: EventSource.APP_PROXY,
    type: EventType.SF_RENDER_REQUESTED,
    payload: {
      productId: product_id,
      roomSessionId: room_session_id,
    },
  });

  // Quota check
  try {
    await checkQuota(shop.id, "render", 1);
  } catch (error) {
    if (error instanceof Response) {
      const headers = { ...corsHeaders, "Content-Type": "application/json" };
      return new Response(error.body, { status: error.status, headers });
    }
    throw error;
  }

  // Fetch RoomSession
  const roomSession = await prisma.roomSession.findUnique({
    where: { id: room_session_id },
  });

  if (!roomSession) {
    return errorJson(
      "room_not_found",
      "Room session not found",
      requestId,
      corsHeaders,
      404,
      null
    );
  }

  // Fetch ProductAsset with NEW pipeline fields
  const productAsset = await prisma.productAsset.findFirst({
    where: { shopId: shop.id, productId: product_id },
    select: {
      id: true,
      productTitle: true,
      productType: true,
      preparedImageUrl: true,
      preparedImageKey: true,
      sourceImageUrl: true,
      status: true,
      geminiFileUri: true,
      geminiFileExpiresAt: true,
      extractedFacts: true,
      merchantOverrides: true,
      // 2-LLM pipeline fields (canonical)
      resolvedFacts: true,
      placementSet: true,
    },
  });

  // Verify product is enabled for See It
  if (!productAsset || productAsset.status !== "live") {
    logger.warn(
      { ...shopLogContext, stage: "product-check" },
      `[See It Now] Product ${product_id} not enabled (status: ${productAsset?.status || "no asset"})`
    );

    return json(
      {
        success: false,
        error: "product_not_enabled",
        message: "This product is not enabled for See It visualization",
      },
      { headers: corsHeaders }
    );
  }

  let resolvedFacts = productAsset.resolvedFacts as ProductFacts | null;
  let placementSet = productAsset.placementSet as PlacementSet | null;

  // Fail-hard: pipeline data must already exist (no request-time backfill)
  if (!resolvedFacts || !placementSet) {
    return json(
      {
        success: false,
        error: "pipeline_not_ready",
        message:
          "Product prompt data is not ready. Re-run preparation to generate required pipeline fields.",
        requestId,
      },
      { status: 422, headers: corsHeaders }
    );
  }

  // Get room image URL
  // FAST PATH: Prefer canonicalRoomImageKey (already rotated/resized JPEG from confirm route)
  let roomImageUrl: string;
  let roomImageSource: "canonical" | "cleaned" | "original" = "canonical";
  if (roomSession.canonicalRoomImageKey) {
    roomImageUrl = await StorageService.getSignedReadUrl(
      roomSession.canonicalRoomImageKey,
      60 * 60 * 1000
    );
    roomImageSource = "canonical";
  } else if (roomSession.cleanedRoomImageKey) {
    roomImageUrl = await StorageService.getSignedReadUrl(
      roomSession.cleanedRoomImageKey,
      60 * 60 * 1000
    );
    roomImageSource = "cleaned";
  } else if (roomSession.originalRoomImageKey) {
    roomImageUrl = await StorageService.getSignedReadUrl(
      roomSession.originalRoomImageKey,
      60 * 60 * 1000
    );
    roomImageSource = "original";
  } else {
    return errorJson(
      "no_room_image",
      "No room image available",
      requestId,
      corsHeaders,
      400,
      null
    );
  }

  // Get product image URL (fail-hard: preparedImageKey required; no URL fallbacks)
  if (!productAsset.preparedImageKey) {
    return errorJson(
      "no_prepared_product_image",
      "Prepared product image is missing. Re-run preparation.",
      requestId,
      corsHeaders,
      422,
      null
    );
  }

  const productImageUrl = await StorageService.getSignedReadUrl(
    productAsset.preparedImageKey,
    60 * 60 * 1000
  );

  logger.info(
    { ...shopLogContext, stage: "see-it-now-generate-start" },
    `[See It Now] Starting render for product ${product_id}`
  );

  let filesApiSafeModeTelemetryPayload: Record<string, unknown> | null = null;
  let filesApiSafeModeTelemetryRunId: string | undefined;

  try {
    const skipGcsDownloadWhenGeminiUriValid =
      shop.runtimeConfig?.skipGcsDownloadWhenGeminiUriValid ?? false;

    const productGeminiUriValid =
      !!productAsset.geminiFileUri &&
      isGeminiFileValid(productAsset.geminiFileExpiresAt);
    const roomGeminiUriValid =
      !!roomSession.geminiFileUri && isGeminiFileValid(roomSession.geminiFileExpiresAt);

    const productFilename = `product-${productAsset.id}.png`;
    const roomFilename = `room-${roomSession.id}.jpg`;

    const [productPrepared, roomPrepared] = await Promise.all([
      (async () => {
        if (skipGcsDownloadWhenGeminiUriValid && productGeminiUriValid) {
          const ref = productAsset.geminiFileUri!;
          return {
            image: {
              buffer: Buffer.alloc(0),
              hash: hashBuffer(Buffer.from(ref)),
              meta: { width: 0, height: 0, bytes: 0, format: "png" as const },
              ref,
            },
            geminiFile: {
              uri: ref,
              expiresAt: productAsset.geminiFileExpiresAt!,
            },
            downloadMs: 0,
            avoidableDownloadMs: 0,
          };
        }

        const downloadStart = Date.now();
        const imageData = await downloadAndProcessImage(productImageUrl, shopLogContext, {
          maxDimension: 2048,
          format: "png",
        });
        const downloadMs = Date.now() - downloadStart;

        validateMagicBytes(imageData.buffer, "image/png");

        const geminiFile = await getOrRefreshGeminiFile(
          productAsset.geminiFileUri,
          productAsset.geminiFileExpiresAt,
          imageData.buffer,
          "image/png",
          productFilename,
          requestId
        );

        return {
          image: {
            buffer: imageData.buffer,
            hash: hashBuffer(imageData.buffer),
            meta: imageData.meta,
            ref: geminiFile.uri,
          },
          geminiFile,
          downloadMs,
          avoidableDownloadMs: productGeminiUriValid ? downloadMs : 0,
        };
      })(),
      (async () => {
        if (skipGcsDownloadWhenGeminiUriValid && roomGeminiUriValid) {
          const ref = roomSession.geminiFileUri!;
          return {
            image: {
              buffer: Buffer.alloc(0),
              hash: hashBuffer(Buffer.from(ref)),
              meta: {
                width: roomSession.canonicalRoomWidth || 0,
                height: roomSession.canonicalRoomHeight || 0,
                bytes: 0,
                format: "jpeg" as const,
              },
              ref,
            },
            geminiFile: {
              uri: ref,
              expiresAt: roomSession.geminiFileExpiresAt!,
            },
            downloadMs: 0,
            avoidableDownloadMs: 0,
          };
        }

        const downloadStart = Date.now();
        const imageData =
          roomImageSource === "canonical"
            ? await (async () => {
                const buffer = await downloadRawImage(roomImageUrl, shopLogContext);
                return {
                  buffer,
                  meta: {
                    width: roomSession.canonicalRoomWidth || 0,
                    height: roomSession.canonicalRoomHeight || 0,
                    bytes: buffer.length,
                    format: "jpeg" as const,
                  },
                };
              })()
            : await downloadAndProcessImage(roomImageUrl, shopLogContext, {
                maxDimension: 2048,
                format: "jpeg",
              });
        const downloadMs = Date.now() - downloadStart;

        validateMagicBytes(imageData.buffer, "image/jpeg");

        const geminiFile = await getOrRefreshGeminiFile(
          roomSession.geminiFileUri,
          roomSession.geminiFileExpiresAt,
          imageData.buffer,
          "image/jpeg",
          roomFilename,
          requestId
        );

        return {
          image: {
            buffer: imageData.buffer,
            hash: hashBuffer(imageData.buffer),
            meta: imageData.meta,
            ref: geminiFile.uri,
          },
          geminiFile,
          downloadMs,
          avoidableDownloadMs: roomGeminiUriValid ? downloadMs : 0,
        };
      })(),
    ]);

    const avoidableDownloadMsTotal =
      productPrepared.avoidableDownloadMs + roomPrepared.avoidableDownloadMs;

    if (avoidableDownloadMsTotal > 0) {
      filesApiSafeModeTelemetryPayload = {
        avoidable_download_ms_total: avoidableDownloadMsTotal,
        avoidable_download_ms_product: productPrepared.avoidableDownloadMs,
        avoidable_download_ms_room: roomPrepared.avoidableDownloadMs,
        product_gemini_uri_valid: productGeminiUriValid,
        room_gemini_uri_valid: roomGeminiUriValid,
        skip_gcs_download_when_gemini_uri_valid: skipGcsDownloadWhenGeminiUriValid,
        room_image_source: roomImageSource,
      };
    }

    // Update DB with new/refreshed URIs
    const dbUpdates = [];
    if (
      productPrepared.geminiFile.uri !== productAsset.geminiFileUri ||
      productPrepared.geminiFile.expiresAt.getTime() !==
        productAsset.geminiFileExpiresAt?.getTime()
    ) {
      dbUpdates.push(
        prisma.productAsset.update({
          where: { id: productAsset.id },
          data: {
            geminiFileUri: productPrepared.geminiFile.uri,
            geminiFileExpiresAt: productPrepared.geminiFile.expiresAt,
          },
        }),
      );
    }
 
    if (
      roomPrepared.geminiFile.uri !== roomSession.geminiFileUri ||
      roomPrepared.geminiFile.expiresAt.getTime() !==
        roomSession.geminiFileExpiresAt?.getTime()
    ) {
      dbUpdates.push(
        prisma.roomSession.update({
          where: { id: roomSession.id },
          data: {
            geminiFileUri: roomPrepared.geminiFile.uri,
            geminiFileExpiresAt: roomPrepared.geminiFile.expiresAt,
          },
        }),
      );
    }
 
    // Fail-hard: DB updates must succeed (keep DB/image state consistent)
    await Promise.all(dbUpdates);
 
    // Build render input with Gemini URIs
    const renderInput: CompositeInput = {
      shopId: shop.id,
      productAssetId: productAsset.id,
      roomSessionId: room_session_id,
      traceId: requestId,
      productImage: {
        buffer: productPrepared.image.buffer,
        hash: productPrepared.image.hash,
        meta: productPrepared.image.meta,
        ref: productPrepared.image.ref,
      },
      roomImage: {
        buffer: roomPrepared.image.buffer,
        hash: roomPrepared.image.hash,
        meta: roomPrepared.image.meta,
        ref: roomPrepared.image.ref,
      },
      resolvedFacts,
      placementSet,
    };

    // Call the new renderer
    const result = await renderAllVariants(renderInput);
    filesApiSafeModeTelemetryRunId = result.runId;

    // Increment quota ONCE for the entire batch
    await incrementQuota(shop.id, "render", 1);

    const duration = Date.now() - startTime;

    // Build response variants with signed URLs
    const responseVariants = await Promise.all(
      result.variants
        .filter((v) => v.status === "SUCCESS" && v.imageRef)
        .map(async (v) => ({
          id: v.variantId,
          image_url: await StorageService.getSignedReadUrl(
            v.imageRef!,
            60 * 60 * 1000
          ),
          latency_ms: v.latencyMs,
        }))
    );

    if (responseVariants.length === 0) {
      return errorJson(
        "all_variants_failed",
        "Failed to generate any variants",
        requestId,
        corsHeaders,
        422,
        result.runId
      );
    }

    logger.info(
      {
        ...shopLogContext,
        stage: "see-it-now-complete",
        durationMs: duration,
        variantCount: responseVariants.length,
      },
      `[See It Now] Render completed: ${responseVariants.length}/8 variants in ${duration}ms`
    );

    return json(
      {
        run_id: result.runId,
        status: result.status,
        variants: responseVariants,
        duration_ms: duration,
        version: "see-it-now-v2",
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { ...shopLogContext, stage: "see-it-now-error" },
      `[See It Now] Render failed`,
      error
    );

    return errorJson(
      "generation_failed",
      errorMessage,
      requestId,
      corsHeaders,
      422,
      null
    );
  } finally {
    if (filesApiSafeModeTelemetryPayload) {
      emit({
        shopId: shop.id,
        requestId,
        runId: filesApiSafeModeTelemetryRunId,
        source: EventSource.APP_PROXY,
        type: FILES_API_SAFE_MODE_AVOIDABLE_DOWNLOAD_EVENT_TYPE,
        payload: filesApiSafeModeTelemetryPayload,
      });
    }
  }
};

// Handle OPTIONS for CORS preflight
export const loader = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const corsHeaders = getCorsHeaders(session?.shop ?? null);

  return new Response(null, { status: 204, headers: corsHeaders });
};

