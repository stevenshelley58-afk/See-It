import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { traceRender } from "@/lib/render/trace";

export async function POST(request: NextRequest, { params }: { params: { renderId: string } }) {
  const body = await request.json();
  const render = repository.mustGet(repository.renderRequests, params.renderId, "render_request");
  const feedback = repository.createFeedback({ renderRequestId: render.id, verdict: body.verdict === "up" ? "up" : "down", issueTag: body.issueTag, comment: body.comment });
  traceRender(render.traceId, "feedback_submitted", { verdict: feedback.verdict, issueTag: feedback.issueTag }, render.id);
  return NextResponse.json({ ok: true });
}
