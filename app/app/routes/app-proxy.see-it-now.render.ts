// See It Now - Hero Shot Generation Endpoint
// Uses 2-LLM pipeline: extractedFacts → resolvedFacts → promptPack → renderAllVariants
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
import { validateTrustedUrl } from "../utils/validate-shopify-url.server";
import { isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";
import { emit, EventSource, EventType } from "~/services/telemetry";
import {
  getOrRefreshGeminiFile,
  validateMagicBytes,
} from "../services/gemini-files.server";

// NEW: Import from 2-LLM pipeline
import {
  renderAllVariants,
  type RenderInput,
  type ProductPlacementFacts,
  type PromptPack,
  type ImageMeta,
  type ExtractionInput,
  extractProductFacts,
  resolveProductFacts,
  buildPromptPack,
  ensurePromptVersion,
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

// ============================================================================
// CORS Headers
// ============================================================================
function getCorsHeaders(shopDomain: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  };

  if (shopDomain) {
    headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
  }

  return headers;
}

// ============================================================================
// Image Download Helper
// ============================================================================
async function downloadToBuffer(
  url: string,
  logContext: ReturnType<typeof createLogContext>,
  maxDimension: number = 2048,
  format: "png" | "jpeg" = "png"
): Promise<{ buffer: Buffer; meta: ImageMeta }> {
  validateTrustedUrl(url, "image URL");

  logger.info(
    { ...logContext, stage: "download", format },
    `[See It Now] Downloading image: ${url.substring(0, 80)}...`
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  // Resize and normalize
  const pipeline = sharp(inputBuffer)
    .rotate() // Auto-orient based on EXIF
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

  const { data: buffer, info } =
    format === "png"
      ? await pipeline.png({ force: true }).toBuffer({ resolveWithObject: true })
      : await pipeline
          .jpeg({ quality: 90, force: true })
          .toBuffer({ resolveWithObject: true });

  // IMPORTANT: Use final encoded dimensions (post-resize) for meta
  const meta: ImageMeta = {
    width: info.width || 0,
    height: info.height || 0,
    bytes: buffer.length,
    format: format,
  };

  logger.info(
    { ...logContext, stage: "download" },
    `[See It Now] Downloaded & Optimized (${format}): ${buffer.length} bytes`
  );

  return { buffer, meta };
}

async function downloadRawToBuffer(
  url: string,
  logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
  validateTrustedUrl(url, "image URL");

  logger.info(
    { ...logContext, stage: "download-raw" },
    `[See It Now] Downloading raw image: ${url.substring(0, 80)}...`
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new Error("Downloaded image was empty");
  }
  return buffer;
}

/**
 * Hash a buffer using SHA256 (first 16 chars)
 */
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
  metafields?: { edges?: Array<{ node?: { namespace?: string; key?: string; value?: string } }> } | null;
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
    select: { id: true, accessToken: true, shopDomain: true },
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
      // NEW: 2-LLM pipeline fields
      resolvedFacts: true,
      promptPack: true,
      promptPackVersion: true,
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

  let resolvedFacts = productAsset.resolvedFacts as ProductPlacementFacts | null;
  let promptPack = productAsset.promptPack as PromptPack | null;
  let promptPackVersion = productAsset.promptPackVersion;

  // Validate pipeline data exists (attempt backfill for legacy assets)
  if (!resolvedFacts || !promptPack) {
    logger.warn(
      { ...shopLogContext, stage: "pipeline-check" },
      `[See It Now] Product ${product_id} missing pipeline data (resolvedFacts: ${!!resolvedFacts}, promptPack: ${!!promptPack})`
    );

    try {
      const shopifyProduct = shop.accessToken
        ? await fetchShopifyProductForPrompt(
            shop.shopDomain,
            shop.accessToken,
            product_id,
            requestId
          )
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
          const url = edge?.node?.url;
          if (url) uniqueImages.add(url);
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
        const extractedFacts = await extractProductFacts(extractionInput, requestId);
        const merchantOverrides = (productAsset.merchantOverrides as Record<string, unknown> | null) || null;
        resolvedFacts = resolveProductFacts(extractedFacts, merchantOverrides);
        promptPackVersion = await ensurePromptVersion();
        promptPack = await buildPromptPack(resolvedFacts, requestId);

        await prisma.productAsset.update({
          where: { id: productAsset.id },
          data: {
            extractedFacts,
            resolvedFacts,
            promptPack,
            promptPackVersion,
            extractedAt: new Date(),
            productTitle: shopifyProduct?.title || productAsset.productTitle || undefined,
            productType: shopifyProduct?.productType || productAsset.productType || undefined,
          },
        });

        logger.info(
          { ...shopLogContext, stage: "pipeline-backfill" },
          `[See It Now] Backfilled pipeline data for product ${product_id}`
        );
      }
    } catch (error) {
      const isExtractorInvalid =
        error instanceof Error && error.name === "ExtractorOutputError";

      if (isExtractorInvalid) {
        // Best-effort: persist a failure marker without changing schema.
        await prisma.productAsset
          .update({
            where: { id: productAsset.id },
            data: {
              errorMessage: `[See It Now] extraction_failed (requestId=${requestId}): ${error.message}`,
            },
          })
          .catch(() => {});
      }

      logger.warn(
        { ...shopLogContext, stage: "pipeline-backfill-error" },
        `[See It Now] Pipeline backfill failed for product ${product_id}: ${error instanceof Error ? error.message : String(error)}`
      );

      // Fail closed for malformed/invalid extractor output (do not silently degrade).
      if (isExtractorInvalid) {
        return json(
          {
            success: false,
            error: "pipeline_not_ready",
            message: "Product prompt extraction failed. Please try again later.",
            pipelineStatus: "extraction_failed",
            requestId,
          },
          { status: 422, headers: corsHeaders }
        );
      }
    }
  }

  if (!resolvedFacts || !promptPack) {
    return json(
      {
        success: false,
        error: "pipeline_not_ready",
        message:
          "Product prompt data is not ready. Please wait for processing to complete.",
        requestId,
      },
      { status: 422, headers: corsHeaders }
    );
  }

  // Get room image URL
  // FAST PATH: Prefer canonicalRoomImageKey (already rotated/resized JPEG from confirm route)
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
    roomImageUrl =
      roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl!;
    roomImageSource = "url";
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

  // Get product image URL
  let productImageUrl: string | null = null;
  if (productAsset.preparedImageKey) {
    try {
      productImageUrl = await StorageService.getSignedReadUrl(
        productAsset.preparedImageKey,
        60 * 60 * 1000
      );
    } catch {
      productImageUrl = productAsset.preparedImageUrl ?? null;
    }
  } else if (productAsset.preparedImageUrl) {
    productImageUrl = productAsset.preparedImageUrl;
  } else if (productAsset.sourceImageUrl) {
    productImageUrl = productAsset.sourceImageUrl;
  }

  if (!productImageUrl) {
    return errorJson(
      "no_product_image",
      "No product image available",
      requestId,
      corsHeaders,
      400,
      null
    );
  }

  logger.info(
    { ...shopLogContext, stage: "see-it-now-generate-start" },
    `[See It Now] Starting render for product ${product_id}`
  );

  try {
    // Download both images in parallel
    // Product is forced to PNG (cutout), Room is JPEG (photograph)
    const [productImageData, roomImageData] = await Promise.all([
      downloadToBuffer(productImageUrl, shopLogContext, 2048, "png"),
      roomImageSource === "canonical"
        ? (async () => {
            const buffer = await downloadRawToBuffer(roomImageUrl, shopLogContext);
            return {
              buffer,
              meta: {
                width: roomSession.canonicalRoomWidth || 0,
                height: roomSession.canonicalRoomHeight || 0,
                bytes: buffer.length,
                format: "jpeg",
              },
            };
          })()
        : downloadToBuffer(roomImageUrl, shopLogContext, 2048, "jpeg"),
    ]);

    // Hard guard: magic bytes validation (prevents MIME/bytes mismatch corruption)
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
      )
    ]);

    // Update DB with new/refreshed URIs (fire and forget or await)
    const dbUpdates = [];
    if (productGeminiFile.uri !== productAsset.geminiFileUri ||
      productGeminiFile.expiresAt.getTime() !== productAsset.geminiFileExpiresAt?.getTime()) {
      dbUpdates.push(
        prisma.productAsset.update({
          where: { id: productAsset.id },
          data: {
            geminiFileUri: productGeminiFile.uri,
            geminiFileExpiresAt: productGeminiFile.expiresAt
          }
        })
      );
    }

    if (roomGeminiFile.uri !== roomSession.geminiFileUri ||
      roomGeminiFile.expiresAt.getTime() !== roomSession.geminiFileExpiresAt?.getTime()) {
      dbUpdates.push(
        prisma.roomSession.update({
          where: { id: roomSession.id },
          data: {
            geminiFileUri: roomGeminiFile.uri,
            geminiFileExpiresAt: roomGeminiFile.expiresAt
          }
        })
      );
    }

    // Don't block rendering on DB updates
    Promise.all(dbUpdates).catch(err => {
      logger.error({ ...shopLogContext, stage: "db-update-error" }, "Failed to update Gemini URIs in DB", err);
    });

    // Build render input with Gemini URIs
    const renderInput: RenderInput = {
      shopId: shop.id,
      productAssetId: productAsset.id,
      roomSessionId: room_session_id,
      requestId,
      productImage: {
        buffer: productImageData.buffer,
        hash: hashBuffer(productImageData.buffer),
        meta: productImageData.meta,
        geminiUri: productGeminiFile.uri,
      },
      roomImage: {
        buffer: roomImageData.buffer,
        hash: hashBuffer(roomImageData.buffer),
        meta: roomImageData.meta,
        geminiUri: roomGeminiFile.uri,
      },
      resolvedFacts,
      promptPack,
      promptPackVersion,
    };

    // Call the new renderer
    const result = await renderAllVariants(renderInput);

    // Increment quota ONCE for the entire batch
    await incrementQuota(shop.id, "render", 1);

    const duration = Date.now() - startTime;

    // Build response variants with signed URLs
    const responseVariants = await Promise.all(
      result.variants
        .filter((v) => v.status === "success" && v.imageKey)
        .map(async (v) => ({
          id: v.variantId,
          image_url: await StorageService.getSignedReadUrl(
            v.imageKey!,
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
  }
};

// Handle OPTIONS for CORS preflight
export const loader = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const corsHeaders = getCorsHeaders(session?.shop ?? null);

  return new Response(null, { status: 204, headers: corsHeaders });
};
