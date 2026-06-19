import { NextRequest, NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { handlePrivacyWebhook, verifyShopifyWebhookRequest, webhookErrorBody } from "@/lib/shopify/webhooks";

export async function POST(request: NextRequest) {
  const verified = await verifyShopifyWebhookRequest(request, readEnv().SHOPIFY_API_SECRET, "unknown");
  if (!verified.ok) {
    return NextResponse.json(webhookErrorBody(verified), { status: verified.status });
  }
  return NextResponse.json(handlePrivacyWebhook(verified.topic, verified.body));
}
