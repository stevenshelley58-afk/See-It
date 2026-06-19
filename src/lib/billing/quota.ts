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
  repository.shops.set(shopId, { ...shop, rendersQuota: shop.rendersQuota - 1 });
}
