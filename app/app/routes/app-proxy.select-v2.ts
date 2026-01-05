// See It V2 - Hero Shot Flow - Selection Endpoint
// v2.0.0 - Handle user variant selection, optionally upscale to high quality
//
// SAFETY: Only enabled for shops in V2_ALLOWED_SHOPS allowlist
// DO NOT modify existing v1 routes - this is a separate endpoint

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { validateTrustedUrl } from "../utils/validate-shopify-url.server";

// Import model config from centralized source
import { GEMINI_IMAGE_MODEL_PRO, GEMINI_IMAGE_MODEL_FAST } from "~/config/ai-models.config";

// ============================================================================
// V2 SHOP ALLOWLIST - Must match render-v2.ts
// ============================================================================
const V2_ALLOWED_SHOPS = [
  'test-store-1100000000000000000000000000000002307.myshopify.com', // Test store
];

// Valid variant IDs
const VALID_VARIANT_IDS = ['open', 'wall', 'light', 'corner'] as const;
type VariantId = typeof VALID_VARIANT_IDS[number];

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
  logContext: ReturnType<typeof createLogContext>
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
  return Buffer.from(arrayBuffer);
}

// ============================================================================
// Upscale Image with Gemini Pro
// ============================================================================
async function upscaleImage(
  imageBuffer: Buffer,
  logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
  logger.info(
    { ...logContext, stage: "upscale-start" },
    `[v2] Upscaling image with Pro model`
  );

  const startTime = Date.now();
  const client = getGeminiClient();

  const prompt = `Enhance this interior photograph to professional quality.
Improve sharpness, detail, and color accuracy while maintaining the exact composition.
Do not change the placement of any objects.`;

  const parts = [
    { text: prompt },
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBuffer.toString('base64')
      }
    }
  ];

  try {
    const response = await client.models.generateContent({
      model: GEMINI_IMAGE_MODEL_PRO,
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
            { ...logContext, stage: "upscale-complete" },
            `[v2] Upscale completed in ${duration}ms`
          );
          return Buffer.from(part.inlineData.data, 'base64');
        }
      }
    }

    throw new Error('No image in upscale response');
  } catch (error) {
    logger.warn(
      { ...logContext, stage: "upscale-failed" },
      `[v2] Upscale failed, returning original image`,
      error
    );
    // Return original on failure - don't break the flow
    return imageBuffer;
  }
}

// ============================================================================
// Main Action Handler
// ============================================================================
export const action = async ({ request }: ActionFunctionArgs) => {
  const requestId = getRequestId(request);
  const logContext = createLogContext("render", requestId, "v2-select", { version: 'v2' });

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
  let body: {
    session_id?: string;
    selected_variant_id?: string;
    room_session_id?: string;
    selected_image_url?: string; // The actual image URL to save/upscale
    upscale?: boolean; // Optional: whether to upscale with Pro model
  };

  try {
    body = await request.json();
  } catch {
    return json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      { status: 400, headers: corsHeaders }
    );
  }

  const { session_id, selected_variant_id, room_session_id, selected_image_url, upscale = false } = body;

  // Validate required fields
  if (!session_id) {
    return json(
      { error: "missing_session_id", message: "session_id is required" },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!selected_variant_id) {
    return json(
      { error: "missing_variant_id", message: "selected_variant_id is required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Validate variant ID
  if (!VALID_VARIANT_IDS.includes(selected_variant_id as VariantId)) {
    return json(
      { error: "invalid_variant_id", message: `selected_variant_id must be one of: ${VALID_VARIANT_IDS.join(', ')}` },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!room_session_id) {
    return json(
      { error: "missing_room_session_id", message: "room_session_id is required" },
      { status: 400, headers: corsHeaders }
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

  const shopLogContext = {
    ...logContext,
    shopId: shop.id,
    v2SessionId: session_id,
    selectedVariant: selected_variant_id,
  };

  logger.info(
    { ...shopLogContext, stage: "v2-select" },
    `[v2] User selected variant: ${selected_variant_id}`
  );

  try {
    let finalImageUrl = selected_image_url;
    let finalImageKey: string | null = null;

    // If we have an image URL and upscale is requested, process it
    if (selected_image_url && upscale) {
      logger.info(
        { ...shopLogContext, stage: "upscale-requested" },
        `[v2] Upscale requested for variant ${selected_variant_id}`
      );

      // Download the selected variant image
      const imageBuffer = await downloadToBuffer(selected_image_url, shopLogContext);

      // Upscale with Pro model
      const upscaledBuffer = await upscaleImage(imageBuffer, shopLogContext);

      // Convert to high-quality JPEG
      const finalBuffer = await sharp(upscaledBuffer)
        .jpeg({ quality: 95 })
        .toBuffer();

      // Upload the upscaled version
      const key = `v2-renders/${session_id}/${selected_variant_id}_upscaled_${Date.now()}.jpg`;
      finalImageUrl = await StorageService.uploadBuffer(finalBuffer, key, 'image/jpeg');
      finalImageKey = key;

      logger.info(
        { ...shopLogContext, stage: "upscale-uploaded" },
        `[v2] Upscaled image uploaded: ${key}`
      );
    }

    // Log the selection to database
    // Create a RenderJob record to track this v2 selection
    const renderJob = await prisma.renderJob.create({
      data: {
        shop: { connect: { id: shop.id } },
        productId: 'v2-selection', // Placeholder - we don't have product_id in select call
        roomSession: { connect: { id: room_session_id } },
        placementX: 0, // V2 doesn't use manual placement
        placementY: 0,
        placementScale: 1,
        stylePreset: 'v2-hero-shot',
        quality: upscale ? 'high' : 'standard',
        configJson: JSON.stringify({
          version: 'v2',
          v2SessionId: session_id,
          selectedVariant: selected_variant_id,
          upscaled: upscale,
        }),
        status: "completed",
        imageUrl: finalImageUrl || null,
        imageKey: finalImageKey,
        createdAt: new Date(),
        completedAt: new Date(),
      }
    });

    const duration = Date.now() - startTime;

    logger.info(
      { ...shopLogContext, stage: "v2-select-complete", renderJobId: renderJob.id, durationMs: duration },
      `[v2] Selection recorded: variant=${selected_variant_id}, upscaled=${upscale}`
    );

    return json({
      success: true,
      render_job_id: renderJob.id,
      selected_variant: selected_variant_id,
      final_image_url: finalImageUrl,
      upscaled: upscale,
      duration_ms: duration,
      version: 'v2',
    }, { headers: corsHeaders });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { ...shopLogContext, stage: "v2-select-error" },
      `[v2] Selection processing failed`,
      error
    );

    return json({
      error: "selection_failed",
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
