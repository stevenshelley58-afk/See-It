import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { cleanupRoom } from "../services/gemini.server";
import { StorageService } from "../services/storage.server";
import { validateSessionId, validateMaskDataUrl } from "../utils/validation.server";

/**
 * Extract the GCS key from a signed URL
 * Example: https://storage.googleapis.com/bucket/cleaned/123_abc.jpg?X-Goog-...
 * Returns: cleaned/123_abc.jpg
 */
function extractGcsKeyFromUrl(signedUrl: string): string | null {
    try {
        const url = new URL(signedUrl);
        // GCS signed URLs have the format: /bucket-name/key
        // Remove the leading slash and bucket name
        const pathParts = url.pathname.split('/');
        if (pathParts.length >= 3) {
            // Skip empty string and bucket name, join the rest
            return pathParts.slice(2).join('/');
        }
        return null;
    } catch {
        return null;
    }
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { room_session_id, mask_data_url } = body;

    // Validate session ID
    const sessionResult = validateSessionId(room_session_id);
    if (!sessionResult.valid) {
        return json({ status: "error", message: sessionResult.error }, { status: 400 });
    }
    const sanitizedSessionId = sessionResult.sanitized!;

    // Validate mask data URL if provided (limit to 10MB)
    let sanitizedMaskUrl: string | undefined;
    if (mask_data_url) {
        const maskResult = validateMaskDataUrl(mask_data_url, 10 * 1024 * 1024);
        if (!maskResult.valid) {
            return json({ status: "error", message: maskResult.error }, { status: 400 });
        }
        sanitizedMaskUrl = maskResult.sanitized;
    }

    const roomSession = await prisma.roomSession.findFirst({
        where: {
            id: sanitizedSessionId,
            shop: { shopDomain: session.shop }
        }
    });

    if (!roomSession) {
        return json({ status: "error", message: "Invalid session" }, { status: 404 });
    }

    // Use the most recent room image key (cleaned if available, otherwise original)
    // For legacy sessions without keys, fall back to stored URLs
    let currentRoomUrl: string;

    if (roomSession.cleanedRoomImageKey) {
        // Generate fresh URL from cleaned image key
        currentRoomUrl = await StorageService.getSignedReadUrl(roomSession.cleanedRoomImageKey, 60 * 60 * 1000);
    } else if (roomSession.originalRoomImageKey) {
        // Generate fresh URL from original image key
        currentRoomUrl = await StorageService.getSignedReadUrl(roomSession.originalRoomImageKey, 60 * 60 * 1000);
    } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
        // Legacy: use stored URL if no keys available
        currentRoomUrl = roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl;
    } else {
        return json({ status: "error", message: "No room image found" }, { status: 400 });
    }

    try {
        console.log(`[Cleanup] Processing cleanup for session ${sanitizedSessionId}`);
        console.log(`[Cleanup] Room URL: ${currentRoomUrl.substring(0, 80)}...`);
        console.log(`[Cleanup] Mask provided: ${!!sanitizedMaskUrl}, length: ${sanitizedMaskUrl?.length || 0}`);

        // If mask data is provided, attempt cleanup; otherwise echo the current image per spec stub allowance.
        if (!sanitizedMaskUrl) {
            console.log(`[Cleanup] No mask provided, returning current image`);
        }

        const cleanedRoomImageUrl = sanitizedMaskUrl
            ? await cleanupRoom(currentRoomUrl, sanitizedMaskUrl, sanitizedSessionId)
            : currentRoomUrl;

        // Extract GCS key from the returned URL for future URL regeneration
        const cleanedRoomImageKey = extractGcsKeyFromUrl(cleanedRoomImageUrl);

        // Update session with the new cleaned image and key (no-op if echo)
        await prisma.roomSession.update({
            where: { id: sanitizedSessionId },
            data: {
                cleanedRoomImageUrl: cleanedRoomImageUrl,
                cleanedRoomImageKey: cleanedRoomImageKey, // Store key for URL regeneration
                geminiFileUri: null,  // Invalidate - new image needs new preload
                lastUsedAt: new Date()
            }
        });

        return json({
            room_session_id: sanitizedSessionId,
            cleaned_room_image_url: cleanedRoomImageUrl,
            cleanedRoomImageUrl: cleanedRoomImageUrl
        });

    } catch (error) {
        console.error("[Cleanup] Gemini error:", error);
        return json({ status: "error", message: "Cleanup failed" }, { status: 500 });
    }
};
