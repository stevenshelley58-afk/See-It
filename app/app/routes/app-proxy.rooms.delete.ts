import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { extractShopperToken, validateShopperToken } from "../utils/shopper-token.server";
import { StorageService } from "../services/storage.server";

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

    const shopDomain = session.shop;

    // Get shop record
    const shop = await prisma.shop.findUnique({
        where: { shopDomain }
    });

    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404, headers: corsHeaders });
    }

    // Extract and validate shopper token
    const token = extractShopperToken(request);
    if (!token) {
        return json({ error: "Shopper token required" }, { status: 401, headers: corsHeaders });
    }

    const payload = validateShopperToken(token);
    if (!payload) {
        return json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
    }

    // Verify token matches shop
    if (payload.shopDomain !== shopDomain) {
        return json({ error: "Token does not match shop" }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const { saved_room_id } = body;

    if (!saved_room_id || typeof saved_room_id !== 'string') {
        return json({ error: "saved_room_id is required" }, { status: 400, headers: corsHeaders });
    }

    // Find owner
    const owner = await prisma.savedRoomOwner.findUnique({
        where: {
            shopId_email: {
                shopId: shop.id,
                email: payload.email,
            }
        }
    });

    if (!owner) {
        return json({ error: "Owner not found" }, { status: 404, headers: corsHeaders });
    }

    // Get saved room and verify ownership
    const savedRoom = await prisma.savedRoom.findUnique({
        where: { id: saved_room_id }
    });

    if (!savedRoom) {
        return json({ error: "Saved room not found" }, { status: 404, headers: corsHeaders });
    }

    // Verify ownership
    if (savedRoom.shopId !== shop.id || savedRoom.ownerId !== owner.id) {
        return json({ error: "Access denied" }, { status: 403, headers: corsHeaders });
    }

    // Delete GCS files
    const keysToDelete: string[] = [];
    if (savedRoom.originalImageKey) {
        keysToDelete.push(savedRoom.originalImageKey);
    }
    if (savedRoom.cleanedImageKey) {
        keysToDelete.push(savedRoom.cleanedImageKey);
    }

    // Delete files in parallel (failures are logged but don't block DB deletion)
    await Promise.allSettled(
        keysToDelete.map(key => StorageService.deleteFile(key))
    );

    // Delete DB record
    await prisma.savedRoom.delete({
        where: { id: saved_room_id }
    });

    return json({ ok: true }, { headers: corsHeaders });
};
