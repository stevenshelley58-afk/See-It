import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { createSignedUpload } from "@/lib/storage/signed-upload";
import { traceRender } from "@/lib/render/trace";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const shop = [...repository.shops.values()].find((item) => item.shopDomain === body.shop) ?? repository.createShop({ shopDomain: body.shop ?? "demo.myshopify.com", plan: "trial", rendersQuota: 50, lifestyleImagesQuota: 10, billingStatus: "trial", roomPreviewEnabled: true });
  const product = [...repository.products.values()].find((item) => item.shopId === shop.id && item.shopifyProductGid === body.productGid) ?? repository.createProduct({ shopId: shop.id, shopifyProductGid: body.productGid ?? "gid://shopify/Product/demo", title: "Demo product", widthMm: 350, heightMm: 650, depthMm: 350, category: "decor", cutoutKey: "products/demo/cutout-primary.png", prepStatus: "ready", enabled: true });
  const room = repository.createRoomSession({ shopId: shop.id, productSetupId: product.id, source: "widget", roomKey: "", expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const upload = createSignedUpload(room.id, body.fileName ?? "room.jpg", body.mimeType ?? "image/jpeg");
  repository.updateRoomSession(room.id, { roomKey: upload.roomKey });
  traceRender("room_" + room.id, "asset_upload_url_issued", { roomKey: upload.roomKey });
  return NextResponse.json({ roomSessionId: room.id, ...upload });
}
