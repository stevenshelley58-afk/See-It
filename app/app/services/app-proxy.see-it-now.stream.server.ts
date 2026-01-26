// See It Now - Streaming Hero Shot Endpoint (SSE)
// Streams variant results as they complete so storefront can show images progressively.

import { type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkQuota, incrementQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import crypto from "crypto";
import { validateTrustedUrl } from "../utils/validate-shopify-url.server";
import { isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";
import { emit, EventSource, EventType, Severity } from "~/services/telemetry";
import {
  getOrRefreshGeminiFile,
  validateMagicBytes,
} from "../services/gemini-files.server";
import { getCorsHeaders } from "../utils/cors.server";
import {
  downloadAndProcessImage,
  downloadRawImage,
} from "../utils/image-download.server";

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

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

type ShopifyProductForPrompt = {
  title?: string | null;
  description?: string | null;
  descriptionHtml?: string | null;
  productType?: string | null;
  vendor?: string | null;
  tags?: string[] | null;
  images?: { edges?: Array<{ node?: { url?: string } }> } | null;
  metafields?: {
    edges?: Array<{
      node?: { namespace?: string; key?: string; value?: string };
    }>;
  } | null;
};

async function fetchShopifyProductForPrompt(
  shopDomain: string,
  accessToken: string,
  productId: string,
  requestId: string
): Promise<ShopifyProductForPrompt | null> {
  if (!accessToken || accessToken === "pending") return null;

  const endpoint = `https://${shopDomain}/admin/api/2025-01/graphql.json`;
  const query = `#graphql
    query GetProductForPrompt($id: ID!) {
      product(id: $id) {
        title
        description
        descriptionHtml
        productType
        vendor
        tags
        images(first: 3) {
          edges {
            node {
              url
            }
          }
        }
        metafields(first: 20) {
          edges {
            node {
              namespace
              key
              value
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query,
        variables: { id: `gid://shopify/Product/${productId}` },
      }),
    });

    if (!res.ok) {
      logger.warn(
        createLogContext("render", requestId, "shopify-product-fetch", {
          status: res.status,
          statusText: res.statusText,
        }),
        `Failed to fetch product from Shopify Admin API (HTTP ${res.status})`
      );
      return null;
    }

    const json = await res.json().catch(() => null);
    return (json?.data?.product as ShopifyProductForPrompt | undefined) || null;
  } catch (err) {
    logger.warn(
      createLogContext("render", requestId, "shopify-product-fetch", {
        error: err instanceof Error ? err.message : String(err),
      }),
      "Failed to fetch product from Shopify Admin API (network/parsing)"
    );
    return null;
  }
}

