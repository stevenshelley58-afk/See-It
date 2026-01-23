const DEFAULT_SEE_IT_NOW_ALLOWED_SHOPS = [
  "test-store-1100000000000000000000000000000002307.myshopify.com", // Test store
  "bohoem58.myshopify.com", // BHM Showroom
];

function parseAllowlistEnv(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * See It Now is gated by an allowlist for safety.
 *
 * Configure with env var:
 * - SEE_IT_NOW_ALLOWED_SHOPS="shop1.myshopify.com,shop2.myshopify.com"
 * - SEE_IT_NOW_ALLOWED_SHOPS="*" to allow all shops (not recommended for prod)
 */
export function getSeeItNowAllowedShops(): { allowAll: boolean; shops: string[] } {
  const envAllowlist = parseAllowlistEnv(process.env.SEE_IT_NOW_ALLOWED_SHOPS);

  // If env var is set, it becomes the source of truth.
  if (envAllowlist.length > 0) {
    if (envAllowlist.includes("*")) return { allowAll: true, shops: [] };
    return { allowAll: false, shops: envAllowlist };
  }

  return { allowAll: false, shops: [...DEFAULT_SEE_IT_NOW_ALLOWED_SHOPS] };
}

export function isSeeItNowAllowedShop(shopDomain: string): boolean {
  const { allowAll, shops } = getSeeItNowAllowedShops();
  if (allowAll) return true;
  return shops.includes(shopDomain);
}

