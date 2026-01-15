// See It Now - Hero Shot Generation Endpoint
// Generates 5 AI-powered furniture placement variants in parallel
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
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { validateTrustedUrl } from "../utils/validate-shopify-url.server";

// Import model config from centralized source
import { GEMINI_IMAGE_MODEL_FAST } from "~/config/ai-models.config";

import { isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";
import { logSeeItNowEvent } from "~/services/session-logger.server";

import {
  SEE_IT_NOW_VARIANT_LIBRARY,
  pickDefaultSelectedSeeItNowVariants,
  normalizeSeeItNowVariants,
  type SeeItNowVariantConfig,
} from "~/config/see-it-now-variants.config";

type VariantConfig = SeeItNowVariantConfig;

// ============================================================================
// CORS Headers
// ============================================================================
function getCorsHeaders(shopDomain: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
  };

  if (shopDomain) {
    headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
  }

  return headers;
}

// ============================================================================
// Gemini Client (lazy init)
// ============================================================================
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

// ============================================================================
// Image Download Helper
// ============================================================================
async function downloadToBuffer(
  url: string,
  logContext: ReturnType<typeof createLogContext>,
  maxDimension: number = 2048
): Promise<Buffer> {
  validateTrustedUrl(url, "image URL");

  logger.info(
    { ...logContext, stage: "download" },
    `[See It Now] Downloading image: ${url.substring(0, 80)}...`
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  // Resize and normalize
  const buffer = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true
    })
    .png({ force: true })
    .toBuffer();

  logger.info(
    { ...logContext, stage: "download" },
    `[See It Now] Downloaded & Optimized: ${buffer.length} bytes`
  );

  return buffer;
}

// ============================================================================
// Types for structured placement fields
// ============================================================================
interface PlacementFields {
  surface?: 'floor' | 'wall' | 'table' | 'ceiling' | 'shelf' | 'other' | null;
  material?: 'fabric' | 'wood' | 'metal' | 'glass' | 'ceramic' | 'stone' | 'leather' | 'mixed' | 'other' | null;
  orientation?: 'upright' | 'flat' | 'leaning' | 'wall-mounted' | 'hanging' | 'draped' | 'other' | null;
  shadow?: 'contact' | 'cast' | 'soft' | 'none' | null;
  dimensions?: { height?: number | null; width?: number | null } | null;
  additionalNotes?: string | null;
}

// ============================================================================
// Build Hero Shot Prompt
// Concatenates: general prompt + product placement + variant creative direction
// ============================================================================
function buildHeroShotPrompt(
  generalPrompt: string,
  placementPrompt: string,
  variantDirection: string
): string {
  const parts: string[] = [];
  if (generalPrompt?.trim()) {
    parts.push(generalPrompt.trim());
  }
  if (placementPrompt?.trim()) {
    parts.push(placementPrompt.trim());
  }
  // Add variant-specific creative direction
  if (variantDirection?.trim()) {
    parts.push(`CREATIVE DIRECTION FOR THIS VARIANT: ${variantDirection.trim()}`);
  }
  return parts.join('\n\n');
}

// ============================================================================
// Generate Single Variant
// ============================================================================
async function generateVariant(
  roomBuffer: Buffer,
  productBuffer: Buffer,
  variant: VariantConfig,
  generalPrompt: string,
  placementPrompt: string,
  logContext: ReturnType<typeof createLogContext>
): Promise<{ id: string; base64: string; direction: string }> {
  const variantLogContext = { ...logContext, variantId: variant.id };

  logger.info(
    { ...variantLogContext, stage: "gemini-call" },
    `[See It Now] Generating variant: ${variant.id}`
  );

  const startTime = Date.now();
  // Include the variant's creative direction in the prompt
  const prompt = buildHeroShotPrompt(generalPrompt, placementPrompt, variant.prompt);

  const client = getGeminiClient();

  // Order matches prompt: "The first image is the product cutout. The second image is a real room photo."
  const parts = [
    { text: prompt },
    { text: "PRODUCT CUTOUT (transparent background, isolated product):" },
    {
      inlineData: {
        mimeType: 'image/png',
        data: productBuffer.toString('base64')
      }
    },
    { text: "CUSTOMER ROOM PHOTO (real room to place product into):" },
    {
      inlineData: {
        mimeType: 'image/png',
        data: roomBuffer.toString('base64')
      }
    }
  ];

  const response = await client.models.generateContent({
    model: GEMINI_IMAGE_MODEL_FAST,
    contents: parts,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  const duration = Date.now() - startTime;

  // Extract image from response
  const candidates = response.candidates;
  if (candidates?.[0]?.content?.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData?.data) {
        logger.info(
          { ...variantLogContext, stage: "gemini-complete" },
          `[See It Now] Variant ${variant.id} generated in ${duration}ms`
        );
        return {
          id: variant.id,
          base64: part.inlineData.data,
          direction: variant.prompt,
        };
      }
    }
  }

  throw new Error(`[See It Now] No image in Gemini response for variant ${variant.id}`);
}

