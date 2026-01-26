/**
 * Consolidated CORS headers utility for app proxy endpoints.
 *
 * All app proxy routes need consistent CORS headers to allow
 * storefront JavaScript to make cross-origin requests.
 */

/**
 * Returns CORS headers for app proxy responses.
 *
 * @param shopDomain - The shop domain (e.g., "my-store.myshopify.com") or null
 * @returns Record of CORS headers including cache control
 */
export function getCorsHeaders(shopDomain: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  };

  if (shopDomain) {
    headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
  }

  return headers;
}
