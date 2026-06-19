import { createHmac, timingSafeEqual } from "node:crypto";
import { repository } from "@/lib/db/repository";

export function verifyWebhook(body: string, hmacHeader: string | null, secret: string) {
  if (!hmacHeader) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(body).digest("base64");
  const a = Buffer.from(hmacHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function handlePrivacyWebhook(topic: string, payload: unknown) {
  repository.event({ surface: "system", name: "privacy_" + topic.replace(/[/:]/g, "_"), props: { payload } });
  return { ok: true };
}

export function handleUninstall(shopDomain: string) {
  const shop = [...repository.shops.values()].find((item) => item.shopDomain === shopDomain);
  if (!shop) {
    return { ok: true, disabled: false };
  }
  repository.shops.set(shop.id, { ...shop, uninstalledAt: new Date().toISOString(), offlineAccessTokenEncrypted: undefined, roomPreviewEnabled: false, billingStatus: "uninstalled" });
  repository.cancelJobsForShop(shop.id);
  repository.event({ surface: "system", name: "app_uninstalled", shopId: shop.id, props: { shopDomain } });
  return { ok: true, disabled: true };
}
