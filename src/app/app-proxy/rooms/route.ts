import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadProductSetupByShopAndGid } from "@/lib/db/supabase-persistence";
import { appProxyErrorBody, authenticateDurableAppProxyRequest, enforceAppProxyRateLimit } from "@/lib/shopify/app-proxy";
import { createSignedUpload } from "@/lib/storage/signed-upload";
import { traceRender } from "@/lib/render/trace";
import { persistRoomSession } from "@/lib/db/supabase-persistence";

export async function POST(request: NextRequest) {
  const auth = await authenticateDurableAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const limit = enforceAppProxyRateLimit(request, auth);
  if (!limit.ok) {
    return NextResponse.json(appProxyErrorBody(limit), { status: limit.status });
  }
  const body = await request.json().catch(() => ({}));
  const product = await loadProductSetupByShopAndGid(auth.shop.id, String(body.productGid ?? ""));
  if (!product || !product.enabled || product.prepStatus !== "ready") {
    return NextResponse.json({ error: "product_not_ready" }, { status: 404 });
  }
  const room = repository.createRoomSession({ shopId: auth.shop.id, productSetupId: product.id, source: "widget", roomKey: "", expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const upload = await createSignedUpload(room.id, body.fileName ?? "room.jpg", body.mimeType ?? "image/jpeg");
  const updatedRoom = repository.updateRoomSession(room.id, { roomKey: upload.roomKey });
  await persistRoomSession(updatedRoom);
  traceRender("room_" + room.id, "asset_upload_url_issued", { roomKey: upload.roomKey, shopId: auth.shop.id });
  return NextResponse.json({ roomSessionId: room.id, ...upload });
}
