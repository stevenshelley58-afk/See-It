// Render endpoint - v1.0.20 - With Input Validation
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import {
    validatePlacement,
    validateSessionId,
    validateProductId,
    validateStylePreset,
    validateQuality
} from "../utils/validation.server";

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

        // Validate placement data with sanitization
        const placementResult = validatePlacement(placement);
        if (!placementResult.valid) {
            logger.error(
                { ...logContext, stage: "validation" },
                `Invalid placement data: ${placementResult.error}`
            );
            return json(
                { error: "invalid_placement", message: placementResult.error },
                { status: 400, headers: CORS_HEADERS }
            );
        }
        const sanitizedPlacement = placementResult.sanitized!;

        // Validate room_session_id
        const sessionResult = validateSessionId(room_session_id);
        if (!sessionResult.valid) {
            return json(
                { error: "invalid_session", message: sessionResult.error },
                { status: 400, headers: CORS_HEADERS }
            );
        }
        const sanitizedSessionId = sessionResult.sanitized!;

        // Validate product_id
        const productResult = validateProductId(product_id);
        if (!productResult.valid) {
            return json(
                { error: "invalid_product", message: productResult.error },
                { status: 400, headers: CORS_HEADERS }
            );
        }
        const sanitizedProductId = productResult.sanitized!;

        // Rate limiting check
        if (!checkRateLimit(sanitizedSessionId)) {
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
        const shopLogContext = { ...logContext, shopId: shop.id, productId: sanitizedProductId };

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

        // Validate and sanitize style/quality from config
        const stylePreset = validateStylePreset(config?.style_preset);
        const quality = validateQuality(config?.quality);

        // Create Job - Queued with sanitized inputs
        const job = await prisma.renderJob.create({
            data: {
                shop: { connect: { id: shop.id } },
                productId: sanitizedProductId,
                variantId: variant_id ? String(variant_id) : null,
                roomSession: { connect: { id: sanitizedSessionId } },
                placementX: sanitizedPlacement.x,
                placementY: sanitizedPlacement.y,
                placementScale: sanitizedPlacement.scale,
                stylePreset,
                quality,
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
