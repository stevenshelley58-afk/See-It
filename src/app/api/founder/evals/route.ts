import { NextResponse } from "next/server";
import { loadEvalOverview } from "@/lib/db/supabase-persistence";

export async function GET() {
  return NextResponse.json(await loadEvalOverview());
}
