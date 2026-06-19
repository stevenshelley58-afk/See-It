import { repository } from "@/lib/db/repository";

export function requireShop(shopDomain: string) {
  const shop = [...repository.shops.values()].find((item) => item.shopDomain === shopDomain && !item.uninstalledAt);
  if (!shop) {
    throw new Error("Shop session required");
  }
  return shop;
}
