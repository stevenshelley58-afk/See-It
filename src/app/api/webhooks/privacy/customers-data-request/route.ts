import { NextRequest, NextResponse } from "next/server";
import { handlePrivacyWebhook } from "@/lib/shopify/webhooks";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(handlePrivacyWebhook("customers/data_request", body));
}
