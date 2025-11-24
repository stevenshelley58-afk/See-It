import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
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

    // Reconstruct the URL (deterministic based on storage service logic)
    const bucket = "stub-bucket";
    const key = `room-original/${roomSession.shopId}/${roomSession.id}/room.jpg`;
    const publicUrl = `https://${bucket}.s3.amazonaws.com/${key}`;

    await prisma.roomSession.update({
        where: { id: room_session_id },
        data: {
            originalRoomImageUrl: publicUrl
        }
    });

    return json({ ok: true });
};
