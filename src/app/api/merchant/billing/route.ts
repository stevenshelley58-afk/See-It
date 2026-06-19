import { NextResponse } from "next/server";
import { PLANS } from "@/lib/shopify/billing";

export async function GET() {
  return NextResponse.json({ plans: PLANS });
}
