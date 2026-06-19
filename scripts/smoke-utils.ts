import { seedAiControlPlane } from "@/lib/ai/bootstrap";
import { repository } from "@/lib/db/repository";
import { createProductSetup, setProductEnabled } from "@/lib/merchant/products";
import { PLANS } from "@/lib/shopify/billing";
import { createSignedUpload, verifySignedUpload } from "@/lib/storage/signed-upload";

export async function createSmokeRoom(shopDomain = "smoke.myshopify.com") {
  repository.reset();
  seedAiControlPlane(repository);
  const shop = repository.createShop({
    shopDomain,
    plan: "trial",
    rendersQuota: PLANS.trial.renders,
    lifestyleImagesQuota: PLANS.trial.lifestyleImages,
    billingStatus: "trial",
    roomPreviewEnabled: true
  });
  const product = createProductSetup(
    shop.id,
    {
      gid: "gid://shopify/Product/smoke",
      handle: "smoke-accent-chair",
      title: "Smoke accent chair",
      imageKey: "products/smoke/source.png"
    },
    { widthMm: 700, heightMm: 820, depthMm: 760 }
  );
  setProductEnabled(product.id, true);
  const room = repository.createRoomSession({
    shopId: shop.id,
    productSetupId: product.id,
    source: "merchant_test",
    roomKey: "",
    expiresAt: new Date(Date.now() + 86400000).toISOString()
  });
  const upload = await createSignedUpload(room.id, "room.jpg", "image/jpeg");
  repository.updateRoomSession(room.id, {
    roomKey: upload.roomKey,
    verified: verifySignedUpload({ roomKey: upload.roomKey, mimeType: "image/jpeg" }).ok,
    width: 1600,
    height: 1200,
    normalizedRoomKey: "rooms/" + room.id + "/normalized.jpg"
  });
  return { shop, product, room };
}
