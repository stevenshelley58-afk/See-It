import { NextRequest, NextResponse } from "next/server";
import { handlePrivacyWebhook } from "@/lib/shopify/webhooks";

export async function POST(request: NextRequest) {
  const topic = request.headers.get("x-shopify-topic") ?? "unknown";
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(handlePrivacyWebhook(topic, body));
}
