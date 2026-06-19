import { NextRequest, NextResponse } from "next/server";
import { enqueueJob } from "@/lib/jobs/queue";
import { authenticateMerchantRequest, merchantAuthErrorBody } from "@/lib/shopify/session";

export async function POST(request: NextRequest) {
  const auth = authenticateMerchantRequest(request);
  if (!auth.ok) {
    return NextResponse.json(merchantAuthErrorBody(auth), { status: auth.status });
  }
  const job = enqueueJob("lifestyle_generate", { source: "merchant", shopId: auth.shop.id }, "lifestyle:" + auth.shop.id + ":" + crypto.randomUUID());
  return NextResponse.json({ jobId: job.id, status: job.status });
}
