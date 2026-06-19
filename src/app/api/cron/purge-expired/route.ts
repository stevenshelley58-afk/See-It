import { NextResponse } from "next/server";
import { purgeExpiredAssets } from "@/lib/jobs/worker";

export async function POST() {
  return NextResponse.json({ purged: purgeExpiredAssets() });
}

export const GET = POST;
