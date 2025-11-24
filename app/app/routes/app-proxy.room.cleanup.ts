import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { room_session_id, mask_image_url } = body;

    if (!room_session_id || !mask_image_url) {
        return json({ status: "error", message: "Missing required fields" }, { status: 400 });
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

    const imageServiceUrl = process.env.IMAGE_SERVICE_BASE_URL;
    console.log(`[Proxy] Sending cleanup request to ${imageServiceUrl}/room/cleanup`);

    try {
        const response = await fetch(`${imageServiceUrl}/room/cleanup`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.IMAGE_SERVICE_TOKEN}`
            },
            body: JSON.stringify({
                room_image_url: roomSession.originalRoomImageUrl,
                mask_url: mask_image_url,
                prompt: { id: "room_cleanup", version: 1 },
                model: { id: "gemini-3-pro-image" }
            })
        });

        if (!response.ok) {
            throw new Error(`Image service failed: ${response.statusText}`);
        }

        const data = await response.json();
        const { cleaned_room_image_url } = data;

        // Update session
        await prisma.roomSession.update({
            where: { id: room_session_id },
            data: { cleanedRoomImageUrl: cleaned_room_image_url }
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
