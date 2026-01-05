// See It V2 - Hero Shot Flow - Render Endpoint
// v2.0.0 - Generate 4 placement variants in parallel
//
// SAFETY: Only enabled for shops in V2_ALLOWED_SHOPS allowlist
// DO NOT modify existing v1 routes - this is a separate endpoint

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

// ============================================================================
// V2 SHOP ALLOWLIST - Only these shops can access v2 features
// ============================================================================
const V2_ALLOWED_SHOPS = [
  'test-store-1100000000000000000000000000000002307.myshopify.com', // Test store
];

// ============================================================================
// PLACEMENT VARIANTS - 4 different AI-guided placements
// ============================================================================
const PLACEMENT_VARIANTS = [
  { id: 'open', hint: 'Place naturally in the most open floor space, centered' },
  { id: 'wall', hint: 'Place against the main wall, slightly off-center' },
  { id: 'light', hint: 'Place near the window or brightest area to catch natural light' },
  { id: 'corner', hint: 'Place in the emptiest corner area of the room' },
] as const;

type VariantId = typeof PLACEMENT_VARIANTS[number]['id'];

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
    `[v2] Downloading image: ${url.substring(0, 80)}...`
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
    `[v2] Downloaded & Optimized: ${buffer.length} bytes`
  );

  return buffer;
}

// ============================================================================
// Build Hero Shot Prompt
// ============================================================================
function buildHeroShotPrompt(
  productInstructions: string | null,
  placementHint: string
): string {
  return `Place this furniture naturally into this room photograph.

PRODUCT:
${productInstructions || 'Furniture piece'}

PLACEMENT GUIDANCE:
${placementHint}

Look at the room and choose the most logical position following the guidance above.

RULES:
- Match the room's existing lighting and color temperature
- Add natural contact shadow where product meets the floor/surface
- Keep the product's exact proportions - do not stretch or distort
- Make it look like a professional interior photograph
- Do not modify anything else in the room`;
}

// ============================================================================
// Generate Single Variant
// ============================================================================
async function generateVariant(
  roomBuffer: Buffer,
  productBuffer: Buffer,
  variant: { id: string; hint: string },
  productInstructions: string | null,
  logContext: ReturnType<typeof createLogContext>
): Promise<{ id: string; base64: string; hint: string }> {
  const variantLogContext = { ...logContext, variantId: variant.id };

  logger.info(
    { ...variantLogContext, stage: "gemini-call" },
    `[v2] Generating variant: ${variant.id}`
  );

  const startTime = Date.now();
  const prompt = buildHeroShotPrompt(productInstructions, variant.hint);

  const client = getGeminiClient();

  const parts = [
    { text: prompt },
    { text: "ROOM IMAGE:" },
    {
      inlineData: {
        mimeType: 'image/png',
        data: roomBuffer.toString('base64')
      }
    },
    { text: "PRODUCT IMAGE:" },
    {
      inlineData: {
        mimeType: 'image/png',
        data: productBuffer.toString('base64')
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
          `[v2] Variant ${variant.id} generated in ${duration}ms`
        );
        return {
          id: variant.id,
          base64: part.inlineData.data,
          hint: variant.hint,
        };
      }
    }
  }

  throw new Error(`[v2] No image in Gemini response for variant ${variant.id}`);
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

  const key = `v2-renders/${sessionId}/${variantId}_${Date.now()}.jpg`;
  const imageUrl = await StorageService.uploadBuffer(jpegBuffer, key, 'image/jpeg');

  logger.info(
    { ...logContext, stage: "upload", variantId },
    `[v2] Uploaded variant ${variantId}: ${key}`
  );

  return { id: variantId, imageUrl, imageKey: key };
}

