import { NextRequest, NextResponse } from "next/server";
import { handleOAuthCallback } from "@/lib/shopify/auth";

export async function GET(request: NextRequest) {
  const shop = handleOAuthCallback(request.nextUrl, "local-shopify-secret", "local-encryption-key");
  return NextResponse.redirect(new URL("/app/onboarding?shopId=" + shop.id, request.url));
}