// ============================================================================
// Upload Variant to GCS
// ============================================================================
async function uploadVariant(
  sessionId: string,
  variantId: string,
  base64Data: string,
  logContext: ReturnType<typeof createLogContext>
): Promise<{ id: string; imageUrl: string; imageKey: string }> {
  const buffer = Buffer.from(base64Data, 'base64');

  // Convert to JPEG for storage efficiency
  const jpegBuffer = await sharp(buffer)
    .jpeg({ quality: 90 })
    .toBuffer();

  const key = `see-it-now-renders/${sessionId}/${variantId}_${Date.now()}.jpg`;
  const imageUrl = await StorageService.uploadBuffer(jpegBuffer, key, 'image/jpeg');

  logger.info(
    { ...logContext, stage: "upload", variantId },
    `[See It Now] Uploaded variant ${variantId}: ${key}`
  );

  return { id: variantId, imageUrl, imageKey: key };
}

// ============================================================================
// Main Action Handler
// ============================================================================
export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = getRequestId(request);
  const logContext = createLogContext("render", requestId, "see-it-now-start", { version: 'see-it-now' });

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
  // SEE IT NOW ALLOWLIST CHECK - Critical security gate
  // ============================================================================
  if (!isSeeItNowAllowedShop(session.shop)) {
    logger.info(
      { ...logContext, stage: "allowlist", shop: session.shop },
      `[See It Now] Shop not in allowlist`
    );
    return json(
      { error: "see_it_now_not_enabled", message: "See It Now features are not enabled for this shop" },
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
      { error: "rate_limit_exceeded", message: "Too many requests. Please wait a moment." },
      { status: 429, headers: corsHeaders }
    );
  }

  // Fetch shop
  const shop = await prisma.shop.findUnique({ 
    where: { shopDomain: session.shop },
    select: { id: true, settingsJson: true }
  });
  if (!shop) {
    logger.error(
      { ...logContext, stage: "shop-lookup" },
      `[See It Now] Shop not found: ${session.shop}`
    );
    return json({ error: "shop_not_found" }, { status: 404, headers: corsHeaders });
  }

  const shopLogContext = { ...logContext, shopId: shop.id, productId: product_id };

  // Quota check (only increment ONCE for all 5 variants)
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
    where: { id: room_session_id }
  });

  if (!roomSession) {
    return json(
      { error: "room_not_found", message: "Room session not found" },
      { status: 404, headers: corsHeaders }
    );
  }

  // Fetch ProductAsset (including placement rules AND structured fields)
  const productAsset = await prisma.productAsset.findFirst({
    where: { shopId: shop.id, productId: product_id },
    select: {
      id: true,
      preparedImageUrl: true,
      preparedImageKey: true,
      sourceImageUrl: true,
      status: true,
      renderInstructions: true,
      renderInstructionsSeeItNow: true,
      sceneRole: true,
      replacementRule: true,
      allowSpaceCreation: true,
      placementFields: true, // Structured metadata: surface, material, orientation, shadow, dimensions, additionalNotes
      seeItNowVariants: true,
    }
  });

  // Verify product is enabled for See It
  if (!productAsset || productAsset.status !== "live") {
    logger.warn(
      { ...shopLogContext, stage: "product-check" },
      `[See It Now] Product ${product_id} not enabled for See It (status: ${productAsset?.status || 'no asset'})`
    );

    return json({
      success: false,
      error: "product_not_enabled",
      message: "This product is not enabled for See It visualization"
    }, { headers: corsHeaders });
  }

  // Get room image URL
  let roomImageUrl: string;
  if (roomSession.cleanedRoomImageKey) {
    roomImageUrl = await StorageService.getSignedReadUrl(roomSession.cleanedRoomImageKey, 60 * 60 * 1000);
  } else if (roomSession.originalRoomImageKey) {
    roomImageUrl = await StorageService.getSignedReadUrl(roomSession.originalRoomImageKey, 60 * 60 * 1000);
  } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
    roomImageUrl = roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl!;
  } else {
    return json(
      { error: "no_room_image", message: "No room image available" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Get product image URL
  let productImageUrl: string | null = null;
  if (productAsset?.preparedImageKey) {
    try {
      productImageUrl = await StorageService.getSignedReadUrl(productAsset.preparedImageKey, 60 * 60 * 1000);
    } catch {
      productImageUrl = productAsset.preparedImageUrl ?? null;
    }
  } else if (productAsset?.preparedImageUrl) {
    productImageUrl = productAsset.preparedImageUrl;
  } else if (productAsset?.sourceImageUrl) {
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
    `[See It Now] Starting hero shot generation for product ${product_id}`
  );

  try {
    // Download both images
    const [roomBuffer, productBuffer] = await Promise.all([
      downloadToBuffer(roomImageUrl, shopLogContext),
      downloadToBuffer(productImageUrl, shopLogContext),
    ]);

    // Generate a unique session ID for this See It Now render batch
    const seeItNowSessionId = `see-it-now_${room_session_id}_${Date.now()}`;

    // Simplified model:
    // - General prompt is shop-level
    // - Placement prompt is product-level (See It Now override, fallback to See It)
    // - Variants are product-level selection (fallback to 5-of-10 defaults)
    const settings = shop.settingsJson ? JSON.parse(shop.settingsJson) : {};

    const generalPrompt: string = settings.seeItNowPrompt || "";

    // Compute effective placement prompt: prefer renderInstructionsSeeItNow, fallback to renderInstructions
    const now = productAsset?.renderInstructionsSeeItNow?.trim();
    const fallback = productAsset?.renderInstructions?.trim();
    const placementPrompt: string = now || fallback || "";

    // Variant library can be shop-configured; fallback to canonical 10-option library.
    const variantLibrary: VariantConfig[] =
      Array.isArray(settings.seeItNowVariants) && settings.seeItNowVariants.length > 0
        ? normalizeSeeItNowVariants(settings.seeItNowVariants, SEE_IT_NOW_VARIANT_LIBRARY)
        : SEE_IT_NOW_VARIANT_LIBRARY;

    // Per-product selected variants (merchant-adjustable). If missing, default to 5 selected.
    const perProductSelected = normalizeSeeItNowVariants(
      productAsset?.seeItNowVariants,
      variantLibrary
    );
    const variants: VariantConfig[] =
      perProductSelected.length > 0 ? perProductSelected : pickDefaultSelectedSeeItNowVariants(variantLibrary);

    logger.info(
      { ...shopLogContext, stage: "prompt-selection" },
      `[See It Now] Using prompts: placementPrompt length: ${placementPrompt.length}, generalPrompt length: ${generalPrompt.length}, variants: ${variants.length}`
    );

    // Generate all variants in PARALLEL
    const variantPromises = variants.map(variant =>
      generateVariant(
        roomBuffer,
        productBuffer,
        variant,
        generalPrompt,
        placementPrompt,
        shopLogContext
      ).catch(error => {
        logger.error(
          { ...shopLogContext, stage: "variant-error", variantId: variant.id },
          `[See It Now] Variant ${variant.id} failed`,
          error
        );
        return null; // Allow partial success
      })
    );

    const variantResults = await Promise.all(variantPromises);
    const successfulVariants = variantResults.filter((v): v is NonNullable<typeof v> => v !== null);

    if (successfulVariants.length === 0) {
      // Log error to monitor
      logSeeItNowEvent('error', {
        sessionId: seeItNowSessionId,
        shop: session.shop,
        productId: product_id,
        errorCode: 'all_variants_failed',
        errorMessage: 'Failed to generate any variants',
        step: 'variants_generated',
      });

      return json(
        { error: "all_variants_failed", message: "Failed to generate any variants" },
        { status: 500, headers: corsHeaders }
      );
    }

    // Upload all successful variants in parallel
    const uploadPromises = successfulVariants.map(variant =>
      uploadVariant(seeItNowSessionId, variant.id, variant.base64, shopLogContext)
        .then(result => ({
          id: result.id,
          image_url: result.imageUrl,
          direction: variant.direction,
        }))
    );

    const uploadedVariants = await Promise.all(uploadPromises);

    // Increment quota ONCE for the entire batch
    await incrementQuota(shop.id, "render", 1);

    const duration = Date.now() - startTime;

    logger.info(
      { ...shopLogContext, stage: "see-it-now-complete", durationMs: duration, variantCount: uploadedVariants.length },
      `[See It Now] Hero shot generation completed: ${uploadedVariants.length} variants in ${duration}ms`
    );

    // Log successful generation to monitor
    logSeeItNowEvent('variants_generated', {
      sessionId: seeItNowSessionId,
      shop: session.shop,
      productId: product_id,
      roomSessionId: room_session_id,
      variantCount: uploadedVariants.length,
      variantIds: uploadedVariants.map(v => v.id),
      imageUrls: uploadedVariants.map(v => v.image_url),
      durationMs: duration,
    });

    return json({
      session_id: seeItNowSessionId,
      variants: uploadedVariants,
      duration_ms: duration,
      version: 'see-it-now',
    }, { headers: corsHeaders });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { ...shopLogContext, stage: "see-it-now-error" },
      `[See It Now] Hero shot generation failed`,
      error
    );

    // Log error to monitor
    logSeeItNowEvent('error', {
      sessionId: `see-it-now_${room_session_id}_${Date.now()}`,
      shop: session.shop,
      productId: product_id,
      roomSessionId: room_session_id,
      errorCode: 'generation_failed',
      errorMessage: errorMessage,
      step: 'variants_generated',
    });

    return json({
      error: "generation_failed",
      message: errorMessage,
      version: 'see-it-now',
    }, { status: 500, headers: corsHeaders });
  }
};

// Handle OPTIONS for CORS preflight
export const loader = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const corsHeaders = getCorsHeaders(session?.shop ?? null);

  return new Response(null, { status: 204, headers: corsHeaders });
};
