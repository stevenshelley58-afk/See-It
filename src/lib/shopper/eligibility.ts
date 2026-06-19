import { repository } from "@/lib/db/repository";

export function canShowWidget(shopId: string, productSetupId: string) {
  const shop = repository.mustGet(repository.shops, shopId, "shop");
  const product = repository.mustGet(repository.products, productSetupId, "product_setup");
  return Boolean(!shop.uninstalledAt && shop.plan !== "cancelled" && shop.roomPreviewEnabled && shop.rendersQuota > 0 && product.enabled && product.prepStatus === "ready");
}
