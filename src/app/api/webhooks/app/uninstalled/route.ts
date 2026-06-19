import { NextRequest, NextResponse } from "next/server";
import { handleUninstall } from "@/lib/shopify/webhooks";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(handleUninstall(String(body.myshopify_domain ?? body.shop_domain ?? "unknown")));
}
