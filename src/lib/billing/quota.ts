import { repository } from "@/lib/db/repository";

export function assertRenderQuota(shopId: string) {
  const shop = repository.mustGet(repository.shops, shopId, "shop");
  if (shop.rendersQuota <= 0 || shop.plan === "cancelled") {
    throw new Error("quota_exhausted");
  }
  return true;
}

export function consumeRenderStarted(shopId: string) {
  const shop = repository.mustGet(repository.shops, shopId, "shop");
  assertRenderQuota(shopId);
  const next = { ...shop, rendersQuota: shop.rendersQuota - 1 };
  repository.shops.set(shopId, next);
  return next;
}

export function assertLifestyleQuota(shopId: string) {
  const shop = repository.mustGet(repository.shops, shopId, "shop");
  if (shop.lifestyleImagesQuota <= 0 || shop.plan === "cancelled") {
    throw new Error("lifestyle_quota_exhausted");
  }
  return true;
}

export function consumeLifestyleStarted(shopId: string) {
  const shop = repository.mustGet(repository.shops, shopId, "shop");
  assertLifestyleQuota(shopId);
  const next = { ...shop, lifestyleImagesQuota: shop.lifestyleImagesQuota - 1 };
  repository.shops.set(shopId, next);
  return next;
}
