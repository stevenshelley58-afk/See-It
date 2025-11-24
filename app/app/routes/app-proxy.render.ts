import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enforceQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";

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

    // Rate limiting check
    if (!checkRateLimit(room_session_id)) {
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
            shopId: shop.id,
            productId: product_id,
            variantId: variant_id,
            roomSessionId: room_session_id,
            placementX: placement.x,
            placementY: placement.y,
            placementScale: placement.scale,
            stylePreset: config.style_preset,
            quality: config.quality,
            configJson: JSON.stringify(config),
            status: "queued",
            createdAt: new Date(),
        }
    });

    const productAsset = await prisma.productAsset.findFirst({
        where: { shopId: shop.id, productId: product_id }
    });

    const roomSession = await prisma.roomSession.findUnique({
        where: { id: room_session_id }
    });

    if (!productAsset || !roomSession) {
        await prisma.renderJob.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: "Asset or Room not found" }
        });
        return json({ job_id: job.id, status: "failed" });
    }

    const imageServiceUrl = process.env.IMAGE_SERVICE_BASE_URL;
    console.log(`[Proxy] Sending render request to ${imageServiceUrl}/scene/composite`);

    try {
        // CRITICAL Phase 2 logic: Use cleaned room if available, otherwise use original
        const roomImageUrl = roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl;

        const response = await fetch(`${imageServiceUrl}/scene/composite`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.IMAGE_SERVICE_TOKEN}`
            },
            body: JSON.stringify({
                prepared_product_image_url: productAsset.preparedImageUrl || productAsset.sourceImageUrl,
                room_image_url: roomImageUrl,
                placement: { x: placement.x, y: placement.y, scale: placement.scale },
                prompt: { id: "scene_composite", version: 1, style_preset: config.style_preset || "neutral" },
                model: { id: "gemini-3-pro-image" }
            })
        });

        if (!response.ok) {
            throw new Error(`Image service returned ${response.status}`);
        }

        const data = await response.json();
        const { image_url } = data;

        await prisma.renderJob.update({
            where: { id: job.id },
            data: { status: "completed", imageUrl: image_url, completedAt: new Date() }
        });
    } catch (error) {
        console.error("Image Service error:", error);
        await prisma.renderJob.update({
            where: { id: job.id },
            data: {
                status: "failed",
                errorCode: "IMAGE_SERVICE_ERROR",
                errorMessage: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }

    return json({ job_id: job.id });
};
