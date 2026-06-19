import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { createRenderRequest } from "@/lib/render/orchestrator";

export async function POST(request: NextRequest, { params }: { params: { renderId: string } }) {
  const source = repository.mustGet(repository.renderRequests, params.renderId, "render_request");
  const body = await request.json();
  const hint = String(body.hint ?? "").slice(0, 200);
  if (source.status !== "done") {
    return NextResponse.json({ error: "parent render must be done" }, { status: 409 });
  }
  if (source.remainingRefinements <= 0) {
    return NextResponse.json({ error: "max refinements reached" }, { status: 409 });
  }
  repository.updateRenderRequest(source.id, { remainingRefinements: source.remainingRefinements - 1 });
  const render = createRenderRequest({ roomSessionId: source.roomSessionId ?? "", tap: { x: source.tapX ?? 0.5, y: source.tapY ?? 0.7 }, sourceRenderRequestId: source.id, hintText: hint });
  return NextResponse.json({ renderId: render.id, traceId: render.traceId, status: "queued" });
}
