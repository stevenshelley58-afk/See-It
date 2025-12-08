// Render endpoint - v1.0.19 - Async Queue Implementation
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";

export const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const requestId = getRequestId(request);
    const logContext = createLogContext("render", requestId, "start", {});

    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        logger.warn(
            { ...logContext, stage: "auth" },
            `App proxy auth failed: no session. URL: ${request.url}`
        );
        return json({ status: "forbidden" }, { status: 403, headers: CORS_HEADERS });
    }

    try {
        const body = await request.json();
        const { product_id, variant_id, room_session_id, placement, config } = body;

        // Validate required placement data
        if (!placement || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) {
            logger.error(
                { ...logContext, stage: "validation" },
                `Invalid placement data: ${JSON.stringify(placement)}`
            );
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
        if (!shop) {
            logger.error(
                { ...logContext, stage: "shop-lookup" },
                `Shop not found in database: ${session.shop}`
            );
            return json({ error: "Shop not found" }, { status: 404, headers: CORS_HEADERS });
        }

        // Update log context
        const shopLogContext = { ...logContext, shopId: shop.id, productId: product_id };

        // Quota Check
        try {
            await checkQuota(shop.id, "render", 1);
        } catch (error) {
            if (error instanceof Response) {
                // Return 429 with proper headers
                const headers = { ...CORS_HEADERS, "Content-Type": "application/json" };
                return new Response(error.body, { status: error.status, headers });
            }
            throw error;
        }

        // Create Job - Queued
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

        // Log that we queued it
        logger.info(
            { ...shopLogContext, stage: "queued" },
            `Render job queued: ${job.id}`
        );

        // Return immediately
        return json({ job_id: job.id }, { headers: CORS_HEADERS });

    } catch (error) {
        logger.error(
            { ...logContext, stage: "handler-error" },
            "Render endpoint failed",
            error
        );
        return json(
            { error: "server_error", message: "Failed to process request" },
            { status: 500, headers: CORS_HEADERS }
        );
    }
};
