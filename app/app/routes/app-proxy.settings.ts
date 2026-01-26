import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_SETTINGS = {
  style_preset: "neutral",
  automation_enabled: false,
  show_quota: false,
};

function getCorsHeaders(shopDomain: string | null): Record<string, string> {
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

/**
 * Storefront Settings (App Proxy)
 * GET /apps/see-it/settings
 *
 * Purpose: allow the storefront widget (theme extension JS) to fetch shop settings.
 * This MUST use app proxy auth (public) — admin auth is not available on storefront.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const corsHeaders = getCorsHeaders(session?.shop ?? null);

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!session) {
    return json({ error: "forbidden" }, { status: 403, headers: corsHeaders });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { settingsJson: true },
  });

  let settings: typeof DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  try {
    settings = shop?.settingsJson ? JSON.parse(shop.settingsJson) : DEFAULT_SETTINGS;
  } catch {
    settings = DEFAULT_SETTINGS;
  }

  return json(settings, { headers: corsHeaders });
};

