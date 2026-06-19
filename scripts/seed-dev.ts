import { createSmokeRoom } from "./smoke-utils";

const { shop, product, room } = await createSmokeRoom("dev-seed.myshopify.com");
console.log(JSON.stringify({
  shopId: shop.id,
  productSetupId: product.id,
  roomSessionId: room.id,
  productReady: product.prepStatus,
  widgetEnabled: shop.roomPreviewEnabled
}, null, 2));
