import { NextRequest, NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { handleDurablePrivacyWebhook, verifyShopifyWebhookRequest, webhookErrorBody } from "@/lib/shopify/webhooks";

export async function POST(request: NextRequest) {
  const verified = await verifyShopifyWebhookRequest(request, readEnv().SHOPIFY_API_SECRET, "customers/redact");
  if (!verified.ok) {
    return NextResponse.json(webhookErrorBody(verified), { status: verified.status });
  }
  return NextResponse.json(await handleDurablePrivacyWebhook("customers/redact", verified.body, verified.shopDomain));
}
