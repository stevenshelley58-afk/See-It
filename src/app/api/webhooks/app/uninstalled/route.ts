import { NextRequest, NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { handleUninstall, verifyShopifyWebhookRequest, webhookErrorBody } from "@/lib/shopify/webhooks";

export async function POST(request: NextRequest) {
  const verified = await verifyShopifyWebhookRequest(request, readEnv().SHOPIFY_API_SECRET, "app/uninstalled");
  if (!verified.ok) {
    return NextResponse.json(webhookErrorBody(verified), { status: verified.status });
  }
  const body = verified.body as Record<string, unknown>;
  return NextResponse.json(handleUninstall(String(body.myshopify_domain ?? body.shop_domain ?? "unknown")));
}
