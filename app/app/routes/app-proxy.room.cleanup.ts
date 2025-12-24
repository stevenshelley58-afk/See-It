import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { removeObjectsFromUrl } from "../services/object-removal.server";
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
    const requestId = `cleanup-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    console.log(`[Cleanup] Request started`, { requestId });
    
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        console.warn(`[Cleanup] Authentication failed`, { requestId });
        return json({ status: "error", message: "Authentication required" }, { status: 403 });
    }

    let body;
    try {
        body = await request.json();
    } catch (parseError) {
        console.error(`[Cleanup] JSON parse failed`, { requestId, error: parseError });
        return json({ status: "error", message: "Invalid request body" }, { status: 400 });
    }
    
    const { room_session_id, mask_data_url } = body;

    // Validate session ID
    if (!room_session_id) {
        console.error(`[Cleanup] Missing room_session_id`, { requestId });
        return json({ status: "error", message: "room_session_id is required" }, { status: 400 });
    }
    
    const sessionResult = validateSessionId(room_session_id);
    if (!sessionResult.valid) {
        console.error(`[Cleanup] Invalid session ID`, { requestId, error: sessionResult.error });
        return json({ status: "error", message: sessionResult.error }, { status: 400 });
    }
    const sanitizedSessionId = sessionResult.sanitized!;

    // Validate mask data URL if provided (limit to 10MB)
    let sanitizedMaskUrl: string | undefined;
    if (mask_data_url) {
        const maskResult = validateMaskDataUrl(mask_data_url, 10 * 1024 * 1024);
        if (!maskResult.valid) {
            console.error(`[Cleanup] Invalid mask data URL`, { requestId, error: maskResult.error });
            return json({ status: "error", message: maskResult.error }, { status: 400 });
        }
        sanitizedMaskUrl = maskResult.sanitized;
        console.log(`[Cleanup] Mask validated`, { requestId, maskLength: sanitizedMaskUrl.length });
    } else {
        console.warn(`[Cleanup] No mask provided`, { requestId });
    }

    const roomSession = await prisma.roomSession.findFirst({
        where: {
            id: sanitizedSessionId,
            shop: { shopDomain: session.shop }
        }
    });

    if (!roomSession) {
        console.error(`[Cleanup] Session not found`, { requestId, sessionId: sanitizedSessionId, shop: session.shop });
        return json({ status: "error", message: "Session not found or expired. Please re-upload your room image." }, { status: 404 });
    }
    
    console.log(`[Cleanup] Session found`, { requestId, sessionId: sanitizedSessionId });

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
        console.error(`[Cleanup] No room image found in session`, { requestId, sessionId: sanitizedSessionId });
        return json({ status: "error", message: "No room image found. Please re-upload your room image." }, { status: 400 });
    }

    try {
        console.log(`[Cleanup] Processing cleanup`, { 
            requestId, 
            sessionId: sanitizedSessionId,
            roomUrlPreview: currentRoomUrl.substring(0, 80) + '...',
            hasMask: !!sanitizedMaskUrl,
            maskLength: sanitizedMaskUrl?.length || 0
        });

        // If mask data is provided, attempt cleanup; otherwise echo the current image per spec stub allowance.
        if (!sanitizedMaskUrl) {
            console.log(`[Cleanup] No mask provided, returning current image`, { requestId });
        }

        let cleanedRoomImageUrl: string;
        if (sanitizedMaskUrl) {
            // Retry logic for transient failures (network, GCS, etc.)
            const MAX_RETRIES = 2;
            let lastError: Error | null = null;
            let success = false;
            
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    if (attempt > 0) {
                        console.log(`[Cleanup] Retry attempt ${attempt}`, { requestId });
                        // Exponential backoff: 500ms, 1000ms
                        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                    }
                    
                    // Use Prodia SDXL inpainting for object removal
                    const result = await removeObjectsFromUrl(currentRoomUrl, sanitizedMaskUrl, requestId);
                    
                    // Upload result to GCS
                    const key = `cleaned/${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
                    await StorageService.uploadBuffer(result.imageBuffer, key, 'image/png');
                    cleanedRoomImageUrl = await StorageService.getSignedReadUrl(key, 60 * 60 * 1000);
                    
                    console.log(`[Cleanup] Cleanup successful (Prodia)`, { 
                        requestId, 
                        attempt, 
                        processingTimeMs: result.processingTimeMs,
                        maskCoverage: result.maskCoveragePercent.toFixed(2) + '%',
                        urlPreview: cleanedRoomImageUrl.substring(0, 80) + '...' 
                    });
                    success = true;
                    break; // Success, exit retry loop
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    console.error(`[Cleanup] Cleanup attempt ${attempt} failed`, { requestId, attempt, error: lastError.message });
                    
                    // Don't retry on validation errors or permanent failures
                    if (lastError.message.includes('validation') || 
                        lastError.message.includes('Invalid') ||
                        lastError.message.includes('not found') ||
                        lastError.message.includes('coverage')) {
                        throw lastError;
                    }
                    
                    // If this was the last attempt, throw
                    if (attempt === MAX_RETRIES) {
                        throw lastError;
                    }
                }
            }
            
            if (!success) {
                throw lastError || new Error('Cleanup failed after retries');
            }
        } else {
            cleanedRoomImageUrl = currentRoomUrl;
        }

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
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error(`[Cleanup] Error processing cleanup`, { 
            requestId, 
            error: errorMessage,
            stack: errorStack,
            sessionId: sanitizedSessionId
        });
        
        // Return user-friendly error message
        let userMessage = "Cleanup failed";
        if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
            userMessage = "Cleanup timed out. Please try again.";
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
            userMessage = "Network error. Please check your connection and try again.";
        } else if (errorMessage.includes('session') || errorMessage.includes('not found')) {
            userMessage = "Session expired. Please re-upload your room image.";
        } else if (errorMessage.includes('mask') || errorMessage.includes('Mask')) {
            userMessage = "Invalid mask. Please draw over the area to remove and try again.";
        }
        
        return json({ 
            status: "error", 
            message: userMessage 
        }, { status: 500 });
    }
};
