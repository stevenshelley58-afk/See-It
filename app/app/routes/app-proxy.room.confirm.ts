import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";
import { validateSessionId } from "../utils/validation.server";

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
    const { room_session_id } = body;

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
    const key = roomSession.originalRoomImageKey || `rooms/${roomSession.shopId}/${roomSession.id}/room.jpg`;

    // Check if file exists and get a fresh signed URL
    const fileExists = await StorageService.fileExists(key);
    if (!fileExists) {
        return json({ error: "Room image not uploaded yet" }, { status: 400, headers: corsHeaders });
    }

    // Get a fresh 1-hour signed read URL (shorter TTL since we can regenerate anytime)
    const publicUrl = await StorageService.getSignedReadUrl(key, 60 * 60 * 1000);

    // Update room session with the key (if not already set) and update last used timestamp
    // Keep URL for backward compatibility but it's now derived from key
    await prisma.roomSession.update({
        where: { id: sanitizedSessionId },
        data: {
            originalRoomImageKey: key, // Ensure key is always set
            originalRoomImageUrl: publicUrl, // Legacy field - keep for compatibility
            lastUsedAt: new Date()
        }
    });

    // Spec: returns { "ok": true } (Routes → Storefront app proxy routes). Keep URL fields for caller compatibility.
    return json({
        ok: true,
        room_image_url: publicUrl,
        roomImageUrl: publicUrl
    }, { headers: corsHeaders });
};
