import { createHmac } from "node:crypto";
import { repository } from "@/lib/db/repository";
import { persistJob, persistShop } from "@/lib/db/supabase-persistence";
import { readSupabaseEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { PLANS } from "@/lib/shopify/billing";
import { loadScriptEnv } from "./script-env";

const SMOKE_SHOP_ID = "00000000-0000-4000-8000-000000000201";
const SMOKE_JOB_ID = "00000000-0000-4000-8000-000000000202";
const SMOKE_SHOP_DOMAIN = "see-it-webhook-smoke.myshopify.com";

type JsonRecord = Record<string, unknown>;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error("Missing required smoke env: " + name);
  }
  return value;
}

function smokeBaseUrl() {
  return (process.env.WEBHOOK_SMOKE_BASE_URL || process.env.APP_URL || "https://see-it-nine.vercel.app").replace(/\/$/, "");
}

function webhookHmac(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64");
}

async function postWebhook(baseUrl: string, path: string, topic: string, payload: JsonRecord, secret: string) {
  const body = JSON.stringify(payload);
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": SMOKE_SHOP_DOMAIN,
      "x-shopify-hmac-sha256": webhookHmac(body, secret),
      "x-shopify-webhook-id": crypto.randomUUID()
    },
    body
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
  console.log(response.status + " POST " + path + " " + topic);
  if (response.status !== 200) {
    throw new Error(path + " expected 200 got " + response.status + ": " + text);
  }
  return json;
}

async function seedWebhookSmokeData() {
  repository.reset();
  const shop = repository.createShop({
    id: SMOKE_SHOP_ID,
    shopDomain: SMOKE_SHOP_DOMAIN,
    shopName: "See It Webhook Smoke",
    offlineAccessTokenEncrypted: "redacted-webhook-smoke-token",
    plan: "trial",
    rendersQuota: PLANS.trial.renders,
    lifestyleImagesQuota: PLANS.trial.lifestyleImages,
    billingStatus: "trial",
    roomPreviewEnabled: true,
    installedAt: new Date().toISOString()
  });
  const job = repository.enqueueJob({
    id: SMOKE_JOB_ID,
    type: "render_request",
    status: "queued",
    priority: 10,
    payload: { shopId: shop.id, smoke: true },
    idempotencyKey: "webhook-smoke:" + shop.id,
    maxAttempts: 3,
    runAfter: new Date().toISOString()
  });
  await persistShop(shop);
  await persistJob(job);
  return { shop, job };
}

loadScriptEnv();
const secret = requiredEnv("SHOPIFY_API_SECRET");
const baseUrl = smokeBaseUrl();
const startedAt = new Date().toISOString();
const { shop, job } = await seedWebhookSmokeData();

const privacyPayload = {
  shop_id: 1,
  shop_domain: shop.shopDomain,
  customer: { id: 1, email: "privacy-smoke@example.com" },
  orders_requested: [],
  data_request: { id: 1 }
};
await postWebhook(baseUrl, "/api/webhooks/privacy/customers-data-request", "customers/data_request", privacyPayload, secret);
await postWebhook(baseUrl, "/api/webhooks/privacy/customers-redact", "customers/redact", privacyPayload, secret);
await postWebhook(baseUrl, "/api/webhooks/privacy/shop-redact", "shop/redact", { shop_domain: shop.shopDomain, shop_id: 1 }, secret);
await postWebhook(baseUrl, "/api/webhooks/shop/update", "shop/update", { myshopify_domain: shop.shopDomain, shop_owner: "Webhook Smoke" }, secret);
const uninstall = await postWebhook(baseUrl, "/api/webhooks/app/uninstalled", "app/uninstalled", { myshopify_domain: shop.shopDomain, id: 1 }, secret);
if (uninstall.ok !== true || uninstall.disabled !== true || Number(uninstall.cancelledJobs ?? 0) < 1) {
  throw new Error("Uninstall webhook did not disable shop and cancel persisted jobs: " + JSON.stringify(uninstall));
}

const client = createSupabaseServiceClient(readSupabaseEnv());
const { data: persistedShop, error: shopError } = await client
  .from("shop")
  .select("room_preview_enabled,billing_status,uninstalled_at,offline_access_token_encrypted")
  .eq("id", shop.id)
  .maybeSingle();
if (shopError) {
  throw new Error("Failed to verify smoke shop: " + shopError.message);
}
if (!persistedShop || persistedShop.room_preview_enabled !== false || persistedShop.billing_status !== "uninstalled" || !persistedShop.uninstalled_at || persistedShop.offline_access_token_encrypted !== null) {
  throw new Error("Smoke shop uninstall state was not persisted: " + JSON.stringify(persistedShop));
}

const { data: persistedJob, error: jobError } = await client.from("job").select("status").eq("id", job.id).maybeSingle();
if (jobError) {
  throw new Error("Failed to verify smoke job: " + jobError.message);
}
if (!persistedJob || persistedJob.status !== "cancelled") {
  throw new Error("Smoke job was not cancelled: " + JSON.stringify(persistedJob));
}

const expectedEventNames = ["privacy_customers_data_request", "privacy_customers_redact", "privacy_shop_redact", "privacy_shop_update", "app_uninstalled"];
const { data: events, error: eventError } = await client
  .from("event_log")
  .select("name")
  .in("name", expectedEventNames)
  .gte("ts", startedAt);
if (eventError) {
  throw new Error("Failed to verify smoke events: " + eventError.message);
}
const seen = new Set((events ?? []).map((event) => String(event.name)));
for (const name of expectedEventNames) {
  if (!seen.has(name)) {
    throw new Error("Missing smoke event: " + name);
  }
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  shopDomain: shop.shopDomain,
  cancelledJobId: job.id,
  events: [...seen].sort()
}, null, 2));
