import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadProductSetupsByShop, persistProductSetup } from "@/lib/db/supabase-persistence";
import { createProductSetup } from "@/lib/merchant/products";
import { authenticateMerchantRequest, merchantAuthErrorBody } from "@/lib/shopify/session";

export async function GET(request: NextRequest) {
  const auth = await authenticateMerchantRequest(request);
  if (!auth.ok) {
    return NextResponse.json(merchantAuthErrorBody(auth), { status: auth.status });
  }
  await loadProductSetupsByShop(auth.shop.id);
  return NextResponse.json({ products: [...repository.products.values()].filter((product) => product.shopId === auth.shop.id) });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateMerchantRequest(request);
  if (!auth.ok) {
    return NextResponse.json(merchantAuthErrorBody(auth), { status: auth.status });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.gid || !body.handle || !body.title || !body.imageKey) {
    return NextResponse.json({ error: "missing_shopify_product_fields" }, { status: 400 });
  }
  const product = createProductSetup(auth.shop.id, { gid: body.gid, handle: body.handle, title: body.title, imageKey: body.imageKey });
  await persistProductSetup(product);
  return NextResponse.json(product);
}
