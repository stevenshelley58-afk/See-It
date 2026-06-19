import { NextRequest, NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { buildInstallUrl } from "@/lib/shopify/auth";

export async function GET(request: NextRequest) {
  const env = readEnv();
  const shop = request.nextUrl.searchParams.get("shop");
  if (!shop || !/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    return NextResponse.json({ error: "invalid_shop" }, { status: 400 });
  }
  const state = crypto.randomUUID();
  const url = buildInstallUrl(shop, state, env.SHOPIFY_API_KEY, env.SHOPIFY_APP_URL, ["read_products", "write_products"]);
  const response = NextResponse.redirect(url);
  response.cookies.set("shopify_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: env.APP_ENV !== "development" && env.APP_ENV !== "test", path: "/", maxAge: 60 * 10 });
  return response;
}
