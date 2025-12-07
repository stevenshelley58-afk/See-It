import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { cleanupRoom } from "../services/gemini.server";
import { StorageService } from "../services/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { room_session_id, mask_data_url } = body;

    if (!room_session_id) {
        return json({ status: "error", message: "room_session_id is required" }, { status: 400 });
    }

    const roomSession = await prisma.roomSession.findFirst({
        where: {
            id: room_session_id,
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
        console.log(`[Cleanup] Processing cleanup for session ${room_session_id}`);

        // If mask data is provided, attempt cleanup; otherwise echo the current image per spec stub allowance.
        const cleanedRoomImageUrl = mask_data_url
            ? await cleanupRoom(currentRoomUrl, mask_data_url)
            : currentRoomUrl;

        // Update session with the new cleaned image (no-op if echo)
        await prisma.roomSession.update({
            where: { id: room_session_id },
            data: { 
                cleanedRoomImageUrl: cleanedRoomImageUrl,
                geminiFileUri: null,  // Invalidate - new image needs new preload
                lastUsedAt: new Date()
            }
        });

        return json({
            room_session_id,
            cleaned_room_image_url: cleanedRoomImageUrl,
            cleanedRoomImageUrl: cleanedRoomImageUrl
        });

    } catch (error) {
        console.error("[Cleanup] Gemini error:", error);
        return json({ status: "error", message: "Cleanup failed" }, { status: 500 });
    }
};
