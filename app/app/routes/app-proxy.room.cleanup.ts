/**
 * Room Cleanup Endpoint - Vertex AI Imagen 3 Object Removal
 * 
 * POST /apps/see-it/room/cleanup
 * 
 * Removes objects from a room image using a user-provided mask.
 * Uses Vertex AI Imagen 3 with EDIT_MODE_INPAINT_REMOVAL.
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { incrementQuota, checkQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { removeObject } from "../services/image-removal.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import sharp from "sharp";

// Maximum inline mask size (10MB)
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
            `App proxy auth failed: no session`
        );
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const { room_session_id, mask_data_url, mask_base64: rawMaskBase64 } = body;

    // Validate room_session_id
    if (!room_session_id) {
        return json(
            { error: "missing_session", message: "room_session_id is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Extract base64 from data URL or use raw base64
    // Frontend sends mask_data_url as "data:image/png;base64,..."
    let mask_base64: string;
    if (mask_data_url) {
        const match = mask_data_url.match(/^data:image\/\w+;base64,(.+)$/);
        if (match) {
            mask_base64 = match[1];
        } else {
            // Assume it's already raw base64
            mask_base64 = mask_data_url;
        }
    } else if (rawMaskBase64) {
        mask_base64 = rawMaskBase64;
    } else {
        return json(
            { error: "missing_mask", message: "mask_data_url or mask_base64 is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Check mask size
    const maskSize = Buffer.byteLength(mask_base64, 'utf8');
    if (maskSize > MAX_INLINE_MASK_SIZE_BYTES) {
        return json(
            { error: "mask_too_large", message: `Mask exceeds ${MAX_INLINE_MASK_SIZE_BYTES / 1024 / 1024}MB limit` },
            { status: 400, headers: corsHeaders }
        );
    }

    // Rate limiting
    if (!checkRateLimit(room_session_id)) {
        return json(
            { error: "rate_limit_exceeded", message: "Too many requests. Please wait." },
            { status: 429, headers: corsHeaders }
        );
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) {
        logger.error(
            { ...logContext, stage: "shop-lookup" },
            `Shop not found: ${session.shop}`
        );
        return json({ error: "shop_not_found" }, { status: 404, headers: corsHeaders });
    }

    // Quota check
    try {
        await checkQuota(shop.id, "cleanup", 1);
    } catch (error) {
        if (error instanceof Response) {
            const headers = { ...corsHeaders, "Content-Type": "application/json" };
            return new Response(error.body, { status: error.status, headers });
        }
        throw error;
    }

    // Get room session
    const roomSession = await prisma.roomSession.findUnique({
        where: { id: room_session_id }
    });

    if (!roomSession) {
        return json(
            { error: "room_not_found", message: "Room session not found" },
            { status: 404, headers: corsHeaders }
        );
    }

    // Get room image - preference: cleaned > canonical > original
    // For new sessions, canonical is required (will be checked later)
    let roomImageUrl: string;
    let roomImageKey: string | null = null;

    if (roomSession.cleanedRoomImageKey) {
        roomImageKey = roomSession.cleanedRoomImageKey;
        roomImageUrl = await StorageService.getSignedReadUrl(roomImageKey, 60 * 60 * 1000);
    } else if (roomSession.canonicalRoomImageKey) {
        roomImageKey = roomSession.canonicalRoomImageKey;
        roomImageUrl = await StorageService.getSignedReadUrl(roomImageKey, 60 * 60 * 1000);
    } else if (roomSession.originalRoomImageKey) {
        roomImageKey = roomSession.originalRoomImageKey;
        roomImageUrl = await StorageService.getSignedReadUrl(roomImageKey, 60 * 60 * 1000);
    } else if (roomSession.cleanedRoomImageUrl) {
        roomImageUrl = roomSession.cleanedRoomImageUrl;
    } else if (roomSession.originalRoomImageUrl) {
        roomImageUrl = roomSession.originalRoomImageUrl;
    } else {
        return json(
            { error: "no_room_image", message: "No room image available" },
            { status: 400, headers: corsHeaders }
        );
    }

    logger.info(
        { ...logContext, stage: "processing", roomSessionId: room_session_id },
        `Starting object removal for room session`
    );

    try {
        // Download room image and convert to base64
        const roomResponse = await fetch(roomImageUrl);
        if (!roomResponse.ok) {
            throw new Error(`Failed to fetch room image: ${roomResponse.status}`);
        }
        const roomBuffer = Buffer.from(await roomResponse.arrayBuffer());

        // Get room image dimensions
        const roomMetadata = await sharp(roomBuffer).metadata();
        const roomWidth = roomMetadata.width!;
        const roomHeight = roomMetadata.height!;

        // Process mask - ensure it matches room dimensions
        const maskBuffer = Buffer.from(mask_base64, 'base64');
        const maskMetadata = await sharp(maskBuffer).metadata();

        logger.info(
            { ...logContext, stage: "mask-debug" },
            `Room: ${roomWidth}x${roomHeight}, Mask: ${maskMetadata.width}x${maskMetadata.height}, Mask channels: ${maskMetadata.channels}`
        );

        let processedMaskBuffer: Buffer;
        if (maskMetadata.width !== roomWidth || maskMetadata.height !== roomHeight) {
            logger.info(
                { ...logContext, stage: "resize-mask" },
                `Resizing mask from ${maskMetadata.width}x${maskMetadata.height} to ${roomWidth}x${roomHeight}`
            );
            // Resize and convert to grayscale to ensure binary mask
            processedMaskBuffer = await sharp(maskBuffer)
                .resize(roomWidth, roomHeight, { fit: 'fill' })
                .grayscale()
                .png()
                .toBuffer();
        } else {
            // Ensure grayscale even if no resize needed
            processedMaskBuffer = await sharp(maskBuffer)
                .grayscale()
                .png()
                .toBuffer();
        }

        // Convert to base64 (without data URI prefix)
        const roomBase64 = roomBuffer.toString('base64');
        const maskBase64Clean = processedMaskBuffer.toString('base64');


        // Call Vertex AI Imagen 3
        const result = await removeObject(roomBase64, maskBase64Clean, requestId);

        // Upload cleaned image to GCS
        const cleanedImageBuffer = Buffer.from(result.imageBase64, 'base64');
        const cleanedImageKey = `rooms/${shop.id}/${room_session_id}/cleaned_${Date.now()}.png`;

        const cleanedImageUrl = await StorageService.uploadBuffer(
            cleanedImageBuffer,
            cleanedImageKey,
            'image/png'
        );

        // Update room session with cleaned image
        // IMPORTANT: Invalidate Gemini URI since the image changed
        // Next pre-upload will upload the new cleaned image
        await prisma.roomSession.update({
            where: { id: room_session_id },
            data: {
                cleanedRoomImageUrl: cleanedImageUrl,
                cleanedRoomImageKey: cleanedImageKey,
                // Invalidate stale Gemini URI - it was for the old image
                geminiFileUri: null,
                geminiFileExpiresAt: null,
            }
        });

        // Increment quota
        await incrementQuota(shop.id, "cleanup", 1);

        logger.info(
            { ...logContext, stage: "complete" },
            `Object removal completed successfully`
        );

        return json({
            status: "completed",
            cleaned_image_url: cleanedImageUrl,
            cleanedRoomImageUrl: cleanedImageUrl, // For frontend compatibility
            cleaned_room_image_url: cleanedImageUrl, // Alternative format
        }, { headers: corsHeaders });

    } catch (error) {
        logger.error(
            { ...logContext, stage: "error" },
            `Object removal failed`,
            error
        );

        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        return json({
            status: "failed",
            error: "cleanup_failed",
            message: errorMessage
        }, { status: 500, headers: corsHeaders });
    }
};
