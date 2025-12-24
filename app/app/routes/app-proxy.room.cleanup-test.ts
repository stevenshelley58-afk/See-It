import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { removeObjectsFromUrl } from "../services/object-removal.server";
import { StorageService } from "../services/storage.server";
import { validateSessionId, validateMaskDataUrl } from "../utils/validation.server";

/**
 * TEST ENDPOINT: Room cleanup using Prodia SDXL inpainting
 * 
 * POST /apps/see-it/room/cleanup-test
 * 
 * This is a test endpoint to compare Prodia vs Gemini for object removal.
 * The main /room/cleanup endpoint remains unchanged.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    const requestId = `cleanup-prodia-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    console.log(`[Cleanup-Prodia] Request started`, { requestId });
    
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        console.warn(`[Cleanup-Prodia] Authentication failed`, { requestId });
        return json({ status: "error", message: "Authentication required" }, { status: 403 });
    }

    let body;
    try {
        body = await request.json();
    } catch (parseError) {
        console.error(`[Cleanup-Prodia] JSON parse failed`, { requestId, error: parseError });
        return json({ status: "error", message: "Invalid request body" }, { status: 400 });
    }
    
    const { room_session_id, mask_data_url } = body;

    // Validate session ID
    if (!room_session_id) {
        return json({ status: "error", message: "room_session_id is required" }, { status: 400 });
    }
    
    const sessionResult = validateSessionId(room_session_id);
    if (!sessionResult.valid) {
        return json({ status: "error", message: sessionResult.error }, { status: 400 });
    }
    const sanitizedSessionId = sessionResult.sanitized!;

    // Validate mask data URL
    if (!mask_data_url) {
        return json({ status: "error", message: "mask_data_url is required for Prodia cleanup" }, { status: 400 });
    }
    
    const maskResult = validateMaskDataUrl(mask_data_url, 10 * 1024 * 1024);
    if (!maskResult.valid) {
        return json({ status: "error", message: maskResult.error }, { status: 400 });
    }
    const sanitizedMaskUrl = maskResult.sanitized!;

    const roomSession = await prisma.roomSession.findFirst({
        where: {
            id: sanitizedSessionId,
            shop: { shopDomain: session.shop }
        }
    });

    if (!roomSession) {
        return json({ status: "error", message: "Session not found" }, { status: 404 });
    }

    // Get current room URL
    let currentRoomUrl: string;
    if (roomSession.cleanedRoomImageKey) {
        currentRoomUrl = await StorageService.getSignedReadUrl(roomSession.cleanedRoomImageKey, 60 * 60 * 1000);
    } else if (roomSession.originalRoomImageKey) {
        currentRoomUrl = await StorageService.getSignedReadUrl(roomSession.originalRoomImageKey, 60 * 60 * 1000);
    } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
        currentRoomUrl = roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl!;
    } else {
        return json({ status: "error", message: "No room image found" }, { status: 400 });
    }

    try {
        console.log(`[Cleanup-Prodia] Processing with Prodia SDXL`, { 
            requestId, 
            sessionId: sanitizedSessionId,
        });

        // Use Prodia-based object removal
        const result = await removeObjectsFromUrl(currentRoomUrl, sanitizedMaskUrl, requestId);

        // Upload result to GCS
        const key = `cleaned-prodia/${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
        await StorageService.uploadBuffer(
            result.imageBuffer,
            key,
            'image/png'
        );

        // Get signed URL for the result
        const signedUrl = await StorageService.getSignedReadUrl(key, 60 * 60 * 1000);

        console.log(`[Cleanup-Prodia] Success`, { 
            requestId, 
            processingTimeMs: result.processingTimeMs,
            maskCoverage: result.maskCoveragePercent.toFixed(2) + '%'
        });

        // NOTE: We're NOT updating the session here - this is just a test
        // The result is returned but not persisted to the session

        return json({
            status: "success",
            room_session_id: sanitizedSessionId,
            cleaned_room_image_url: signedUrl,
            cleanedRoomImageUrl: signedUrl,
            processingTimeMs: result.processingTimeMs,
            maskCoveragePercent: result.maskCoveragePercent,
            method: "prodia-sdxl"  // Identify which method was used
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[Cleanup-Prodia] Error`, { requestId, error: errorMessage });
        
        return json({ 
            status: "error", 
            message: errorMessage 
        }, { status: 500 });
    }
};

