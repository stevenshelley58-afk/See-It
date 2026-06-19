import { NextRequest, NextResponse } from "next/server";
import { buildInstallUrl } from "@/lib/shopify/auth";

export async function GET(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get("shop") ?? "demo.myshopify.com";
  const url = buildInstallUrl(shop, crypto.randomUUID(), "local-api-key", "http://localhost:3000", ["read_products", "write_products"]);
  return NextResponse.redirect(url);
}
