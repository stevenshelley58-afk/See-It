import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { room_session_id } = body;

    const roomSession = await prisma.roomSession.findUnique({
        where: { id: room_session_id },
        include: { shop: true }
    });

    if (!roomSession || roomSession.shop.shopDomain !== session.shop) {
        return json({ error: "Session not found" }, { status: 404 });
    }

    // Generate the public URL for the uploaded room image
    const key = `rooms/${roomSession.shopId}/${roomSession.id}/room.jpg`;
    
    // Check if file exists and get a fresh signed URL
    const fileExists = await StorageService.fileExists(key);
    if (!fileExists) {
        return json({ error: "Room image not uploaded yet" }, { status: 400 });
    }

    // Get a 24-hour signed read URL
    const publicUrl = await StorageService.getSignedReadUrl(key, 24 * 60 * 60 * 1000);

    // Note: Gemini preload removed - now calling Gemini directly from Railway
    // The preload optimization was only needed for Cloud Run architecture

    await prisma.roomSession.update({
        where: { id: room_session_id },
        data: {
            originalRoomImageUrl: publicUrl,
            geminiFileUri: null,  // No longer using preload
            lastUsedAt: new Date()
        }
    });

    return json({ 
        ok: true, 
        roomImageUrl: publicUrl 
    });
};
