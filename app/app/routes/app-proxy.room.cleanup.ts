import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { cleanupRoom } from "../services/gemini.server";

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

    if (!mask_data_url) {
        return json({ status: "error", message: "mask_data_url is required" }, { status: 400 });
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

    // Use the most recent room image (cleaned if available, otherwise original)
    const currentRoomUrl = roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl;
    
    if (!currentRoomUrl) {
        return json({ status: "error", message: "No room image found" }, { status: 400 });
    }

    try {
        console.log(`[Cleanup] Processing mask-based cleanup for session ${room_session_id}`);
        
        // Call Gemini directly - no more Cloud Run!
        const cleanedRoomImageUrl = await cleanupRoom(currentRoomUrl, mask_data_url);

        // Update session with the new cleaned image
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
            cleaned_room_image_url: cleanedRoomImageUrl
        });

    } catch (error) {
        console.error("[Cleanup] Gemini error:", error);
        return json({ status: "error", message: "Cleanup failed" }, { status: 500 });
    }
};
