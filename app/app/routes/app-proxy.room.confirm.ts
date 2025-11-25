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

    // Pre-upload to Gemini for faster cleanup (background, don't block)
    let geminiFileUri: string | null = null;
    const imageServiceUrl = process.env.IMAGE_SERVICE_BASE_URL;
    
    if (imageServiceUrl) {
        try {
            console.log(`[Proxy] Pre-uploading room to Gemini for session ${room_session_id}`);
            const preloadResponse = await fetch(`${imageServiceUrl}/room/preload`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.IMAGE_SERVICE_TOKEN}`
                },
                body: JSON.stringify({ room_image_url: publicUrl })
            });
            
            if (preloadResponse.ok) {
                const preloadData = await preloadResponse.json();
                geminiFileUri = preloadData.gemini_file_uri;
                console.log(`[Proxy] Room pre-uploaded to Gemini: ${geminiFileUri}`);
            } else {
                console.warn(`[Proxy] Gemini preload failed: ${preloadResponse.status}`);
            }
        } catch (error) {
            // Non-fatal - cleanup will still work, just slower
            console.warn(`[Proxy] Gemini preload error (non-fatal):`, error);
        }
    }

    await prisma.roomSession.update({
        where: { id: room_session_id },
        data: {
            originalRoomImageUrl: publicUrl,
            geminiFileUri: geminiFileUri,
            lastUsedAt: new Date()
        }
    });

    return json({ 
        ok: true, 
        roomImageUrl: publicUrl 
    });
};
