import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import type { ManualReviewRecord } from "@/lib/db/schema";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const render = repository.mustGet(repository.renderRequests, params.id, "render_request");
  const review = repository.createManualReview({
    renderRequestId: render.id,
    reviewer: String(body.reviewer ?? "founder"),
    score: body.score === undefined ? undefined : Number(body.score),
    status: String(body.status ?? "needs_prompt_work") as ManualReviewRecord["status"],
    issueTags: Array.isArray(body.issueTags) ? body.issueTags.map(String) : [],
    notes: typeof body.notes === "string" ? body.notes : undefined
  });
  repository.audit("founder", "manual_review", "render_request", params.id, render, review, body.reason);
  return NextResponse.json({ review });
}
