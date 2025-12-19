// Render endpoint - v1.0.18 - Fixed to allow product images without pre-prepared assets
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkQuota, incrementQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { compositeScene } from "../services/gemini.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";

function getCorsHeaders(shopDomain: string | null): Record<string, string> {
    // Only set CORS origin if we have a valid shop domain
    // Empty origin or "*" would be a security risk
    if (!shopDomain) {
        return {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };
    }
    return {
        "Access-Control-Allow-Origin": `https://${shopDomain}`,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const requestId = getRequestId(request);
    const logContext = createLogContext("render", requestId, "start", {});

    const { session } = await authenticate.public.appProxy(request);
    const corsHeaders = getCorsHeaders(session?.shop ?? null);

    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!session) {
        logger.warn(
            { ...logContext, stage: "auth" },
            `App proxy auth failed: no session. URL: ${request.url}`
        );
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const { product_id, variant_id, room_session_id, placement, config } = body;

    // Validate required placement data (NaN check - typeof NaN === 'number')
    if (!placement || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) {
        logger.error(
            { ...logContext, stage: "validation" },
            `Invalid placement data: ${JSON.stringify(placement)}`
        );
        return json(
            { error: "invalid_placement", message: "Placement x, y, and scale are required" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Validate room_session_id
    if (!room_session_id) {
        return json(
            { error: "missing_session", message: "room_session_id is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Rate limiting check
    if (!checkRateLimit(room_session_id || 'anonymous')) {
        return json(
            { error: "rate_limit_exceeded", message: "Too many requests. Please wait a moment." },
            { status: 429, headers: corsHeaders }
        );
    }

    const shop = await prisma.shop.findUnique({ 
        where: { shopDomain: session.shop },
        select: { id: true, settingsJson: true }
    });
    if (!shop) {
        logger.error(
            { ...logContext, stage: "shop-lookup" },
            `Shop not found in database: ${session.shop}`
        );
        return json({ error: "Shop not found" }, { status: 404, headers: corsHeaders });
    }

    // Parse shop settings to get product context
    let productContext = "";
    try {
        const settings = shop.settingsJson ? JSON.parse(shop.settingsJson) : {};
        productContext = settings.product_context || "";
    } catch (e) {
        logger.warn({ ...logContext, stage: "settings-parse" }, "Failed to parse shop settings");
    }

    // Update log context with shop info
    const shopLogContext = { ...logContext, shopId: shop.id, productId: product_id };

    // Quota Check (before starting render)
    try {
        await checkQuota(shop.id, "render", 1);
    } catch (error) {
        if (error instanceof Response) {
            // Return 429 with proper headers
            const headers = { ...corsHeaders, "Content-Type": "application/json" };
            return new Response(error.body, { status: error.status, headers });
        }
        throw error;
    }

    const job = await prisma.renderJob.create({
        data: {
            shop: { connect: { id: shop.id } },
            productId: product_id,
            variantId: variant_id || null,
            roomSession: room_session_id ? { connect: { id: room_session_id } } : undefined,
            placementX: placement.x,
            placementY: placement.y,
            placementScale: placement.scale || 1.0,
            stylePreset: config?.style_preset || "neutral",
            quality: config?.quality || "standard",
            configJson: JSON.stringify(config || {}),
            status: "queued",
            createdAt: new Date(),
        }
    });

    // Product asset is optional - we can render without background removal
    const productAsset = await prisma.productAsset.findFirst({
        where: { shopId: shop.id, productId: product_id }
    });

    const roomSession = await prisma.roomSession.findUnique({
        where: { id: room_session_id }
    });

    if (!roomSession) {
        await prisma.renderJob.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: "Room session not found" }
        });
        return json({ job_id: job.id, status: "failed", error: "room_not_found" }, { headers: corsHeaders });
    }

    // Get product image URL - prefer prepared (bg removed), then fallback to original from Shopify
    // Generate fresh signed URL from key if available to prevent 403 from expired URLs
    let productImageUrl: string | null = null;

    if (productAsset?.preparedImageKey) {
        // Generate fresh signed URL from stored key
        try {
            productImageUrl = await StorageService.getSignedReadUrl(
                productAsset.preparedImageKey,
                60 * 60 * 1000 // 1 hour
            );
        } catch (error) {
            logger.warn(
                { ...shopLogContext, stage: "product-url-fallback" },
                "Failed to generate signed URL from key, falling back to stored URL",
                error
            );
            productImageUrl = productAsset.preparedImageUrl ?? null;
        }
    } else if (productAsset?.preparedImageUrl) {
        productImageUrl = productAsset.preparedImageUrl;
    } else if (productAsset?.sourceImageUrl) {
        productImageUrl = productAsset.sourceImageUrl;
    } else if (config?.product_image_url) {
        // Fallback: use the product image URL sent from the frontend
        productImageUrl = config.product_image_url;
    }

    if (!productImageUrl) {
        await prisma.renderJob.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: "No product image available" }
        });
        return json({ job_id: job.id, status: "failed", error: "no_product_image" }, { headers: corsHeaders });
    }

    logger.info(
        { ...shopLogContext, stage: "composite-start" },
        `Processing composite: productImageUrl=${productImageUrl.substring(0, 80)}, roomSessionId=${room_session_id}, hasProductAsset=${!!productAsset}`
    );

    try {
        // Generate fresh room image URL from stored key (cleaned if available, otherwise original)
        // For legacy sessions without keys, fall back to stored URLs
        let roomImageUrl: string;

        if (roomSession.cleanedRoomImageKey) {
            // Generate fresh URL from cleaned image key
            roomImageUrl = await StorageService.getSignedReadUrl(roomSession.cleanedRoomImageKey, 60 * 60 * 1000);
        } else if (roomSession.originalRoomImageKey) {
            // Generate fresh URL from original image key
            roomImageUrl = await StorageService.getSignedReadUrl(roomSession.originalRoomImageKey, 60 * 60 * 1000);
        } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
            // Legacy: use stored URL if no keys available
            roomImageUrl = roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl;
        } else {
            throw new Error("No room image available");
        }

        // Call Gemini directly - no more Cloud Run!
        const imageUrl = await compositeScene(
            productImageUrl,
            roomImageUrl,
            { x: placement.x, y: placement.y, scale: placement.scale || 1.0 },
            config?.style_preset || "neutral",
            requestId,
            productContext // Pass merchant's product description for better AI results
        );

        await prisma.renderJob.update({
            where: { id: job.id },
            data: { status: "completed", imageUrl: imageUrl, completedAt: new Date() }
        });

        // Increment quota only after successful render
        await incrementQuota(shop.id, "render", 1);

        logger.info(
            { ...shopLogContext, stage: "complete" },
            `Render completed successfully: jobId=${job.id}`
        );
    } catch (error) {
        logger.error(
            { ...shopLogContext, stage: "composite-error" },
            "Gemini composite failed",
            error
        );
        await prisma.renderJob.update({
            where: { id: job.id },
            data: {
                status: "failed",
                errorCode: "GEMINI_ERROR",
                errorMessage: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }

    return json({ job_id: job.id });
};
