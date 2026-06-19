import { NextResponse } from "next/server";
import { loadEvalRunBundle } from "@/lib/db/supabase-persistence";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await loadEvalRunBundle(id);
  if (!bundle) {
    return NextResponse.json({ error: "eval_run_not_found" }, { status: 404 });
  }
  return NextResponse.json(bundle);
}