function sseHeaders(corsHeaders: Record<string, string>): HeadersInit {
  return {
    ...corsHeaders,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

type StandardErrorPayload = {
  code: string;
  message: string;
  requestId: string;
  runId: string | null;
};

type ProgressPayload = {
  total: 8;
  succeeded: number;
  failed: number;
  inFlight: number;
};

function toStandardErrorPayload(
  code: string,
  message: string,
  requestId: string,
  runId: string | null
): StandardErrorPayload {
  return { code, message, requestId, runId };
}

function createSerializedSseSender(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  isClosed: () => boolean
) {
  // Serialize writes so async callbacks can't interleave SSE frames.
  let queue = Promise.resolve();

  const enqueue = (text: string) => {
    queue = queue.then(() => {
      if (isClosed()) return;
      controller.enqueue(encoder.encode(text));
    });
  };

  const send = (event: string, data: unknown) => {
    enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const comment = (text: string) => {
    enqueue(`: ${text}\n\n`);
  };

  return { send, comment };
}

// ============================================================================
// GET /apps/see-it/see-it-now/stream?room_session_id=...&product_id=...
// ============================================================================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestId = getRequestId(request);
  const logContext = createLogContext("render", requestId, "see-it-now-start", {
    version: "see-it-now-stream",
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
    return new Response("forbidden", { status: 403, headers: corsHeaders });
  }

  // Allowlist
  if (!isSeeItNowAllowedShop(session.shop)) {
    return new Response("see_it_now_not_enabled", { status: 403, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const room_session_id = url.searchParams.get("room_session_id") || undefined;
  const product_id = url.searchParams.get("product_id") || undefined;

  if (!room_session_id) {
    return new Response("missing_room_session", { status: 400, headers: corsHeaders });
  }
  if (!product_id) {
    return new Response("missing_product_id", { status: 400, headers: corsHeaders });
  }

  // Rate limiting
  if (!checkRateLimit(room_session_id)) {
    return new Response("rate_limit_exceeded", { status: 429, headers: corsHeaders });
  }

  // Fetch shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, accessToken: true, shopDomain: true },
  });
  if (!shop) {
    logger.error(
      { ...logContext, stage: "shop-lookup" },
      `[See It Now] Shop not found: ${session.shop}`
    );
    return new Response("shop_not_found", { status: 404, headers: corsHeaders });
  }

  // Emit SF_RENDER_REQUESTED event (parity with non-stream endpoint)
  emit({
    shopId: shop.id,
    requestId,
    source: EventSource.APP_PROXY,
    type: EventType.SF_RENDER_REQUESTED,
    severity: Severity.INFO,
    payload: { productId: product_id, roomSessionId: room_session_id },
  });

  // Quota check
  try {
    await checkQuota(shop.id, "render", 1);
  } catch (error) {
    if (error instanceof Response) {
      const headers = { ...corsHeaders, "Content-Type": "text/plain" };
      return new Response(await error.text(), { status: error.status, headers });
    }
    throw error;
  }

  const startTime = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      let closed = false;
      const { send, comment } = createSerializedSseSender(
        controller,
        encoder,
        () => closed
      );

      const keepAlive = setInterval(() => {
        if (closed) return;
        comment("ping");
      }, 15000);

      const progress: ProgressPayload = {
        total: 8,
        succeeded: 0,
        failed: 0,
        inFlight: 0,
      };
      let progressTimer: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        if (progressTimer) clearInterval(progressTimer);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      // If client disconnects, stop writing (we do not cancel the underlying render)
      request.signal.addEventListener("abort", () => close(), { once: true });

      (async () => {
        let activeRunId: string | null = null;
        try {
          // Fetch RoomSession
          const roomSession = await prisma.roomSession.findUnique({
            where: { id: room_session_id },
          });
          if (!roomSession) {
            send(
              "error",
              toStandardErrorPayload(
                "room_not_found",
                "Room session not found",
                requestId,
                null
              )
            );
            close();
            return;
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
              preparedProductImageVersion: true,
              sourceImageUrl: true,
              status: true,
              geminiFileUri: true,
              geminiFileExpiresAt: true,
              extractedFacts: true,
              merchantOverrides: true,
              resolvedFacts: true,
              placementSet: true,
            },
          });

          if (!productAsset || productAsset.status !== "live") {
            send(
              "error",
              toStandardErrorPayload(
                "product_not_enabled",
                "This product is not enabled for See It visualization",
                requestId,
                null
              )
            );
            close();
            return;
          }

          let resolvedFacts = productAsset.resolvedFacts as ProductFacts | null;
          let placementSet = productAsset.placementSet as PlacementSet | null;

          // Fail-hard: pipeline data must already exist (no request-time backfill)
          if (!resolvedFacts || !placementSet) {
            send(
              "error",
              toStandardErrorPayload(
                "pipeline_not_ready",
                "Product prompt data is not ready. Re-run preparation to generate required pipeline fields.",
                requestId,
                null
              )
            );
            close();
            return;
          }

          // Room image URL (fail-hard: keys only; no legacy signed-URL fallbacks)
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
            send(
              "error",
              toStandardErrorPayload(
                "no_room_image",
                "No room image available",
                requestId,
                null
              )
            );
            close();
            return;
          }

          // Product image URL (fail-hard: preparedImageKey required; no URL fallbacks)
          if (!productAsset.preparedImageKey) {
            send(
              "error",
              toStandardErrorPayload(
                "no_prepared_product_image",
                "Prepared product image is missing. Re-run preparation.",
                requestId,
                null
              )
            );
            close();
            return;
          }

          const productImageUrl = await StorageService.getSignedReadUrl(
            productAsset.preparedImageKey,
            60 * 60 * 1000
          );

          // Download both images in parallel
          const [productImageData, roomImageData] = await Promise.all([
            downloadAndProcessImage(productImageUrl, logContext, 2048, "png"),
            roomImageSource === "canonical"
              ? (async () => {
                  const buffer = await downloadRawImage(roomImageUrl, logContext);
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
              : downloadAndProcessImage(roomImageUrl, logContext, 2048, "jpeg"),
          ]);

          validateMagicBytes(productImageData.buffer, "image/png");
          validateMagicBytes(roomImageData.buffer, "image/jpeg");

          // Optimize: Upload/Reuse Gemini Files
          const productFilename = `product-${productAsset.id}.png`;
          const roomFilename = `room-${roomSession.id}.jpg`;

          const [productGeminiFile, roomGeminiFile] = await Promise.all([
            getOrRefreshGeminiFile(
              productAsset.geminiFileUri,
              productAsset.geminiFileExpiresAt,
              productImageData.buffer,
              "image/png",
              productFilename,
              requestId
            ),
            getOrRefreshGeminiFile(
              roomSession.geminiFileUri,
              roomSession.geminiFileExpiresAt,
              roomImageData.buffer,
              "image/jpeg",
              roomFilename,
              requestId
            ),
          ]);

          // Fail-hard: DB updates must succeed (keep DB/image state consistent)
          const dbUpdates: Array<Promise<unknown>> = [];
          if (
            productGeminiFile.uri !== productAsset.geminiFileUri ||
            productGeminiFile.expiresAt.getTime() !==
              productAsset.geminiFileExpiresAt?.getTime()
          ) {
            dbUpdates.push(
              prisma.productAsset.update({
                where: { id: productAsset.id },
                data: {
                  geminiFileUri: productGeminiFile.uri,
                  geminiFileExpiresAt: productGeminiFile.expiresAt,
                },
              })
            );
          }

          if (
            roomGeminiFile.uri !== roomSession.geminiFileUri ||
            roomGeminiFile.expiresAt.getTime() !== roomSession.geminiFileExpiresAt?.getTime()
          ) {
            dbUpdates.push(
              prisma.roomSession.update({
                where: { id: roomSession.id },
                data: {
                  geminiFileUri: roomGeminiFile.uri,
                  geminiFileExpiresAt: roomGeminiFile.expiresAt,
                },
              })
            );
          }
          await Promise.all(dbUpdates);

          const renderInput: CompositeInput = {
            shopId: shop.id,
            productAssetId: productAsset.id,
            roomSessionId: room_session_id,
            traceId: requestId,
            productImage: {
              buffer: productImageData.buffer,
              hash: hashBuffer(productImageData.buffer),
              meta: productImageData.meta,
              ref: productGeminiFile.uri,
            },
            roomImage: {
              buffer: roomImageData.buffer,
              hash: hashBuffer(roomImageData.buffer),
              meta: roomImageData.meta,
              ref: roomGeminiFile.uri,
            },
            resolvedFacts,
            placementSet,
          };

          let firstImageSent = false;

          const result = await renderAllVariants(renderInput, {
            mode: "wait_all",
            onRunStarted: (info) => {
              activeRunId = info.runId;
              progress.succeeded = 0;
              progress.failed = 0;
              progress.inFlight = info.totalVariants;
              send("run_started", {
                run_id: info.runId,
                variant_count: info.totalVariants,
              });

              // Heartbeat progress every ~3s while rendering.
              if (!progressTimer) {
                progressTimer = setInterval(() => {
                  send("progress", { ...progress });
                }, 3000);
              }
              send("progress", { ...progress });
            },
            onVariantCompleted: async (v) => {
              // Maintain progress counts.
              if (v.status === "SUCCESS") progress.succeeded += 1;
              else progress.failed += 1;
              progress.inFlight = Math.max(0, progress.inFlight - 1);
              send("progress", { ...progress });

              // Stream only when we have an image URL, otherwise still inform client of failures/timeouts.
              if (v.status === "SUCCESS" && v.imageRef) {
                const imageUrl = await StorageService.getSignedReadUrl(
                  v.imageRef,
                  60 * 60 * 1000
                );

                send("variant", {
                  id: v.variantId,
                  status: v.status,
                  latency_ms: v.latencyMs,
                  image_url: imageUrl,
                });

                if (!firstImageSent && imageUrl) {
                  firstImageSent = true;
                  send("first_image", { run_id: activeRunId });
                }
              } else {
                send("variant", {
                  id: v.variantId,
                  status: v.status,
                  latency_ms: v.latencyMs,
                  error_message: v.errorMessage || null,
                });
              }
            },
          });

          // Increment quota ONCE for the entire batch (parity with non-stream route)
          await incrementQuota(shop.id, "render", 1);

          const durationMs = Date.now() - startTime;

          const successVariants = result.variants
            .filter((v) => v.status === "SUCCESS" && v.imageRef)
            .map((v) => v.variantId);

          send("complete", {
            run_id: result.runId,
            status: result.status,
            duration_ms: durationMs,
            success_variant_ids: successVariants,
          });
          close();
        } catch (e) {
          send(
            "error",
            toStandardErrorPayload(
              "generation_failed",
              e instanceof Error ? e.message : String(e),
              requestId,
              activeRunId
            )
          );
          close();
        }
      })();
    },
  });

  return new Response(stream, { headers: sseHeaders(corsHeaders) });
};

