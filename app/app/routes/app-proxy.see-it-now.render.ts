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
import { logSeeItNowEvent } from "~/services/session-logger.server";

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
  maxDimension: number = 2048
): Promise<{ buffer: Buffer; meta: ImageMeta }> {
  validateTrustedUrl(url, "image URL");

  logger.info(
    { ...logContext, stage: "download" },
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

  // Get metadata before resize
  const metadata = await sharp(inputBuffer).metadata();

  // Resize and normalize
  const buffer = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ force: true })
    .toBuffer();

  const meta: ImageMeta = {
    width: metadata.width || 0,
    height: metadata.height || 0,
    bytes: buffer.length,
    format: "png",
  };

  logger.info(
    { ...logContext, stage: "download" },
    `[See It Now] Downloaded & Optimized: ${buffer.length} bytes`
  );

  return { buffer, meta };
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
    return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
  }

  // ============================================================================
  // SEE IT NOW ALLOWLIST CHECK
  // ============================================================================
  if (!isSeeItNowAllowedShop(session.shop)) {
    logger.info(
      { ...logContext, stage: "allowlist", shop: session.shop },
      `[See It Now] Shop not in allowlist`
    );
    return json(
      {
        error: "see_it_now_not_enabled",
        message: "See It Now features are not enabled for this shop",
      },
      { status: 403, headers: corsHeaders }
    );
  }

  const startTime = Date.now();
  let body: { room_session_id?: string; product_id?: string };

  try {
    body = await request.json();
  } catch {
    return json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      { status: 400, headers: corsHeaders }
    );
  }

  const { room_session_id, product_id } = body;

  // Validate required fields
  if (!room_session_id) {
    return json(
      { error: "missing_room_session", message: "room_session_id is required" },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!product_id) {
    return json(
      { error: "missing_product_id", message: "product_id is required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Rate limiting
  if (!checkRateLimit(room_session_id)) {
    return json(
      {
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait a moment.",
      },
      { status: 429, headers: corsHeaders }
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
    return json(
      { error: "shop_not_found" },
      { status: 404, headers: corsHeaders }
    );
  }

  const shopLogContext = {
    ...logContext,
    shopId: shop.id,
    productId: product_id,
  };

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
    return json(
      { error: "room_not_found", message: "Room session not found" },
      { status: 404, headers: corsHeaders }
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
        title: shopifyProduct?.title || productAsset.productTitle || "",
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
      logger.warn(
        { ...shopLogContext, stage: "pipeline-backfill-error" },
        `[See It Now] Pipeline backfill failed for product ${product_id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (!resolvedFacts || !promptPack) {
    return json(
      {
        success: false,
        error: "pipeline_not_ready",
        message:
          "Product prompt data is not ready. Please wait for processing to complete.",
      },
      { status: 422, headers: corsHeaders }
    );
  }

  // Get room image URL
  let roomImageUrl: string;
  if (roomSession.cleanedRoomImageKey) {
    roomImageUrl = await StorageService.getSignedReadUrl(
      roomSession.cleanedRoomImageKey,
      60 * 60 * 1000
    );
  } else if (roomSession.originalRoomImageKey) {
    roomImageUrl = await StorageService.getSignedReadUrl(
      roomSession.originalRoomImageKey,
      60 * 60 * 1000
    );
  } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
    roomImageUrl =
      roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl!;
  } else {
    return json(
      { error: "no_room_image", message: "No room image available" },
      { status: 400, headers: corsHeaders }
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
    return json(
      { error: "no_product_image", message: "No product image available" },
      { status: 400, headers: corsHeaders }
    );
  }

  logger.info(
    { ...shopLogContext, stage: "see-it-now-generate-start" },
    `[See It Now] Starting render for product ${product_id}`
  );

  try {
    // Download both images in parallel
    // We still download to buffer to calculate hash/meta for RenderRun provenance
    // and to fallback if Gemini cache is missed.
    const [productImageData, roomImageData] = await Promise.all([
      downloadToBuffer(productImageUrl, shopLogContext),
      downloadToBuffer(roomImageUrl, shopLogContext),
    ]);

    // Optimize: Upload/Reuse Gemini Files
    const productFilename = `product-${productAsset.id}-${Date.now()}.png`;
    const roomFilename = `room-${roomSession.id}-${Date.now()}.jpg`;

    // Import helper dynamically or assume updated imports at top
    // Note: ensure 'navigate to' or 'add import' for getOrRefreshGeminiFile if not present.
    // I will assume I added the import in the top block modification or will enable it here.
    const { getOrRefreshGeminiFile } = await import("../services/gemini-files.server");

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
      logSeeItNowEvent("error", {
        sessionId: result.runId,
        shop: session.shop,
        productId: product_id,
        errorCode: "all_variants_failed",
        errorMessage: "Failed to generate any variants",
        step: "variants_generated",
      });

      return json(
        {
          success: false,
          error: "all_variants_failed",
          message: "Failed to generate any variants",
          request_id: requestId,
          version: "see-it-now-v2",
        },
        { status: 422, headers: corsHeaders }
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

    logSeeItNowEvent("variants_generated", {
      sessionId: result.runId,
      shop: session.shop,
      productId: product_id,
      roomSessionId: room_session_id,
      variantCount: responseVariants.length,
      variantIds: responseVariants.map((v) => v.id),
      durationMs: duration,
    });

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

    logSeeItNowEvent("error", {
      sessionId: `error_${Date.now()}`,
      shop: session.shop,
      productId: product_id,
      roomSessionId: room_session_id,
      errorCode: "generation_failed",
      errorMessage: errorMessage,
      step: "variants_generated",
    });

    return json(
      {
        success: false,
        error: "generation_failed",
        message: errorMessage,
        request_id: requestId,
        version: "see-it-now-v2",
      },
      { status: 422, headers: corsHeaders }
    );
  }
};

// Handle OPTIONS for CORS preflight
export const loader = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const corsHeaders = getCorsHeaders(session?.shop ?? null);

  return new Response(null, { status: 204, headers: corsHeaders });
};
