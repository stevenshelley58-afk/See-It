import { repository } from "@/lib/db/repository";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { readEnv, type AppEnv } from "@/lib/env";
import { loadShopByDomain } from "@/lib/db/supabase-persistence";

export function requireShop(shopDomain: string) {
  const shop = [...repository.shops.values()].find((item) => item.shopDomain === shopDomain && !item.uninstalledAt);
  if (!shop) {
    throw new Error("Shop session required");
  }
  return shop;
}

type SessionPayload = {
  aud?: string;
  dest?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  sub?: string;
};

type VerifiedSessionPayload =
  | { ok: true; shopDomain: string; payload: SessionPayload }
  | { ok: false; status: number; error: string };

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function base64Url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function verifyJwtSignature(header: string, payload: string, signature: string, secret: string) {
  const expected = base64Url(createHmac("sha256", secret).update(header + "." + payload).digest());
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type MerchantSession =
  | { ok: true; shop: ReturnType<typeof requireShop>; shopDomain: string; payload: SessionPayload }
  | { ok: false; status: number; error: string };

function verifyShopifySessionPayload(token: string, env: Pick<AppEnv, "SHOPIFY_API_KEY" | "SHOPIFY_API_SECRET">, nowSeconds = Math.floor(Date.now() / 1000)): VerifiedSessionPayload {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    return { ok: false, status: 401, error: "invalid_session_token" };
  }
  let header: { alg?: string };
  let payload: SessionPayload;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader)) as { alg?: string };
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
  } catch {
    return { ok: false, status: 401, error: "invalid_session_token" };
  }
  if (header.alg !== "HS256" || !verifyJwtSignature(encodedHeader, encodedPayload, signature, env.SHOPIFY_API_SECRET)) {
    return { ok: false, status: 401, error: "invalid_session_signature" };
  }
  if (payload.aud !== env.SHOPIFY_API_KEY) {
    return { ok: false, status: 403, error: "invalid_session_audience" };
  }
  if (payload.nbf && payload.nbf > nowSeconds) {
    return { ok: false, status: 401, error: "session_not_active" };
  }
  if (!payload.exp || payload.exp <= nowSeconds) {
    return { ok: false, status: 401, error: "session_expired" };
  }
  let shopDomain: string | undefined;
  try {
    shopDomain = payload.dest ? new URL(payload.dest).hostname : undefined;
  } catch {
    return { ok: false, status: 401, error: "session_missing_shop" };
  }
  if (!shopDomain) {
    return { ok: false, status: 401, error: "session_missing_shop" };
  }
  return { ok: true, shopDomain, payload };
}

export function verifyShopifySessionToken(token: string, env: Pick<AppEnv, "SHOPIFY_API_KEY" | "SHOPIFY_API_SECRET">, nowSeconds = Math.floor(Date.now() / 1000)): MerchantSession {
  const verified = verifyShopifySessionPayload(token, env, nowSeconds);
  if (!verified.ok) {
    return verified;
  }
  try {
    return { ok: true, shop: requireShop(verified.shopDomain), shopDomain: verified.shopDomain, payload: verified.payload };
  } catch {
    return { ok: false, status: 403, error: "shop_session_required" };
  }
}

export async function authenticateMerchantRequest(request: NextRequest): Promise<MerchantSession> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return { ok: false, status: 401, error: "merchant_session_required" };
  }
  const env = readEnv();
  const verified = verifyShopifySessionPayload(token, env);
  if (!verified.ok) {
    return verified;
  }
  const shop = await loadShopByDomain(verified.shopDomain, env);
  if (!shop || shop.uninstalledAt || shop.plan === "cancelled") {
    return { ok: false, status: 403, error: "shop_session_required" };
  }
  return { ok: true, shop, shopDomain: verified.shopDomain, payload: verified.payload };
}

export function merchantAuthErrorBody(auth: Extract<MerchantSession, { ok: false }>) {
  return { error: auth.error };
}
