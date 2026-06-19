import { repository } from "@/lib/db/repository";
import { normalizeShopifyProduct, type ShopifyProduct } from "@/lib/shopify/admin";
import { productCutoutPath } from "@/lib/storage/paths";

export function createProductSetup(shopId: string, product: ShopifyProduct, dimensions = { widthMm: 700, heightMm: 820, depthMm: 760 }) {
  const normalized = normalizeShopifyProduct(product);
  return repository.createProduct({
    shopId,
    ...normalized,
    widthMm: dimensions.widthMm,
    heightMm: dimensions.heightMm,
    depthMm: dimensions.depthMm,
    category: "furniture",
    material: "unknown",
    colour: "unknown",
    cutoutKey: productCutoutPath(shopId, product.gid.replace(/[^a-zA-Z0-9]/g, "-")),
    prepStatus: "ready",
    enabled: false
  });
}

export function setProductEnabled(productSetupId: string, enabled: boolean) {
  const product = repository.mustGet(repository.products, productSetupId, "product_setup");
  const next = { ...product, enabled };
  repository.products.set(product.id, next);
  return next;
}
