import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadRoomSessionById } from "@/lib/db/supabase-persistence";
import { appProxyErrorBody, authenticateDurableAppProxyRequest, enforceAppProxyRateLimit } from "@/lib/shopify/app-proxy";
import { roomNormalizedPath } from "@/lib/storage/paths";
import { verifySignedUpload } from "@/lib/storage/signed-upload";
import { traceRender } from "@/lib/render/trace";
import { persistRoomSession } from "@/lib/db/supabase-persistence";

export async function POST(request: NextRequest, { params }: { params: Promise<{ roomSessionId: string }> }) {
  const { roomSessionId } = await params;
  const auth = await authenticateDurableAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const room = await loadRoomSessionById(roomSessionId);
  if (!room || room.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  const limit = enforceAppProxyRateLimit(request, auth, { roomSessionId: room.id });
  if (!limit.ok) {
    return NextResponse.json(appProxyErrorBody(limit), { status: limit.status });
  }
  const body = await request.json().catch(() => ({}));
  const verified = verifySignedUpload({ roomKey: room.roomKey, mimeType: body.mimeType ?? "image/jpeg", width: body.width, height: body.height, bytes: body.bytes });
  const updatedRoom = repository.updateRoomSession(room.id, { verified: true, width: verified.width, height: verified.height, normalizedRoomKey: roomNormalizedPath(room.id) });
  await persistRoomSession(updatedRoom);
  traceRender("room_" + room.id, "asset_upload_verified", { width: verified.width, height: verified.height });
  traceRender("room_" + room.id, "room_normalized", { normalizedRoomKey: roomNormalizedPath(room.id) });
  return NextResponse.json(verified);
}
