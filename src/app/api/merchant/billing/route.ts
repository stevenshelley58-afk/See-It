import { NextRequest, NextResponse } from "next/server";
import { PLANS } from "@/lib/shopify/billing";
import { authenticateMerchantRequest, merchantAuthErrorBody } from "@/lib/shopify/session";

export async function GET(request: NextRequest) {
  const auth = await authenticateMerchantRequest(request);
  if (!auth.ok) {
    return NextResponse.json(merchantAuthErrorBody(auth), { status: auth.status });
  }
  return NextResponse.json({ plans: PLANS, shop: { id: auth.shop.id, plan: auth.shop.plan, billingStatus: auth.shop.billingStatus, rendersQuota: auth.shop.rendersQuota, lifestyleImagesQuota: auth.shop.lifestyleImagesQuota } });
}
