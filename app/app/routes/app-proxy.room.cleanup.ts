import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

    const imageServiceUrl = process.env.IMAGE_SERVICE_BASE_URL;
    
    try {
        console.log(`[Proxy] Mask-based cleanup for session ${room_session_id}`);
        
        // Use Gemini file URI if available (FAST PATH)
        // Note: geminiFileUri is only valid for the original room, not cleaned versions
        const useGeminiFileUri = roomSession.geminiFileUri && !roomSession.cleanedRoomImageUrl;
        
        const response = await fetch(`${imageServiceUrl}/room/cleanup`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.IMAGE_SERVICE_TOKEN}`
            },
            body: JSON.stringify({
                room_image_url: currentRoomUrl,
                mask_data_url: mask_data_url,
                // Pass the Gemini file URI for faster processing (if available)
                gemini_file_uri: useGeminiFileUri ? roomSession.geminiFileUri : null
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Image service error: ${errorText}`);
            throw new Error(`Image service failed: ${response.statusText}`);
        }

        const data = await response.json();
        const { cleaned_room_image_url } = data;

        // Update session with the new cleaned image
        // Note: After cleanup, geminiFileUri is no longer valid for this new image
        await prisma.roomSession.update({
            where: { id: room_session_id },
            data: { 
                cleanedRoomImageUrl: cleaned_room_image_url,
                geminiFileUri: null,  // Invalidate - new image needs new preload
                lastUsedAt: new Date()
            }
        });

        return json({
            room_session_id,
            cleaned_room_image_url
        });

    } catch (error) {
        console.error("Cleanup error:", error);
        return json({ status: "error", message: "Cleanup failed" }, { status: 500 });
    }
};
