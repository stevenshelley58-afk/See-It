import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { extractShopperToken, validateShopperToken } from "../utils/shopper-token.server";
import { StorageService } from "../services/storage.server";
import { validateSessionId } from "../utils/validation.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const shopDomain = session.shop;

    // Get shop record
    const shop = await prisma.shop.findUnique({
        where: { shopDomain }
    });

    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }

    // Extract and validate shopper token
    const token = extractShopperToken(request);
    if (!token) {
        return json({ error: "Shopper token required" }, { status: 401 });
    }

    const payload = validateShopperToken(token);
    if (!payload) {
        return json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Verify token matches shop
    if (payload.shopDomain !== shopDomain) {
        return json({ error: "Token does not match shop" }, { status: 403 });
    }

    const body = await request.json();
    const { room_session_id, title } = body;

    // Validate room session ID
    const sessionResult = validateSessionId(room_session_id);
    if (!sessionResult.valid) {
        return json({ error: sessionResult.error }, { status: 400 });
    }
    const sanitizedSessionId = sessionResult.sanitized!;

    // Get room session
    const roomSession = await prisma.roomSession.findUnique({
        where: { id: sanitizedSessionId },
        include: { shop: true }
    });

    if (!roomSession || roomSession.shop.shopDomain !== shopDomain) {
        return json({ error: "Room session not found" }, { status: 404 });
    }

    // Find or create owner
    const owner = await prisma.savedRoomOwner.findUnique({
        where: {
            shopId_email: {
                shopId: shop.id,
                email: payload.email,
            }
        }
    });

    if (!owner) {
        // This shouldn't happen if token is valid, but handle it
        return json({ error: "Owner not found" }, { status: 404 });
    }

    // Determine which image key to use (prefer cleaned, fallback to original)
    const sourceImageKey = roomSession.cleanedRoomImageKey || roomSession.originalRoomImageKey;
    if (!sourceImageKey) {
        return json({ error: "Room session has no image" }, { status: 400 });
    }

    // Create saved room record first to get the ID
    const savedRoom = await prisma.savedRoom.create({
        data: {
            shopId: shop.id,
            ownerId: owner.id,
            title: title && typeof title === 'string' ? title.trim() : null,
            originalImageKey: '', // Will be set after copy
            cleanedImageKey: null,
        }
    });

    try {
        // Copy original image to saved-rooms storage
        const originalDestKey = `saved-rooms/${shop.id}/${savedRoom.id}/original.jpg`;
        await StorageService.copyFile(sourceImageKey, originalDestKey);

        // Copy cleaned image if it exists
        let cleanedDestKey: string | null = null;
        if (roomSession.cleanedRoomImageKey && roomSession.cleanedRoomImageKey !== sourceImageKey) {
            cleanedDestKey = `saved-rooms/${shop.id}/${savedRoom.id}/cleaned.jpg`;
            await StorageService.copyFile(roomSession.cleanedRoomImageKey, cleanedDestKey);
        }

        // Update saved room with the keys
        await prisma.savedRoom.update({
            where: { id: savedRoom.id },
            data: {
                originalImageKey: originalDestKey,
                cleanedImageKey: cleanedDestKey,
            }
        });

        // Generate preview URL (use cleaned if available, otherwise original)
        const previewImageKey = cleanedDestKey || originalDestKey;
        const previewUrl = await StorageService.getSignedReadUrl(previewImageKey, 60 * 60 * 1000);

        return json({
            saved_room_id: savedRoom.id,
            preview_url: previewUrl,
        });
    } catch (error) {
        // Clean up saved room record if file copy fails
        await prisma.savedRoom.delete({ where: { id: savedRoom.id } }).catch(() => {});
        
        console.error('[SaveRoom] Failed to copy files:', error);
        return json({ 
            error: "Failed to save room image" 
        }, { status: 500 });
    }
};
