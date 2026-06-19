import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadShopByDomain, persistEvent, persistJob, persistShop } from "@/lib/db/supabase-persistence";

export function verifyWebhook(body: string, hmacHeader: string | null, secret: string) {
  if (!hmacHeader) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(body).digest("base64");
  const a = Buffer.from(hmacHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function handlePrivacyWebhook(topic: string, payload: unknown) {
  repository.event({ surface: "system", name: "privacy_" + topic.replace(/[/:]/g, "_"), props: { payload } });
  return { ok: true };
}

export async function handleDurablePrivacyWebhook(topic: string, payload: unknown) {
  await persistEvent(repository.event({ surface: "system", name: "privacy_" + topic.replace(/[/:]/g, "_"), props: { payload } }));
  return { ok: true };
}

export type VerifiedWebhook =
  | { ok: true; topic: string; shopDomain?: string; body: unknown; rawBody: string }
  | { ok: false; status: number; error: string };

export async function verifyShopifyWebhookRequest(request: NextRequest, secret: string, fallbackTopic: string): Promise<VerifiedWebhook> {
  const rawBody = await request.text();
  if (!verifyWebhook(rawBody, request.headers.get("x-shopify-hmac-sha256"), secret)) {
    return { ok: false, status: 401, error: "invalid_shopify_webhook_hmac" };
  }
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, error: "invalid_shopify_webhook_json" };
  }
  return {
    ok: true,
    topic: request.headers.get("x-shopify-topic") ?? fallbackTopic,
    shopDomain: request.headers.get("x-shopify-shop-domain") ?? undefined,
    body,
    rawBody
  };
}

export function webhookErrorBody(result: Extract<VerifiedWebhook, { ok: false }>) {
  return { error: result.error };
}

export function handleUninstall(shopDomain: string) {
  const shop = [...repository.shops.values()].find((item) => item.shopDomain === shopDomain);
  if (!shop) {
    return { ok: true, disabled: false };
  }
  repository.shops.set(shop.id, { ...shop, uninstalledAt: new Date().toISOString(), offlineAccessTokenEncrypted: undefined, roomPreviewEnabled: false, billingStatus: "uninstalled" });
  repository.cancelJobsForShop(shop.id);
  repository.event({ surface: "system", name: "app_uninstalled", shopId: shop.id, props: { shopDomain } });
  return { ok: true, disabled: true };
}

export async function handleDurableUninstall(shopDomain: string) {
  const shop = await loadShopByDomain(shopDomain);
  if (!shop) {
    return { ok: true, disabled: false };
  }
  const updated = { ...shop, uninstalledAt: new Date().toISOString(), offlineAccessTokenEncrypted: undefined, roomPreviewEnabled: false, billingStatus: "uninstalled" };
  repository.shops.set(shop.id, updated);
  const cancelled = repository.cancelJobsForShop(shop.id);
  await persistShop(updated);
  for (const job of repository.jobs.values()) {
    if (job.payload.shopId === shop.id) {
      await persistJob(job);
    }
  }
  await persistEvent(repository.event({ surface: "system", name: "app_uninstalled", shopId: shop.id, props: { shopDomain, cancelledJobs: cancelled } }));
  return { ok: true, disabled: true, cancelledJobs: cancelled };
}
