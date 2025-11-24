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

    if (!room_session_id) {
        return json({ status: "error", message: "Missing room_session_id" }, { status: 400 });
    }

    // Verify session belongs to shop
    const roomSession = await prisma.roomSession.findFirst({
        where: {
            id: room_session_id,
            shop: { shopDomain: session.shop }
        }
    });

    if (!roomSession) {
        return json({ status: "error", message: "Invalid session" }, { status: 404 });
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) {
        return json({ status: "error", message: "Shop not found" }, { status: 404 });
    }

    // Generate unique mask filename
    const filename = `mask-${Date.now()}.png`;
    const { uploadUrl, publicUrl } = await StorageService.getPresignedUploadUrl(shop.id, roomSession.id, filename);

    return json({
        upload_url: uploadUrl,
        mask_image_url: publicUrl
    });
};
