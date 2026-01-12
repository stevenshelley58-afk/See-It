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

// ============================================================================
// PLACEMENT VARIANTS - 5 different AI-guided placements
// ============================================================================
const PLACEMENT_VARIANTS = [
  { id: 'center', hint: 'Center', variation: 'Center' },
  { id: 'left', hint: 'Slightly left', variation: 'Slightly left' },
  { id: 'right', hint: 'Slightly right', variation: 'Slightly right' },
  { id: 'higher', hint: 'Slightly higher (if wall-based) or slightly forward (if floor-based)', variation: 'Slightly higher' },
  { id: 'lower', hint: 'Slightly lower (if wall-based) or slightly back (if floor-based)', variation: 'Slightly lower' },
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
// Uses ALL extracted + merchant-confirmed data for best render quality
// ============================================================================
function buildHeroShotPrompt(
  placementPrompt: string | null,
  variant: { id: string; hint: string; variation: string },
  placementRulesConfig: {
    sceneRole: string | null;
    replacementRule: string | null;
    allowSpaceCreation: boolean | null;
  } | null,
  placementFields: PlacementFields | null
): string {
  const parts: string[] = [];

  // =========================================================================
  // SECTION 1: PRODUCT IDENTITY (Prose description)
  // The merchant-approved prose that describes what the product looks like
  // =========================================================================
  parts.push(`═══════════════════════════════════════════════════════════════════`);
  parts.push(`PRODUCT DESCRIPTION`);
  parts.push(`═══════════════════════════════════════════════════════════════════`);
  if (placementPrompt?.trim()) {
    parts.push(placementPrompt.trim());
  } else {
    parts.push(`Furniture/home decor piece (refer to product image for appearance).`);
  }
  parts.push(``);

  // =========================================================================
  // SECTION 2: PHYSICAL PROPERTIES (Structured metadata)
  // Extracted/confirmed structured data about the product
  // =========================================================================
  if (placementFields && (placementFields.surface || placementFields.material || placementFields.orientation || placementFields.dimensions)) {
    parts.push(`═══════════════════════════════════════════════════════════════════`);
    parts.push(`PHYSICAL PROPERTIES`);
    parts.push(`═══════════════════════════════════════════════════════════════════`);
    
    // Surface type determines WHERE it goes
    if (placementFields.surface && placementFields.surface !== 'other') {
      const surfaceDescriptions: Record<string, string> = {
        floor: 'Floor-standing piece - place directly on floor, ensure all legs/base contact surface',
        wall: 'Wall piece - mount or lean against wall at appropriate height',
        table: 'Tabletop item - place on a table, console, or shelf surface',
        ceiling: 'Ceiling-mounted - hangs from above, cast shadow downward',
        shelf: 'Shelf item - place on shelving, bookcase, or display unit',
      };
      parts.push(`• Surface: ${surfaceDescriptions[placementFields.surface] || placementFields.surface}`);
    }
    
    // Material affects how light interacts
    if (placementFields.material && placementFields.material !== 'other') {
      const materialLighting: Record<string, string> = {
        fabric: 'Fabric - soft light absorption, matte appearance, subtle texture shadows',
        wood: 'Wood - warm tones, visible grain, slight sheen on polished areas',
        metal: 'Metal - reflective highlights, may mirror surroundings, hard shadows',
        glass: 'Glass - transparent/translucent, refractions, may show room reflections',
        ceramic: 'Ceramic - smooth or textured glaze, subtle reflections on glazed areas',
        stone: 'Stone - matte natural texture, minimal reflection, organic color variation',
        leather: 'Leather - soft sheen, texture creases, absorbs light on matte areas',
        mixed: 'Mixed materials - handle each material surface appropriately',
      };
      parts.push(`• Material: ${materialLighting[placementFields.material] || placementFields.material}`);
    }
    
    // Orientation affects positioning
    if (placementFields.orientation && placementFields.orientation !== 'other') {
      const orientationGuide: Record<string, string> = {
        upright: 'Upright - standing vertical, base on surface',
        flat: 'Flat - lying horizontal (rug, mat, tray)',
        leaning: 'Leaning - tilted against wall at shallow angle',
        'wall-mounted': 'Wall-mounted - fixed to wall, parallel to wall surface',
        hanging: 'Hanging - suspended from above, may sway slightly',
        draped: 'Draped - soft goods flowing over surface or form',
      };
      parts.push(`• Orientation: ${orientationGuide[placementFields.orientation] || placementFields.orientation}`);
    }
    
    // Dimensions for accurate scale
    if (placementFields.dimensions) {
      const dims: string[] = [];
      if (placementFields.dimensions.height) dims.push(`${placementFields.dimensions.height}cm tall`);
      if (placementFields.dimensions.width) dims.push(`${placementFields.dimensions.width}cm wide`);
      if (dims.length > 0) {
        parts.push(`• Real-world size: ${dims.join(', ')} - MATCH THIS SCALE EXACTLY`);
      }
    }
    
    // Shadow type for realism
    if (placementFields.shadow && placementFields.shadow !== 'none') {
      const shadowGuide: Record<string, string> = {
        contact: 'Contact shadow - soft shadow where product touches surface',
        cast: 'Cast shadow - distinct shadow projection based on light direction',
        soft: 'Soft shadow - diffused ambient shadow, no hard edges',
      };
      parts.push(`• Shadow: ${shadowGuide[placementFields.shadow] || placementFields.shadow}`);
    }
    
    // Merchant's additional notes
    if (placementFields.additionalNotes?.trim()) {
      parts.push(`• Special notes: ${placementFields.additionalNotes.trim()}`);
    }
    
    parts.push(``);
  }

  // =========================================================================
  // SECTION 3: PLACEMENT RULES (Scene integration strategy)
  // How this product should integrate into the room scene
  // =========================================================================
  if (placementRulesConfig && (placementRulesConfig.sceneRole || placementRulesConfig.replacementRule)) {
    parts.push(`═══════════════════════════════════════════════════════════════════`);
    parts.push(`PLACEMENT STRATEGY`);
    parts.push(`═══════════════════════════════════════════════════════════════════`);
    
    // Scene Role
    if (placementRulesConfig.sceneRole) {
      parts.push(`Scene Role: ${placementRulesConfig.sceneRole}`);
      if (placementRulesConfig.sceneRole === 'Dominant') {
        parts.push(`  → Place as a MAIN focal piece in the room`);
        parts.push(`  → Prefer clear walls or primary open areas`);
        parts.push(`  → Do NOT place on existing surfaces or inside decor clusters`);
      } else if (placementRulesConfig.sceneRole === 'Integrated') {
        parts.push(`  → Place as part of the existing scene arrangement`);
        parts.push(`  → Use an appropriate surface or grouping with other items`);
        parts.push(`  → Do NOT center or hero the product`);
      }
    }
    
    // Replacement Rule
    if (placementRulesConfig.replacementRule) {
      parts.push(`Replacement Rule: ${placementRulesConfig.replacementRule}`);
      if (placementRulesConfig.replacementRule === 'Same Role Only') {
        parts.push(`  → May replace an existing object with the SAME purpose only`);
      } else if (placementRulesConfig.replacementRule === 'Similar Size or Position') {
        parts.push(`  → May replace an object in a similar wall/floor position`);
      } else if (placementRulesConfig.replacementRule === 'Any Blocking Object') {
        parts.push(`  → May remove a smaller object if it blocks ideal placement`);
      } else if (placementRulesConfig.replacementRule === 'None') {
        parts.push(`  → Do NOT remove or replace any existing objects`);
      }
    }
    
    // Space Creation
    if (placementRulesConfig.allowSpaceCreation !== null) {
      parts.push(`Space Creation: ${placementRulesConfig.allowSpaceCreation ? 'Allowed' : 'Not allowed'}`);
      if (placementRulesConfig.allowSpaceCreation) {
        parts.push(`  → If product doesn't fit, may minimally adjust small blocking items`);
      }
    }
    
    parts.push(``);
  }

  // =========================================================================
  // SECTION 4: POSITION VARIANT
  // The specific position variation for this render
  // =========================================================================
  parts.push(`═══════════════════════════════════════════════════════════════════`);
  parts.push(`POSITION VARIANT: ${variant.variation.toUpperCase()}`);
  parts.push(`═══════════════════════════════════════════════════════════════════`);
  parts.push(`${variant.hint}`);
  parts.push(``);

  // =========================================================================
  // SECTION 5: HARD REALISM RULES (Non-negotiable)
  // These rules ALWAYS apply, no exceptions
  // =========================================================================
  parts.push(`═══════════════════════════════════════════════════════════════════`);
  parts.push(`HARD RULES (ALWAYS FOLLOW)`);
  parts.push(`═══════════════════════════════════════════════════════════════════`);
  parts.push(`✓ Match the room's existing lighting direction and color temperature`);
  parts.push(`✓ Match the room's perspective and camera angle exactly`);
  parts.push(`✓ Add appropriate shadow based on room lighting (see Shadow type above)`);
  parts.push(`✓ Keep the product's EXACT proportions - never stretch or distort`);
  parts.push(`✓ If dimensions given, scale product to match real-world size`);
  parts.push(`✗ Do NOT redesign or modify the room architecture`);
  parts.push(`✗ Do NOT move existing furniture unless replacement rule allows`);
  parts.push(`✗ Do NOT invent objects, text, people, or reflections`);
  parts.push(`✗ Do NOT add decorations, props, or styling not in original images`);

  return parts.join('\n');
}

// ============================================================================
// Generate Single Variant
// ============================================================================
async function generateVariant(
  roomBuffer: Buffer,
  productBuffer: Buffer,
  variant: { id: string; hint: string; variation: string },
  placementPrompt: string | null,
  placementRulesConfig: {
    sceneRole: string | null;
    replacementRule: string | null;
    allowSpaceCreation: boolean | null;
  } | null,
  placementFields: PlacementFields | null,
  logContext: ReturnType<typeof createLogContext>
): Promise<{ id: string; base64: string; hint: string }> {
  const variantLogContext = { ...logContext, variantId: variant.id };

  logger.info(
    { ...variantLogContext, stage: "gemini-call" },
    `[See It Now] Generating variant: ${variant.id}`
  );

  const startTime = Date.now();
  const prompt = buildHeroShotPrompt(placementPrompt, variant, placementRulesConfig, placementFields);

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
          `[See It Now] Variant ${variant.id} generated in ${duration}ms`
        );
        return {
          id: variant.id,
          base64: part.inlineData.data,
          hint: variant.hint,
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
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
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

    // Prepare placement rules config
    const placementRulesConfig = productAsset ? {
      sceneRole: productAsset.sceneRole,
      replacementRule: productAsset.replacementRule,
      allowSpaceCreation: productAsset.allowSpaceCreation,
    } : null;

    // Parse placementFields from JSON (stored as Prisma Json type)
    let parsedPlacementFields: PlacementFields | null = null;
    if (productAsset?.placementFields && typeof productAsset.placementFields === 'object') {
      parsedPlacementFields = productAsset.placementFields as PlacementFields;
    }

    // Compute effective prompt: prefer renderInstructionsSeeItNow, fallback to renderInstructions
    const now = productAsset?.renderInstructionsSeeItNow?.trim();
    const fallback = productAsset?.renderInstructions?.trim();
    const effectivePrompt = now ? now : (fallback ? fallback : null);
    const promptSource = now ? 'seeItNow' : 'fallback';

    // Log prompt source, length, and structured fields status (never content)
    logger.info(
      { ...shopLogContext, stage: "prompt-selection" },
      `[See It Now] Using prompt source: ${promptSource}, length: ${(effectivePrompt || '').length}, hasPlacementFields: ${!!parsedPlacementFields}, surface: ${parsedPlacementFields?.surface || 'none'}, material: ${parsedPlacementFields?.material || 'none'}`
    );

    // Generate all 5 variants in PARALLEL
    const variantPromises = PLACEMENT_VARIANTS.map(variant =>
      generateVariant(
        roomBuffer,
        productBuffer,
        variant,
        effectivePrompt,
        placementRulesConfig,
        parsedPlacementFields,
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
          hint: variant.hint,
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
