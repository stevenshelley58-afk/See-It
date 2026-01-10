import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";
import { validateSessionId } from "../utils/validation.server";
import sharp from "sharp";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";

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
    const logContext = createLogContext("room-confirm", requestId, "start", {});

    const { session } = await authenticate.public.appProxy(request);
    const corsHeaders = getCorsHeaders(session?.shop ?? null);

    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const { room_session_id, crop_params } = body;

    // Validate session ID
    const sessionResult = validateSessionId(room_session_id);
    if (!sessionResult.valid) {
        return json({ error: sessionResult.error }, { status: 400, headers: corsHeaders });
    }
    const sanitizedSessionId = sessionResult.sanitized!;

    const roomSession = await prisma.roomSession.findUnique({
        where: { id: sanitizedSessionId },
        include: { shop: true }
    });

    if (!roomSession || roomSession.shop.shopDomain !== session.shop) {
        return json({ error: "Session not found" }, { status: 404, headers: corsHeaders });
    }

    // Use stored key if available, otherwise construct it (for legacy sessions)
    const originalKey = roomSession.originalRoomImageKey || `rooms/${roomSession.shopId}/${roomSession.id}/room.jpg`;

    // Check if file exists
    const fileExists = await StorageService.fileExists(originalKey);
    if (!fileExists) {
        return json({ error: "Room image not uploaded yet" }, { status: 400, headers: corsHeaders });
    }

    // If crop_params provided, generate canonical image
    if (crop_params) {
        try {
            logger.info(
                { ...logContext, sessionId: sanitizedSessionId },
                `Generating canonical room image with crop params: ${JSON.stringify(crop_params)}`
            );

            // Download original image from GCS
            const originalUrl = await StorageService.getSignedReadUrl(originalKey, 60 * 60 * 1000);
            const response = await fetch(originalUrl);
            if (!response.ok) {
                throw new Error(`Failed to download original image: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const originalBuffer = Buffer.from(arrayBuffer);

            // Get original image metadata
            const originalMetadata = await sharp(originalBuffer).metadata();
            const originalWidth = originalMetadata.width || 0;
            const originalHeight = originalMetadata.height || 0;

            if (!originalWidth || !originalHeight) {
                throw new Error("Original image missing dimensions");
            }

            // Parse crop params (normalized to oriented dimensions)
            const { ratio_label, ratio_value, crop_rect_norm } = crop_params;

            if (!crop_rect_norm || typeof crop_rect_norm.x !== 'number' || typeof crop_rect_norm.y !== 'number' ||
                typeof crop_rect_norm.w !== 'number' || typeof crop_rect_norm.h !== 'number') {
                throw new Error("Invalid crop_rect_norm format");
            }

            // Apply rotation first (auto-orient based on EXIF, then strip EXIF tag)
            // After rotation, dimensions may change - get the oriented dimensions
            let rotatedBuffer = await sharp(originalBuffer)
                .rotate() // Auto-orient based on EXIF
                .toBuffer();

            const rotatedMetadata = await sharp(rotatedBuffer).metadata();
            const orientedWidth = rotatedMetadata.width || originalWidth;
            const orientedHeight = rotatedMetadata.height || originalHeight;

            // Convert normalized crop rect to pixel coordinates (based on oriented dimensions)
            const cropX = Math.round(crop_rect_norm.x * orientedWidth);
            const cropY = Math.round(crop_rect_norm.y * orientedHeight);
            const cropW = Math.round(crop_rect_norm.w * orientedWidth);
            const cropH = Math.round(crop_rect_norm.h * orientedHeight);

            logger.info(
                { ...logContext, stage: "crop-calc" },
                `Crop rect: ${cropX},${cropY},${cropW}x${cropH} (from norm: ${JSON.stringify(crop_rect_norm)}, oriented: ${orientedWidth}x${orientedHeight})`
            );

            // Extract crop region and resize to max 2048
            const canonicalBuffer = await sharp(rotatedBuffer)
                .extract({
                    left: cropX,
                    top: cropY,
                    width: cropW,
                    height: cropH
                })
                .resize({
                    width: 2048,
                    height: 2048,
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: 90 })
                .toBuffer();

            const canonicalMetadata = await sharp(canonicalBuffer).metadata();
            const canonicalWidth = canonicalMetadata.width || 0;
            const canonicalHeight = canonicalMetadata.height || 0;

            if (!canonicalWidth || !canonicalHeight) {
                throw new Error("Failed to generate canonical image dimensions");
            }

            logger.info(
                { ...logContext, stage: "canonical-generated" },
                `Canonical image generated: ${canonicalWidth}x${canonicalHeight}, ratio: ${ratio_label}`
            );

            // Upload canonical image to GCS
            const canonicalKey = `rooms/${roomSession.shopId}/${sanitizedSessionId}/canonical.jpg`;
            const canonicalUrl = await StorageService.uploadBuffer(
                canonicalBuffer,
                canonicalKey,
                'image/jpeg'
            );

            // Update room session with canonical fields and invalidate Gemini URI
            await prisma.roomSession.update({
                where: { id: sanitizedSessionId },
                data: {
                    canonicalRoomImageKey: canonicalKey,
                    canonicalRoomWidth: canonicalWidth,
                    canonicalRoomHeight: canonicalHeight,
                    canonicalRoomRatioLabel: ratio_label,
                    canonicalRoomRatioValue: ratio_value,
                    canonicalRoomCrop: crop_params,
                    canonicalCreatedAt: new Date(),
                    // Invalidate Gemini URI since room image changed
                    geminiFileUri: null,
                    geminiFileExpiresAt: null,
                    lastUsedAt: new Date()
                }
            });

            logger.info(
                { ...logContext, stage: "complete" },
                `Canonical room image saved: ${canonicalKey}`
            );

            // Return canonical URL + metadata
            return json({
                ok: true,
                canonical_room_image_url: canonicalUrl,
                canonical_width: canonicalWidth,
                canonical_height: canonicalHeight,
                ratio_label: ratio_label,
                // Legacy fields for backward compatibility
                room_image_url: canonicalUrl,
                roomImageUrl: canonicalUrl
            }, { headers: corsHeaders });

        } catch (error) {
            logger.error(
                { ...logContext, stage: "canonical-error" },
                "Failed to generate canonical room image",
                error
            );

            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            return json({
                error: "canonicalization_failed",
                message: errorMessage
            }, { status: 500, headers: corsHeaders });
        }
    }

    // Legacy path: no crop_params - return original URL (backward compatibility)
    // But check if canonical already exists and return that if available
    if (roomSession.canonicalRoomImageKey) {
        const canonicalUrl = await StorageService.getSignedReadUrl(
            roomSession.canonicalRoomImageKey,
            60 * 60 * 1000
        );

        await prisma.roomSession.update({
            where: { id: sanitizedSessionId },
            data: {
                lastUsedAt: new Date()
            }
        });

        return json({
            ok: true,
            canonical_room_image_url: canonicalUrl,
            canonical_width: roomSession.canonicalRoomWidth || null,
            canonical_height: roomSession.canonicalRoomHeight || null,
            ratio_label: roomSession.canonicalRoomRatioLabel || null,
            // Legacy fields
            room_image_url: canonicalUrl,
            roomImageUrl: canonicalUrl
        }, { headers: corsHeaders });
    }

    // Fallback to original image
    const publicUrl = await StorageService.getSignedReadUrl(originalKey, 60 * 60 * 1000);

    await prisma.roomSession.update({
        where: { id: sanitizedSessionId },
        data: {
            originalRoomImageKey: originalKey, // Ensure key is always set
            originalRoomImageUrl: publicUrl, // Legacy field - keep for compatibility
            lastUsedAt: new Date()
        }
    });

    return json({
        ok: true,
        room_image_url: publicUrl,
        roomImageUrl: publicUrl
    }, { headers: corsHeaders });
};