// ============================================================================
// Main Action Handler
// ============================================================================
export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = getRequestId(request);
  const logContext = createLogContext("render", requestId, "v2-start", { version: 'v2' });

  const { session } = await authenticate.public.appProxy(request);
  const corsHeaders = getCorsHeaders(session?.shop ?? null);

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!session) {
    logger.warn(
      { ...logContext, stage: "auth" },
      `[v2] App proxy auth failed: no session`
    );
    return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
  }

  // ============================================================================
  // V2 ALLOWLIST CHECK - Critical security gate
  // ============================================================================
  if (!V2_ALLOWED_SHOPS.includes(session.shop)) {
    logger.info(
      { ...logContext, stage: "allowlist", shop: session.shop },
      `[v2] Shop not in v2 allowlist`
    );
    return json(
      { error: "v2_not_enabled", message: "V2 features are not enabled for this shop" },
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
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) {
    logger.error(
      { ...logContext, stage: "shop-lookup" },
      `[v2] Shop not found: ${session.shop}`
    );
    return json({ error: "shop_not_found" }, { status: 404, headers: corsHeaders });
  }

  const shopLogContext = { ...logContext, shopId: shop.id, productId: product_id };

  // Quota check (only increment ONCE for all 4 variants)
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

  // Fetch ProductAsset
  const productAsset = await prisma.productAsset.findFirst({
    where: { shopId: shop.id, productId: product_id },
    select: {
      id: true,
      preparedImageUrl: true,
      preparedImageKey: true,
      sourceImageUrl: true,
      renderInstructions: true,
    }
  });

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
    { ...shopLogContext, stage: "v2-generate-start" },
    `[v2] Starting hero shot generation for product ${product_id}`
  );

  try {
    // Download both images
    const [roomBuffer, productBuffer] = await Promise.all([
      downloadToBuffer(roomImageUrl, shopLogContext),
      downloadToBuffer(productImageUrl, shopLogContext),
    ]);

    // Generate a unique session ID for this v2 render batch
    const v2SessionId = `v2_${room_session_id}_${Date.now()}`;

    // Generate all 4 variants in PARALLEL
    const variantPromises = PLACEMENT_VARIANTS.map(variant =>
      generateVariant(
        roomBuffer,
        productBuffer,
        variant,
        productAsset?.renderInstructions ?? null,
        shopLogContext
      ).catch(error => {
        logger.error(
          { ...shopLogContext, stage: "variant-error", variantId: variant.id },
          `[v2] Variant ${variant.id} failed`,
          error
        );
        return null; // Allow partial success
      })
    );

    const variantResults = await Promise.all(variantPromises);
    const successfulVariants = variantResults.filter((v): v is NonNullable<typeof v> => v !== null);

    if (successfulVariants.length === 0) {
      return json(
        { error: "all_variants_failed", message: "Failed to generate any variants" },
        { status: 500, headers: corsHeaders }
      );
    }

    // Upload all successful variants in parallel
    const uploadPromises = successfulVariants.map(variant =>
      uploadVariant(v2SessionId, variant.id, variant.base64, shopLogContext)
        .then(result => ({
          id: result.id,
          image_url: result.imageUrl,
          hint: variant.hint,
        }))
    );

    const uploadedVariants = await Promise.all(uploadPromises);

    // Increment quota ONCE for the entire batch
    await incrementQuota(shop.id, "render", 1);

    const duration = Date.now() - startTime;

    logger.info(
      { ...shopLogContext, stage: "v2-complete", durationMs: duration, variantCount: uploadedVariants.length },
      `[v2] Hero shot generation completed: ${uploadedVariants.length} variants in ${duration}ms`
    );

    return json({
      session_id: v2SessionId,
      variants: uploadedVariants,
      duration_ms: duration,
      version: 'v2',
    }, { headers: corsHeaders });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { ...shopLogContext, stage: "v2-error" },
      `[v2] Hero shot generation failed`,
      error
    );

    return json({
      error: "generation_failed",
      message: errorMessage,
      version: 'v2',
    }, { status: 500, headers: corsHeaders });
  }
};

// Handle OPTIONS for CORS preflight
export const loader = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const corsHeaders = getCorsHeaders(session?.shop ?? null);

  return new Response(null, { status: 204, headers: corsHeaders });
};
