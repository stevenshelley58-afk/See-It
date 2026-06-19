import { NextRequest, NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { handleOAuthCallback } from "@/lib/shopify/auth";

export async function GET(request: NextRequest) {
  try {
    const shop = await handleOAuthCallback(request.nextUrl, readEnv(), request.cookies.get("shopify_oauth_state")?.value);
    const response = NextResponse.redirect(new URL("/app/onboarding?shopId=" + shop.id, request.url));
    response.cookies.delete("shopify_oauth_state");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "oauth_callback_failed" }, { status: 400 });
  }
}
