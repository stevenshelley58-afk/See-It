import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { repository } from "@/lib/db/repository";
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

export function appProxyErrorBody(auth: Extract<AppProxyAuth, { ok: false }>) {
  return { error: auth.error };
}
