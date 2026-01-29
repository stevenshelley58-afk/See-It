export type CorsHeaderOptions = {
  methods?: string;
};

export function getCorsHeaders(
  shopDomain: string | null,
  options: CorsHeaderOptions = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": options.methods ?? "GET, POST, OPTIONS",
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

