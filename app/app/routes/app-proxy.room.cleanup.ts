import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { incrementQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { StorageService } from "../services/storage.server";
import { cleanupRoom } from "../services/room-cleanup.server";
import { logger, createLogContext } from "../utils/logger.server";
import { validateSessionId, validateMaskDataUrl } from "../utils/validation.server";
import { getRequestId } from "../utils/request-context.server";

// Maximum inline mask size (10MB - protects payload + memory)
const MAX_INLINE_MASK_SIZE_BYTES = 10 * 1024 * 1024;

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

/**
 * POST /apps/see-it/room/cleanup
 * 
 * Removes objects from a room image using a mask.
 * Returns a job_id for polling via GET /apps/see-it/render/:jobId
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    const requestId = getRequestId(request);
    const logContext = createLogContext("cleanup", requestId, "start", {});

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

    let body: any;
    try {
        body = await request.json();
    } catch (error) {
        return json(
            { error: "invalid_json", message: "Invalid JSON in request body" },
            { status: 400, headers: corsHeaders }
        );
    }

    const { room_session_id, mask_data_url, mask_image_key, quality } = body;

    // Validate room_session_id
    const sessionResult = validateSessionId(room_session_id);
    if (!sessionResult.valid) {
        return json(
            { error: sessionResult.error },
            { status: 400, headers: corsHeaders }
        );
    }
    const sanitizedSessionId = sessionResult.sanitized!;

    // Validate mask source (must provide one)
    if (!mask_data_url && !mask_image_key) {
        return json(
            { error: "missing_mask", message: "Either mask_data_url or mask_image_key is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Validate inline mask if provided
    let maskBuffer: Buffer | null = null;
    if (mask_data_url) {
        const maskValidation = validateMaskDataUrl(mask_data_url, MAX_INLINE_MASK_SIZE_BYTES);
        if (!maskValidation.valid) {
            return json(
                { 
                    error: "invalid_mask", 
                    message: maskValidation.error,
                    suggestion: "If mask is too large, use /apps/see-it/room/mask-start to upload first"
                },
                { status: 400, headers: corsHeaders }
            );
        }

        // Decode base64 mask
        try {
            const maskBase64 = mask_data_url.split(',')[1];
            if (!maskBase64) {
                throw new Error("Invalid data URL format");
            }
            maskBuffer = Buffer.from(maskBase64, 'base64');
        } catch (error) {
            logger.error(
                { ...logContext, stage: "mask-decode" },
                "Failed to decode mask data URL",
                error
            );
            return json(
                { error: "invalid_mask", message: "Failed to decode mask data URL" },
                { status: 400, headers: corsHeaders }
            );
        }
    }

    // Rate limiting check
    if (!checkRateLimit(sanitizedSessionId)) {
        return json(
            { error: "rate_limit_exceeded", message: "Too many requests. Please wait a moment." },
            { status: 429, headers: corsHeaders }
        );
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) {
        logger.error(
            { ...logContext, stage: "shop-lookup" },
            `Shop not found in database: ${session.shop}`
        );
        return json({ error: "Shop not found" }, { status: 404, headers: corsHeaders });
    }

    // Update log context with shop info
    const shopLogContext = { ...logContext, shopId: shop.id };

    // Note: Cleanup quota is logged but not blocked (similar to prep)
    // We increment quota after successful cleanup, but don't check/block upfront

    // Find room session
    const roomSession = await prisma.roomSession.findUnique({
        where: { id: sanitizedSessionId },
        include: { shop: true }
    });

    if (!roomSession || roomSession.shop.shopDomain !== session.shop) {
        return json({ error: "Room session not found" }, { status: 404, headers: corsHeaders });
    }

    // Get room image URL (prefer key-based signed URL)
    let roomImageUrl: string;
    if (roomSession.originalRoomImageKey) {
        try {
            roomImageUrl = await StorageService.getSignedReadUrl(roomSession.originalRoomImageKey, 60 * 60 * 1000);
        } catch (error) {
            logger.warn(
                { ...shopLogContext, stage: "room-url-fallback" },
                "Failed to generate signed URL from key, falling back to stored URL",
                error
            );
            roomImageUrl = roomSession.originalRoomImageUrl || "";
        }
    } else if (roomSession.originalRoomImageUrl) {
        roomImageUrl = roomSession.originalRoomImageUrl;
    } else {
        return json(
            { error: "no_room_image", message: "Room image not found" },
            { status: 400, headers: corsHeaders }
        );
    }

    // If mask is provided via key, fetch it from GCS
    if (mask_image_key && !maskBuffer) {
        try {
            const maskUrl = await StorageService.getSignedReadUrl(mask_image_key, 60 * 60 * 1000);
            const maskResponse = await fetch(maskUrl);
            if (!maskResponse.ok) {
                throw new Error(`Failed to fetch mask: ${maskResponse.status}`);
            }
            const maskArrayBuffer = await maskResponse.arrayBuffer();
            maskBuffer = Buffer.from(maskArrayBuffer);
        } catch (error) {
            logger.error(
                { ...shopLogContext, stage: "mask-fetch" },
                "Failed to fetch mask from GCS",
                error
            );
            return json(
                { error: "mask_fetch_failed", message: "Failed to load mask image" },
                { status: 400, headers: corsHeaders }
            );
        }
    }

    if (!maskBuffer) {
        return json(
            { error: "no_mask", message: "Mask buffer is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Create job record (reuse render_jobs table with job_type in configJson)
    const job = await prisma.renderJob.create({
        data: {
            shop: { connect: { id: shop.id } },
            productId: "cleanup", // Dummy product ID for cleanup jobs
            roomSession: { connect: { id: sanitizedSessionId } },
            placementX: 0, // Dummy placement
            placementY: 0,
            placementScale: 1.0,
            configJson: JSON.stringify({
                job_type: "room_cleanup",
                room_session_id: sanitizedSessionId,
                mask_source: mask_data_url ? "inline" : "gcs",
                mask_image_key: mask_image_key || null,
                quality: quality || "fast"
            }),
            status: "queued",
            createdAt: new Date(),
        }
    });

    logger.info(
        { ...shopLogContext, stage: "cleanup-start" },
        `Processing cleanup: roomImageUrl=${roomImageUrl.substring(0, 80)}, jobId=${job.id}, maskSize=${maskBuffer.length}`
    );

    try {
        // Process cleanup
        const result = await cleanupRoom(roomImageUrl, maskBuffer, requestId);

        // Store cleaned image key on room session
        await prisma.roomSession.update({
            where: { id: sanitizedSessionId },
            data: {
                cleanedRoomImageKey: result.imageKey,
                cleanedRoomImageUrl: result.imageUrl, // Legacy compatibility
                lastUsedAt: new Date()
            }
        });

        // Update job status
        await prisma.renderJob.update({
            where: { id: job.id },
            data: {
                status: "completed",
                imageUrl: result.imageUrl,
                imageKey: result.imageKey,
                completedAt: new Date()
            }
        });

        // Increment quota only after successful cleanup
        await incrementQuota(shop.id, "cleanup", 1);

        logger.info(
            { ...shopLogContext, stage: "complete" },
            `Cleanup completed successfully: jobId=${job.id}, imageKey=${result.imageKey}`
        );

        // Return job_id with status so client can skip polling if already complete
        return json({
            job_id: job.id,
            status: "completed",
            cleaned_room_image_url: result.imageUrl,
            cleanedRoomImageUrl: result.imageUrl
        }, { headers: corsHeaders });
    } catch (error) {
        logger.error(
            { ...shopLogContext, stage: "cleanup-error" },
            "Cleanup failed",
            error
        );

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorCode = errorMessage.includes("dimension") ? "dimension_mismatch" : "cleanup_failed";

        await prisma.renderJob.update({
            where: { id: job.id },
            data: {
                status: "failed",
                errorCode,
                errorMessage,
                completedAt: new Date()
            }
        });
    }

    // If we get here, the job failed - still return job_id so client can poll for error details
    return json({ job_id: job.id, status: "failed" }, { headers: corsHeaders });
};
