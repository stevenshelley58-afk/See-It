import { NextResponse } from "next/server";
import { loadFounderRenderRequests } from "@/lib/db/supabase-persistence";

export async function GET() {
  return NextResponse.json({ renders: await loadFounderRenderRequests() });
}
