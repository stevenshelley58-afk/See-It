import { encryptSecret } from "@/lib/security/encryption";
import { verifyShopifyHmac } from "@/lib/shopify/app-proxy";
import { repository } from "@/lib/db/repository";
import type { AppEnv } from "@/lib/env";

export function buildInstallUrl(shop: string, state: string, apiKey: string, appUrl: string, scopes: string[]) {
  const redirectUri = appUrl.replace(/\/$/, "") + "/api/auth/callback";
  const params = new URLSearchParams({ client_id: apiKey, scope: scopes.join(","), redirect_uri: redirectUri, state });
  return "https://" + shop + "/admin/oauth/authorize?" + params.toString();
}

export async function exchangeOfflineAccessToken(shopDomain: string, code: string, env: Pick<AppEnv, "SHOPIFY_API_KEY" | "SHOPIFY_API_SECRET" | "APP_ENV">) {
  if (env.APP_ENV === "test") {
    return "test-offline-token:" + code;
  }
  const response = await fetch("https://" + shopDomain + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET, code })
  });
  if (!response.ok) {
    throw new Error("Shopify token exchange failed: " + response.status);
  }
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Shopify token exchange returned no access token");
  }
  return payload.access_token;
}

export async function handleOAuthCallback(url: URL, env: Pick<AppEnv, "SHOPIFY_API_KEY" | "SHOPIFY_API_SECRET" | "ENCRYPTION_KEY" | "APP_ENV">, expectedState?: string) {
  if (!verifyShopifyHmac(url.searchParams, env.SHOPIFY_API_SECRET)) {
    throw new Error("Invalid Shopify OAuth HMAC");
  }
  const shopDomain = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!shopDomain || !code) {
    throw new Error("Missing OAuth callback parameters");
  }
  if (expectedState && state !== expectedState) {
    throw new Error("Invalid Shopify OAuth state");
  }
  const accessToken = await exchangeOfflineAccessToken(shopDomain, code, env);
  const shop = repository.createShop({
    shopDomain,
    plan: "trial",
    rendersQuota: 50,
    lifestyleImagesQuota: 10,
    billingStatus: "trial",
    roomPreviewEnabled: true,
    offlineAccessTokenEncrypted: encryptSecret(accessToken, env.ENCRYPTION_KEY)
  });
  repository.event({ surface: "admin", name: "oauth_callback_succeeded", shopId: shop.id, props: { shopDomain } });
  return shop;
}
