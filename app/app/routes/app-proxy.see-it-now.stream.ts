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
import sharp from "sharp";
import crypto from "crypto";
import { isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";
import { emit, EventSource, EventType, Severity } from "~/services/telemetry";
import { getCorsHeaders } from "../services/cors.server";
import { fetchShopifyProductForPrompt } from "../services/shopify-product.server";
import { downloadAndProcessImage, downloadRawImage } from "../services/image-download.server";
import {
  getOrRefreshGeminiFile,
  isGeminiFileValid,
  validateMagicBytes,
} from "../services/gemini-files.server";
import { selectPreparedImage } from "../services/product-asset/select-prepared-image.server";

const FILES_API_SAFE_MODE_AVOIDABLE_DOWNLOAD_EVENT_TYPE =
  "sf_files_api_safe_mode_avoidable_download_ms";

import {
  renderAllVariants,
  type CompositeInput,
  type ProductFacts,
  type PlacementSet,
  type ExtractionInput,
  extractProductFacts,
  resolveProductFacts,
  buildPlacementSet,
} from "../services/see-it-now/index";

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

// (Shopify product fetching is in ../services/shopify-product.server.ts)

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
    queue.catch(() => {});
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
    version: "see-it-now-v2-stream",
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
        let filesApiSafeModeTelemetryPayload: Record<string, unknown> | null = null;
        let filesApiSafeModeTelemetryRunId: string | undefined;
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

            // Validate pipeline data exists (attempt backfill for legacy assets)
            if (!resolvedFacts || !placementSet) {
              try {
              const shopifyProduct = shop.accessToken
                ? await fetchShopifyProductForPrompt({
                    flow: "render",
                    shopDomain: shop.shopDomain,
                    accessToken: shop.accessToken,
                    productId: product_id,
                    requestId,
                  })
                : null;

              const metafieldText = Array.isArray(shopifyProduct?.metafields?.edges)
                ? shopifyProduct!.metafields!.edges!
                    .map((e) => e?.node?.value)
                    .filter(Boolean)
                    .join(" ")
                : "";

              const combinedDescription = `${shopifyProduct?.description || ""}\n${shopifyProduct?.descriptionHtml || ""}\n${metafieldText}`.trim();

              const metafieldsRecord: Record<string, string> = {};
              if (Array.isArray(shopifyProduct?.metafields?.edges)) {
                for (const edge of shopifyProduct!.metafields!.edges!) {
                  const node = edge?.node;
                  if (node?.namespace && node?.key && node?.value) {
                    metafieldsRecord[`${node.namespace}.${node.key}`] = node.value;
                  }
                }
              }

              const uniqueImages = new Set<string>();
              if (productAsset.sourceImageUrl) uniqueImages.add(productAsset.sourceImageUrl);
              if (productAsset.preparedImageUrl) uniqueImages.add(productAsset.preparedImageUrl);

              if (Array.isArray(shopifyProduct?.images?.edges)) {
                for (const edge of shopifyProduct!.images!.edges!) {
                  const u = edge?.node?.url;
                  if (u) uniqueImages.add(u);
                  if (uniqueImages.size >= 3) break;
                }
              }

              const extractionInput: ExtractionInput = {
                title:
                  shopifyProduct?.title ||
                  productAsset.productTitle ||
                  `Product ${product_id}`,
                description: combinedDescription || "",
                productType: shopifyProduct?.productType || productAsset.productType || null,
                vendor: shopifyProduct?.vendor || null,
                tags: (shopifyProduct?.tags || []) as string[],
                metafields: metafieldsRecord,
                imageUrls: Array.from(uniqueImages),
              };

              if (extractionInput.title && extractionInput.imageUrls.length > 0) {
                const extractedFacts = await extractProductFacts({
                  input: extractionInput,
                  productAssetId: productAsset.id,
                  shopId: shop.id,
                  traceId: requestId,
                });
                const merchantOverrides =
                  (productAsset.merchantOverrides as Record<string, unknown> | null) ||
                  null;
                resolvedFacts = resolveProductFacts(extractedFacts, merchantOverrides);
                placementSet = await buildPlacementSet({
                  resolvedFacts,
                  productAssetId: productAsset.id,
                  shopId: shop.id,
                  traceId: requestId,
                });

                await prisma.productAsset.update({
                  where: { id: productAsset.id },
                  data: {
                    extractedFacts,
                    resolvedFacts,
                    placementSet,
                    extractedAt: new Date(),
                    productTitle: shopifyProduct?.title || productAsset.productTitle || undefined,
                    productType: shopifyProduct?.productType || productAsset.productType || undefined,
                  },
                });
              }
            } catch (e) {
              const isExtractorInvalid =
                e instanceof Error && e.name === "ExtractorOutputError";

              if (isExtractorInvalid) {
                // Best-effort: persist a failure marker without changing schema.
                await prisma.productAsset
                  .update({
                    where: { id: productAsset.id },
                    data: {
                      errorMessage: `[See It Now] extraction_failed (requestId=${requestId}): ${e.message}`,
                    },
                  })
                  .catch(() => {});
              }

              logger.warn(
                { ...logContext, stage: "pipeline-backfill-error" },
                `[See It Now] Pipeline backfill failed: ${
                  e instanceof Error ? e.message : String(e)
                }`
              );

              // Fail closed for malformed/invalid extractor output (do not silently degrade).
              if (isExtractorInvalid) {
                send(
                  "error",
                  toStandardErrorPayload(
                    "pipeline_not_ready",
                    "Product prompt extraction failed. Please try again later.",
                    requestId,
                    null
                  )
                );
                close();
                return;
              }
            }
          }

          if (!resolvedFacts || !placementSet) {
            send(
              "error",
              toStandardErrorPayload(
                "pipeline_not_ready",
                "Product prompt data is not ready. Please try again.",
                requestId,
                null
              )
            );
            close();
            return;
          }

          // Room image URL - prefer canonical
          let roomImageUrl: string;
          let roomImageSource: "canonical" | "cleaned" | "original" | "url" = "url";
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
          } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
            roomImageUrl = roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl!;
            roomImageSource = "url";
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

          // Product image URL
          let productImageUrl: string | null = null;
          const selected = selectPreparedImage(productAsset);
          if (selected?.key) {
            if (selected.key.startsWith("http://") || selected.key.startsWith("https://")) {
              productImageUrl = selected.key;
            } else {
              try {
                productImageUrl = await StorageService.getSignedReadUrl(
                  selected.key,
                  60 * 60 * 1000
                );
              } catch {
                productImageUrl = productAsset.preparedImageUrl ?? null;
              }
            }
          } else if (productAsset.sourceImageUrl) {
            productImageUrl = productAsset.sourceImageUrl;
          }

          if (!productImageUrl) {
            send(
              "error",
              toStandardErrorPayload(
                "no_product_image",
                "No product image available",
                requestId,
                null
              )
            );
            close();
            return;
          }

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
                  avoidableDownloadMs: 0,
                };
              }

              const downloadStart = Date.now();
              const imageData = await downloadAndProcessImage(productImageUrl, logContext, {
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
                  avoidableDownloadMs: 0,
                };
              }

              const downloadStart = Date.now();
              const imageData =
                roomImageSource === "canonical"
                  ? await (async () => {
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
                  : await downloadAndProcessImage(roomImageUrl, logContext, {
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
                avoidableDownloadMs: roomGeminiUriValid ? downloadMs : 0,
              };
            })(),
          ]);

          // Update DB with new/refreshed URIs (non-blocking)
          const dbUpdates: Array<Promise<unknown>> = [];
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
              })
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
              })
            );
          }
          Promise.all(dbUpdates).catch(() => {});

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

          let firstImageSent = false;

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
                let imageUrl: string | null = null;
                try {
                  imageUrl = await StorageService.getSignedReadUrl(
                    v.imageRef,
                    60 * 60 * 1000
                  );
                } catch {
                  imageUrl = null;
                }

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
          filesApiSafeModeTelemetryRunId = result.runId;

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
        finally {
          if (filesApiSafeModeTelemetryPayload) {
            emit({
              shopId: shop.id,
              requestId,
              runId: filesApiSafeModeTelemetryRunId ?? activeRunId ?? undefined,
              source: EventSource.APP_PROXY,
              type: FILES_API_SAFE_MODE_AVOIDABLE_DOWNLOAD_EVENT_TYPE,
              severity: Severity.INFO,
              payload: filesApiSafeModeTelemetryPayload,
            });
          }
        }
      })();
    },
  });

  return new Response(stream, { headers: sseHeaders(corsHeaders) });
};
