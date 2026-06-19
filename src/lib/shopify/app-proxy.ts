import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { repository } from "@/lib/db/repository";
import { loadShopByDomain } from "@/lib/db/supabase-persistence";
import { checkRateLimit } from "@/lib/security/rate-limit";
import type { ShopRecord } from "@/lib/db/schema";

export function signShopifyParams(params: Record<string, string>, secret: string) {
  const message = Object.entries(params)
    .filter(([key]) => key !== "signature" && key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("&");
  return createHmac("sha256", secret).update(message).digest("hex");
}

function signLegacyAppProxyParams(params: Record<string, string>, secret: string) {
  const message = Object.entries(params)
    .filter(([key]) => key !== "signature" && key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("");
  return createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqualHex(aHex: string, bHex: string) {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyShopifyHmac(params: URLSearchParams, secret: string) {
  const hmac = params.get("hmac");
  const signature = params.get("signature");
  const provided = hmac ?? signature;
  if (!provided) {
    return false;
  }
  const record: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key !== "hmac" && key !== "signature") {
      record[key] = value;
    }
  });
  const expected = hmac ? signShopifyParams(record, secret) : signLegacyAppProxyParams(record, secret);
  return safeEqualHex(provided, expected);
}

export function createAppProxySignature(params: Record<string, string>, secret: string) {
  return signLegacyAppProxyParams(params, secret);
}

export type AppProxyAuth =
  | { ok: true; shop: ShopRecord; shopDomain: string }
  | { ok: false; status: number; error: string };

export type AppProxyRateLimit =
  | { ok: true; remaining: number }
  | { ok: false; status: 429; error: "rate_limited"; scope: "shop" | "ip" | "room_session" };

export function authenticateAppProxyParams(params: URLSearchParams, secret: string): AppProxyAuth {
  if (!verifyShopifyHmac(params, secret)) {
    return { ok: false, status: 401, error: "invalid_app_proxy_hmac" };
  }
  const shopDomain = params.get("shop");
  if (!shopDomain) {
    return { ok: false, status: 400, error: "missing_shop" };
  }
  const shop = [...repository.shops.values()].find((item) => item.shopDomain === shopDomain);
  if (!shop) {
    return { ok: false, status: 404, error: "shop_not_installed" };
  }
  if (shop.uninstalledAt || shop.plan === "cancelled") {
    return { ok: false, status: 403, error: "shop_inactive" };
  }
  if (!shop.roomPreviewEnabled) {
    return { ok: false, status: 403, error: "room_preview_disabled" };
  }
  return { ok: true, shop, shopDomain };
}

export function authenticateAppProxyRequest(request: NextRequest): AppProxyAuth {
  return authenticateAppProxyParams(request.nextUrl.searchParams, readEnv().SHOPIFY_API_SECRET);
}

export async function authenticateDurableAppProxyRequest(request: NextRequest): Promise<AppProxyAuth> {
  const env = readEnv();
  if (!verifyShopifyHmac(request.nextUrl.searchParams, env.SHOPIFY_API_SECRET)) {
    return { ok: false, status: 401, error: "invalid_app_proxy_hmac" };
  }
  const shopDomain = request.nextUrl.searchParams.get("shop");
  if (!shopDomain) {
    return { ok: false, status: 400, error: "missing_shop" };
  }
  const shop = await loadShopByDomain(shopDomain, env);
  if (!shop) {
    return { ok: false, status: 404, error: "shop_not_installed" };
  }
  if (shop.uninstalledAt || shop.plan === "cancelled") {
    return { ok: false, status: 403, error: "shop_inactive" };
  }
  if (!shop.roomPreviewEnabled) {
    return { ok: false, status: 403, error: "room_preview_disabled" };
  }
  return { ok: true, shop, shopDomain };
}

function clientIp(request: Pick<NextRequest, "headers">) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function enforceAppProxyRateLimit(
  request: Pick<NextRequest, "headers">,
  auth: Extract<AppProxyAuth, { ok: true }>,
  options: { roomSessionId?: string } = {}
): AppProxyRateLimit {
  const checks: Array<{ key: string; scope: "shop" | "ip" | "room_session"; limit: number }> = [
    { key: "app-proxy:shop:" + auth.shop.id, scope: "shop" as const, limit: 120 },
    { key: "app-proxy:ip:" + clientIp(request), scope: "ip" as const, limit: 60 }
  ];
  if (options.roomSessionId) {
    checks.push({ key: "app-proxy:room:" + options.roomSessionId, scope: "room_session" as const, limit: 30 });
  }
  let remaining = Number.POSITIVE_INFINITY;
  for (const check of checks) {
    const result = checkRateLimit(check.key, check.limit, 60000);
    if (!result.ok) {
      return { ok: false, status: 429, error: "rate_limited", scope: check.scope };
    }
    remaining = Math.min(remaining, result.remaining);
  }
  return { ok: true, remaining };
}

export function appProxyErrorBody(auth: Extract<AppProxyAuth, { ok: false }> | Extract<AppProxyRateLimit, { ok: false }>) {
  if ("scope" in auth) {
    return { error: auth.error, scope: auth.scope };
  }
  return { error: auth.error };
}
