import { encryptSecret } from "@/lib/security/encryption";
import { verifyShopifyHmac } from "@/lib/shopify/app-proxy";
import { repository } from "@/lib/db/repository";

export function buildInstallUrl(shop: string, state: string, apiKey: string, appUrl: string, scopes: string[]) {
  const redirectUri = appUrl.replace(/\/$/, "") + "/api/auth/callback";
  const params = new URLSearchParams({ client_id: apiKey, scope: scopes.join(","), redirect_uri: redirectUri, state });
  return "https://" + shop + "/admin/oauth/authorize?" + params.toString();
}

export function handleOAuthCallback(url: URL, secret: string, encryptionKey: string) {
  if (!verifyShopifyHmac(url.searchParams, secret)) {
    throw new Error("Invalid Shopify OAuth HMAC");
  }
  const shopDomain = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  if (!shopDomain || !code) {
    throw new Error("Missing OAuth callback parameters");
  }
  const shop = repository.createShop({
    shopDomain,
    plan: "trial",
    rendersQuota: 50,
    lifestyleImagesQuota: 10,
    billingStatus: "trial",
    roomPreviewEnabled: true,
    offlineAccessTokenEncrypted: encryptSecret("offline-token:" + code, encryptionKey)
  });
  repository.event({ surface: "admin", name: "oauth_callback_succeeded", shopId: shop.id, props: { shopDomain } });
  return shop;
}
