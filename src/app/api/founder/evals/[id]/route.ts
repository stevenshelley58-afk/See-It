import { NextResponse } from "next/server";
import { loadEvalRunBundle } from "@/lib/db/supabase-persistence";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const bundle = await loadEvalRunBundle(params.id);
  if (!bundle) {
    return NextResponse.json({ error: "eval_run_not_found" }, { status: 404 });
  }
  return NextResponse.json(bundle);
}
