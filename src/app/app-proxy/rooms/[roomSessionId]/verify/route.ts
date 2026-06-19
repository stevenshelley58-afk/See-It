import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { appProxyErrorBody, authenticateAppProxyRequest } from "@/lib/shopify/app-proxy";
import { roomNormalizedPath } from "@/lib/storage/paths";
import { verifySignedUpload } from "@/lib/storage/signed-upload";
import { traceRender } from "@/lib/render/trace";

export async function POST(request: NextRequest, { params }: { params: { roomSessionId: string } }) {
  const auth = authenticateAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const room = repository.mustGet(repository.roomSessions, params.roomSessionId, "room_session");
  if (room.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const verified = verifySignedUpload({ roomKey: room.roomKey, mimeType: body.mimeType ?? "image/jpeg", width: body.width, height: body.height, bytes: body.bytes });
  repository.updateRoomSession(room.id, { verified: true, width: verified.width, height: verified.height, normalizedRoomKey: roomNormalizedPath(room.id) });
  traceRender("room_" + room.id, "asset_upload_verified", { width: verified.width, height: verified.height });
  traceRender("room_" + room.id, "room_normalized", { normalizedRoomKey: roomNormalizedPath(room.id) });
  return NextResponse.json(verified);
}
