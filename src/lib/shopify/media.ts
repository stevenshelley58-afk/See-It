import { repository } from "@/lib/db/repository";

export function pushApprovedImageToShopify(productSetupId: string, renderAssetId: string) {
  const product = repository.mustGet(repository.products, productSetupId, "product_setup");
  const asset = repository.mustGet(repository.renderAssets, renderAssetId, "render_asset");
  repository.event({ surface: "admin", name: "shopify_media_push_queued", shopId: product.shopId, productSetupId: product.id, props: { storageKey: asset.storageKey } });
  return { ok: true, productSetupId, renderAssetId };
}
