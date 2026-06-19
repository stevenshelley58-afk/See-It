import { signShopifyParams } from "@/lib/shopify/app-proxy";
import { repository } from "@/lib/db/repository";
import { persistProductSetup, persistShop } from "@/lib/db/supabase-persistence";
import { PLANS } from "@/lib/shopify/billing";
import { loadScriptEnv } from "./script-env";

const SMOKE_SHOP_ID = "00000000-0000-4000-8000-000000000101";
const SMOKE_PRODUCT_ID = "00000000-0000-4000-8000-000000000102";
const SMOKE_SHOP_DOMAIN = "see-it-app-proxy-smoke.myshopify.com";
const SMOKE_PRODUCT_GID = "gid://shopify/Product/see-it-app-proxy-smoke";

type JsonRecord = Record<string, unknown>;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error("Missing required smoke env: " + name);
  }
  return value;
}

function smokeBaseUrl() {
  return (process.env.APP_PROXY_SMOKE_BASE_URL || process.env.APP_URL || "https://see-it-nine.vercel.app").replace(/\/$/, "");
}

function signedAppProxyUrl(baseUrl: string, path: string, secret: string) {
  const params: Record<string, string> = {
    shop: SMOKE_SHOP_DOMAIN,
    timestamp: Math.floor(Date.now() / 1000).toString()
  };
  const hmac = signShopifyParams(params, secret);
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("hmac", hmac);
  return url;
}

async function jsonRequest(baseUrl: string, path: string, secret: string, init: RequestInit = {}) {
  const response = await fetch(signedAppProxyUrl(baseUrl, path, secret), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let json: JsonRecord = {};
  if (text) {
    try {
      json = JSON.parse(text) as JsonRecord;
    } catch {
      json = { raw: text };
    }
  }
  return { response, json };
}

function expectStatus(label: string, status: number, expected: number) {
  console.log(status + " " + label);
  if (status !== expected) {
    throw new Error(label + " expected " + expected + " got " + status);
  }
}

async function seedSmokeShop() {
  const shop = repository.createShop({
    id: SMOKE_SHOP_ID,
    shopDomain: SMOKE_SHOP_DOMAIN,
    shopName: "See It App Proxy Smoke",
    plan: "trial",
    rendersQuota: PLANS.trial.renders,
    lifestyleImagesQuota: PLANS.trial.lifestyleImages,
    billingStatus: "trial",
    roomPreviewEnabled: true,
    installedAt: new Date().toISOString()
  });
  const product = repository.createProduct({
    id: SMOKE_PRODUCT_ID,
    shopId: shop.id,
    shopifyProductGid: SMOKE_PRODUCT_GID,
    shopifyProductHandle: "see-it-app-proxy-smoke",
    title: "See It app proxy smoke product",
    widthMm: 700,
    heightMm: 820,
    depthMm: 760,
    category: "furniture",
    material: "test",
    colour: "test",
    primaryImageKey: "products/app-proxy-smoke/source.png",
    cutoutKey: "products/app-proxy-smoke/cutout.png",
    prepStatus: "ready",
    enabled: true
  });
  await persistShop(shop);
  await persistProductSetup(product);
  return { shop, product };
}

loadScriptEnv();
const secret = requiredEnv("SHOPIFY_API_SECRET");
const baseUrl = smokeBaseUrl();
const { shop, product } = await seedSmokeShop();

const room = await jsonRequest(baseUrl, "/app-proxy/rooms", secret, {
  method: "POST",
  body: JSON.stringify({
    productGid: product.shopifyProductGid,
    fileName: "smoke-room.jpg",
    mimeType: "image/jpeg"
  })
});
expectStatus("POST /app-proxy/rooms", room.response.status, 200);
const roomSessionId = String(room.json.roomSessionId ?? "");
if (!roomSessionId) {
  throw new Error("Room smoke did not return roomSessionId");
}

const verify = await jsonRequest(baseUrl, "/app-proxy/rooms/" + roomSessionId + "/verify", secret, {
  method: "POST",
  body: JSON.stringify({
    mimeType: "image/jpeg",
    width: 1600,
    height: 1200,
    bytes: 512000
  })
});
expectStatus("POST /app-proxy/rooms/:roomSessionId/verify", verify.response.status, 200);
if (verify.json.ok !== true) {
  throw new Error("Room verify smoke did not return ok=true");
}

const render = await jsonRequest(baseUrl, "/app-proxy/renders", secret, {
  method: "POST",
  body: JSON.stringify({
    roomSessionId,
    tap: { x: 0.42, y: 0.68 }
  })
});
expectStatus("POST /app-proxy/renders", render.response.status, 200);
const renderId = String(render.json.renderId ?? "");
if (!renderId) {
  throw new Error("Render smoke did not return renderId");
}

const status = await jsonRequest(baseUrl, "/app-proxy/renders/" + renderId, secret);
expectStatus("GET /app-proxy/renders/:renderId", status.response.status, 200);
if (!["queued", "running", "done", "failed"].includes(String(status.json.status))) {
  throw new Error("Render status smoke returned unexpected status: " + JSON.stringify(status.json));
}

const feedback = await jsonRequest(baseUrl, "/app-proxy/renders/" + renderId + "/feedback", secret, {
  method: "POST",
  body: JSON.stringify({
    verdict: "down",
    issueTag: "smoke_test",
    comment: "Automated production app proxy smoke"
  })
});
expectStatus("POST /app-proxy/renders/:renderId/feedback", feedback.response.status, 200);
if (feedback.json.ok !== true) {
  throw new Error("Feedback smoke did not return ok=true");
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  shopDomain: shop.shopDomain,
  productSetupId: product.id,
  roomSessionId,
  renderId
}, null, 2));
