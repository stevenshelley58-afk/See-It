import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { createProductSetup } from "@/lib/merchant/products";

export async function GET() {
  return NextResponse.json({ products: [...repository.products.values()] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const shop = [...repository.shops.values()][0] ?? repository.createShop({ shopDomain: "demo.myshopify.com", plan: "trial", rendersQuota: 50, lifestyleImagesQuota: 10, billingStatus: "trial", roomPreviewEnabled: true });
  const product = createProductSetup(shop.id, { gid: body.gid ?? "gid://shopify/Product/demo", handle: body.handle ?? "demo-product", title: body.title ?? "Demo product", imageKey: body.imageKey ?? "products/demo/source.png" });
  return NextResponse.json(product);
}
