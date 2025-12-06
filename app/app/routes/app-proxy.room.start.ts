import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    // No body needed for this endpoint
    const shopDomain = session.shop;

    // Shop must exist from installation - do not create stubs
    const shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
        console.error(`[RoomStart] Shop not found in database: ${shopDomain}. App may not be properly installed.`);
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

    const { uploadUrl, publicUrl } = await StorageService.getPresignedUploadUrl(shop.id, roomSession.id, "room.jpg");

    return json({
        sessionId: roomSession.id,
        uploadUrl: uploadUrl,
        roomImageFutureUrl: publicUrl
    });
};
