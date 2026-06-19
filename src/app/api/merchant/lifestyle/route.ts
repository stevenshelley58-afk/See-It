import { NextRequest, NextResponse } from "next/server";
import { consumeLifestyleStarted } from "@/lib/billing/quota";
import { persistShop } from "@/lib/db/supabase-persistence";
import { enqueueDurableJob } from "@/lib/jobs/queue";
import { authenticateMerchantRequest, merchantAuthErrorBody } from "@/lib/shopify/session";

export async function POST(request: NextRequest) {
  const auth = await authenticateMerchantRequest(request);
  if (!auth.ok) {
    return NextResponse.json(merchantAuthErrorBody(auth), { status: auth.status });
  }
  let shop;
  try {
    shop = consumeLifestyleStarted(auth.shop.id);
  } catch {
    return NextResponse.json({ error: "lifestyle_quota_exhausted" }, { status: 402 });
  }
  await persistShop(shop);
  const body = await request.json().catch(() => ({}));
  const job = await enqueueDurableJob(
    "lifestyle_generate",
    { source: "merchant", shopId: auth.shop.id, productSetupId: body.productSetupId, recipeId: body.recipeId },
    "lifestyle:" + auth.shop.id + ":" + crypto.randomUUID(),
    40,
    3
  );
  return NextResponse.json({ jobId: job.id, status: job.status, remainingLifestyleImages: shop.lifestyleImagesQuota });
}
