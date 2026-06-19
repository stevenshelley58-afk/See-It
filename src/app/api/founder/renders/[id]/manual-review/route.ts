import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadRenderRequestById, persistAudit, persistManualReview, persistRenderBundle } from "@/lib/db/supabase-persistence";
import type { ManualReviewRecord } from "@/lib/db/schema";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const render = await loadRenderRequestById(id);
  if (!render) {
    return NextResponse.json({ error: "render_not_found" }, { status: 404 });
  }
  const review = repository.createManualReview({
    renderRequestId: render.id,
    reviewer: String(body.reviewer ?? "founder"),
    score: body.score === undefined ? undefined : Number(body.score),
    status: String(body.status ?? "needs_prompt_work") as ManualReviewRecord["status"],
    issueTags: Array.isArray(body.issueTags) ? body.issueTags.map(String) : [],
    notes: typeof body.notes === "string" ? body.notes : undefined
  });
  const audit = repository.audit("founder", "manual_review", "render_request", id, render, review, body.reason);
  await persistManualReview(review);
  await persistAudit(audit);
  await persistRenderBundle(render.id);
  return NextResponse.json({ review });
}
