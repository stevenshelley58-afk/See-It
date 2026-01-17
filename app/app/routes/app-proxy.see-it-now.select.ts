// See It Now - User Selection Handler
// Records which variant the user chose, optionally upscales with Pro model
//
// Access: Only shops in SEE_IT_NOW_ALLOWED_SHOPS can use this feature

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { validateTrustedUrl } from "../utils/validate-shopify-url.server";
import { GCS_BUCKET } from "../utils/gcs-client.server";

// Import model config from centralized source
import { GEMINI_IMAGE_MODEL_PRO, GEMINI_IMAGE_MODEL_FAST } from "~/config/ai-models.config";

import { isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";
import { logSeeItNowEvent } from "~/services/session-logger.server";

function isSafeVariantId(value: unknown): value is string {
  // Accept any reasonable identifier. (The extension currently doesn't call this endpoint,
  // but keeping it permissive avoids mismatches if it is used later.)
  if (typeof value !== "string") return false;
  const id = value.trim();
  if (!id) return false;
  if (id.length > 64) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id);
}

function extractGcsKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase();

    // Path-style: https://storage.googleapis.com/BUCKET/key...
    if (hostname === "storage.googleapis.com" || hostname === "storage.cloud.google.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && parts[0] === GCS_BUCKET) {
        return parts.slice(1).join("/");
      }
      return null;
    }

    // Subdomain-style: https://BUCKET.storage.googleapis.com/key...
    if (hostname.endsWith(".storage.googleapis.com") || hostname.endsWith(".storage.cloud.google.com")) {
      const bucket = hostname.split(".")[0];
      if (bucket !== GCS_BUCKET) return null;
      return u.pathname.replace(/^\/+/, "");
    }

    return null;
  } catch {
    return null;
  }
}

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
    `[See It Now] Downloading image: ${url.substring(0, 80)}...`
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
    `[See It Now] Upscaling image with Pro model`
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
            `[See It Now] Upscale completed in ${duration}ms`
          );
          return Buffer.from(part.inlineData.data, 'base64');
        }
      }
    }

    throw new Error('No image in upscale response');
  } catch (error) {
    logger.warn(
      { ...logContext, stage: "upscale-failed" },
      `[See It Now] Upscale failed, returning original image`,
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
  const logContext = createLogContext("render", requestId, "see-it-now-select", { version: 'see-it-now' });

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
  let body: {
    session_id?: string;
    selected_variant_id?: string;
    room_session_id?: string;
    selected_image_url?: string; // The actual image URL to save/upscale
    upscale?: boolean; // Optional: whether to upscale with Pro model
    product_id?: string; // Optional: track which product the user selected for
  };

  try {
    body = await request.json();
  } catch {
    return json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      { status: 400, headers: corsHeaders }
    );
  }

  const { session_id, selected_variant_id, room_session_id, selected_image_url, upscale = false, product_id } = body;

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

  // Validate variant ID (permissive)
  if (!isSafeVariantId(selected_variant_id)) {
    return json(
      { error: "invalid_variant_id", message: "selected_variant_id is invalid" },
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
      `[See It Now] Shop not found: ${session.shop}`
    );
    return json({ error: "shop_not_found" }, { status: 404, headers: corsHeaders });
  }

  const shopLogContext = {
    ...logContext,
    shopId: shop.id,
    seeItNowSessionId: session_id,
    selectedVariant: selected_variant_id,
  };

  logger.info(
    { ...shopLogContext, stage: "see-it-now-select" },
    `[See It Now] User selected variant: ${selected_variant_id}`
  );

  try {
    let finalImageUrl = selected_image_url;
    let finalImageKey: string | null = null;

    // If we have an image URL and upscale is requested, process it
    if (selected_image_url && upscale) {
      logger.info(
        { ...shopLogContext, stage: "upscale-requested" },
        `[See It Now] Upscale requested for variant ${selected_variant_id}`
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
      const key = `see-it-now-renders/${session_id}/${selected_variant_id}_upscaled_${Date.now()}.jpg`;
      finalImageUrl = await StorageService.uploadBuffer(finalBuffer, key, 'image/jpeg');
      finalImageKey = key;

      logger.info(
        { ...shopLogContext, stage: "upscale-uploaded" },
        `[See It Now] Upscaled image uploaded: ${key}`
      );
    }

    // Log the selection to database
    // Create a RenderJob record to track this See It Now selection
    const inferredKeyFromUrl =
      !finalImageKey && finalImageUrl ? extractGcsKeyFromUrl(finalImageUrl) : null;

    const renderJob = await prisma.renderJob.create({
      data: {
        shop: { connect: { id: shop.id } },
        productId: product_id || 'see-it-now-selection',
        roomSession: { connect: { id: room_session_id } },
        placementX: 0, // See It Now doesn't use manual placement
        placementY: 0,
        placementScale: 1,
        stylePreset: 'see-it-now-hero-shot',
        quality: upscale ? 'high' : 'standard',
        configJson: JSON.stringify({
          version: 'see-it-now',
          seeItNowSessionId: session_id,
          selectedVariant: selected_variant_id,
          upscaled: upscale,
          productId: product_id || undefined,
        }),
        status: "completed",
        imageUrl: finalImageUrl || null,
        imageKey: finalImageKey || inferredKeyFromUrl,
        createdAt: new Date(),
        completedAt: new Date(),
      }
    });

    const duration = Date.now() - startTime;

    logger.info(
      { ...shopLogContext, stage: "see-it-now-select-complete", renderJobId: renderJob.id, durationMs: duration },
      `[See It Now] Selection recorded: variant=${selected_variant_id}, upscaled=${upscale}`
    );

    // Log variant selection to monitor
    logSeeItNowEvent('variant_selected', {
      sessionId: session_id,
      shop: session.shop,
      roomSessionId: room_session_id,
      selectedVariantId: selected_variant_id,
      selectedImageUrl: finalImageUrl || undefined,
      upscaled: upscale,
    });

    return json({
      success: true,
      render_job_id: renderJob.id,
      selected_variant: selected_variant_id,
      final_image_url: finalImageUrl,
      upscaled: upscale,
      duration_ms: duration,
      version: 'see-it-now',
    }, { headers: corsHeaders });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { ...shopLogContext, stage: "see-it-now-select-error" },
      `[See It Now] Selection processing failed`,
      error
    );

    // Log error to monitor
    logSeeItNowEvent('error', {
      sessionId: session_id,
      shop: session.shop,
      roomSessionId: room_session_id,
      errorCode: 'selection_failed',
      errorMessage: errorMessage,
      step: 'variant_selected',
    });

    return json({
      error: "selection_failed",
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
