import { NextResponse } from "next/server";
import { loadRenderBundle } from "@/lib/db/supabase-persistence";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await loadRenderBundle(id);
  if (!bundle) {
    return NextResponse.json({ error: "render_not_found" }, { status: 404 });
  }
  return NextResponse.json(bundle);
}
