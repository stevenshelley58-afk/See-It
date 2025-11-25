import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    await request.json();
    const shopDomain = session.shop;

    // Find or create shop record (Stub logic for MVP)
    let shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
        // In a real app, this should be created during installation
        shop = await prisma.shop.create({
            data: {
                shopDomain,
                shopifyShopId: "stub-id", // We don't have this from app proxy easily without querying Shopify
                accessToken: "stub-token",
                plan: "free",
                monthlyQuota: 100,
                dailyQuota: 10,
            }
        });
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
