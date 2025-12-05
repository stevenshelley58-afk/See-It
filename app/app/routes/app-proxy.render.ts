import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enforceQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { compositeScene } from "../services/gemini.server";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const action = async ({ request }: ActionFunctionArgs) => {
    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: CORS_HEADERS });
    }

    const body = await request.json();
    const { product_id, variant_id, room_session_id, placement, config } = body;

    // Validate required placement data (NaN check - typeof NaN === 'number')
    if (!placement || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) {
        console.error('Invalid placement:', placement);
        return json(
            { error: "invalid_placement", message: "Placement x, y, and scale are required" },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    // Validate room_session_id
    if (!room_session_id) {
        return json(
            { error: "missing_session", message: "room_session_id is required" },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    // Rate limiting check
    if (!checkRateLimit(room_session_id || 'anonymous')) {
        return json(
            { error: "rate_limit_exceeded", message: "Too many requests. Please wait a moment." },
            { status: 429, headers: CORS_HEADERS }
        );
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) return json({ error: "Shop not found" }, { status: 404, headers: CORS_HEADERS });

    // Quota Check & Increment
    try {
        await enforceQuota(shop.id, "render", 1);
    } catch (error) {
        if (error instanceof Response) {
            throw error;
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
        return json({ job_id: job.id, status: "failed", error: "room_not_found" }, { headers: CORS_HEADERS });
    }

    // Get product image URL - prefer prepared (bg removed), then fallback to original from Shopify
    let productImageUrl: string | null = null;
    
    if (productAsset?.preparedImageUrl) {
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
        return json({ job_id: job.id, status: "failed", error: "no_product_image" }, { headers: CORS_HEADERS });
    }

    console.log(`[Render] Processing composite:`, {
        productImageUrl: productImageUrl.substring(0, 80),
        roomSessionId: room_session_id,
        hasProductAsset: !!productAsset,
        placement
    });

    try {
        // CRITICAL: Use cleaned room if available, otherwise use original
        const roomImageUrl = roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl;
        
        if (!roomImageUrl) {
            throw new Error("No room image URL available");
        }

        // Call Gemini directly - no more Cloud Run!
        const imageUrl = await compositeScene(
            productImageUrl,
            roomImageUrl,
            { x: placement.x, y: placement.y, scale: placement.scale || 1.0 },
            config?.style_preset || "neutral"
        );

        await prisma.renderJob.update({
            where: { id: job.id },
            data: { status: "completed", imageUrl: imageUrl, completedAt: new Date() }
        });
    } catch (error) {
        console.error("[Render] Gemini error:", error);
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
