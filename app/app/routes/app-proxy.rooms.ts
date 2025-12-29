import { json, type LoaderFunctionArgs } from "@remix-run/node";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
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
        // Owner doesn't exist yet (shouldn't happen if token is valid, but handle gracefully)
        return json({ rooms: [] }, { headers: corsHeaders });
    }

    // Get saved rooms for this owner
    const savedRooms = await prisma.savedRoom.findMany({
        where: {
            shopId: shop.id,
            ownerId: owner.id,
        },
        orderBy: {
            createdAt: 'desc',
        }
    });

    // Generate preview URLs (1 hour TTL)
    const rooms = await Promise.all(
        savedRooms.map(async (room) => {
            // Use cleaned image if available, otherwise original
            const imageKey = room.cleanedImageKey || room.originalImageKey;
            const previewUrl = await StorageService.getSignedReadUrl(imageKey, 60 * 60 * 1000);

            return {
                id: room.id,
                title: room.title || null,
                preview_url: previewUrl,
                created_at: room.createdAt.toISOString(),
            };
        })
    );

    return json({ rooms }, { headers: corsHeaders });
};
