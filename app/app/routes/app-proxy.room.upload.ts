import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";

// Spec alignment: external path /apps/see-it/room/upload (spec Routes → Storefront app proxy routes)
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const shopDomain = session.shop;

    // Shop must exist from installation - do not create stubs
    const shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
        console.error(`[RoomUpload] Shop not found in database: ${shopDomain}. App may not be properly installed.`);
        return json({
            status: "error",
            message: "Shop not found. Please reinstall the app."
        }, { status: 404 });
    }

    const roomSession = await prisma.roomSession.create({
        data: {
            shopId: shop.id,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        }
    });

    const { uploadUrl, publicUrl, key } = await StorageService.getPresignedUploadUrl(shop.id, roomSession.id, "room.jpg");

    // Store the stable GCS key for future URL generation
    await prisma.roomSession.update({
        where: { id: roomSession.id },
        data: {
            originalRoomImageKey: key,
        }
    });

    // Return both spec-aligned snake_case fields and existing camelCase for compatibility
    return json({
        room_session_id: roomSession.id,
        upload_url: uploadUrl,
        room_image_future_url: publicUrl,
        sessionId: roomSession.id,
        uploadUrl: uploadUrl,
        roomImageFutureUrl: publicUrl
    });
};

