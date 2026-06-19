import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { traceRender } from "@/lib/render/trace";
import { appProxyErrorBody, authenticateAppProxyRequest } from "@/lib/shopify/app-proxy";

export async function POST(request: NextRequest, { params }: { params: { renderId: string } }) {
  const auth = authenticateAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const body = await request.json();
  const render = repository.mustGet(repository.renderRequests, params.renderId, "render_request");
  if (render.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "render_not_found" }, { status: 404 });
  }
  const feedback = repository.createFeedback({ renderRequestId: render.id, verdict: body.verdict === "up" ? "up" : "down", issueTag: body.issueTag, comment: body.comment });
  traceRender(render.traceId, "feedback_submitted", { verdict: feedback.verdict, issueTag: feedback.issueTag }, render.id);
  return NextResponse.json({ ok: true });
}
