import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { appProxyErrorBody, authenticateAppProxyRequest } from "@/lib/shopify/app-proxy";
import { createSignedUpload } from "@/lib/storage/signed-upload";
import { traceRender } from "@/lib/render/trace";

export async function POST(request: NextRequest) {
  const auth = authenticateAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const body = await request.json();
  const product = [...repository.products.values()].find((item) => item.shopId === auth.shop.id && item.shopifyProductGid === body.productGid);
  if (!product || !product.enabled || product.prepStatus !== "ready") {
    return NextResponse.json({ error: "product_not_ready" }, { status: 404 });
  }
  const room = repository.createRoomSession({ shopId: auth.shop.id, productSetupId: product.id, source: "widget", roomKey: "", expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const upload = await createSignedUpload(room.id, body.fileName ?? "room.jpg", body.mimeType ?? "image/jpeg");
  repository.updateRoomSession(room.id, { roomKey: upload.roomKey });
  traceRender("room_" + room.id, "asset_upload_url_issued", { roomKey: upload.roomKey, shopId: auth.shop.id });
  return NextResponse.json({ roomSessionId: room.id, ...upload });
}
