export type ShopifyProduct = {
  gid: string;
  handle: string;
  title: string;
  imageKey: string;
};

export function normalizeShopifyProduct(product: ShopifyProduct) {
  return {
    shopifyProductGid: product.gid,
    shopifyProductHandle: product.handle,
    title: product.title,
    primaryImageKey: product.imageKey
  };
}
