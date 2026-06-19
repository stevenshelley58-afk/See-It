import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadRenderRequestById, persistRenderBundle } from "@/lib/db/supabase-persistence";
import { traceRender } from "@/lib/render/trace";
import { appProxyErrorBody, authenticateDurableAppProxyRequest, enforceAppProxyRateLimit } from "@/lib/shopify/app-proxy";

export async function POST(request: NextRequest, { params }: { params: Promise<{ renderId: string }> }) {
  const { renderId } = await params;
  const auth = await authenticateDurableAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const render = await loadRenderRequestById(renderId);
  if (!render || render.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "render_not_found" }, { status: 404 });
  }
  const limit = enforceAppProxyRateLimit(request, auth, { roomSessionId: render.roomSessionId });
  if (!limit.ok) {
    return NextResponse.json(appProxyErrorBody(limit), { status: limit.status });
  }
  const body = await request.json().catch(() => ({}));
  const feedback = repository.createFeedback({ renderRequestId: render.id, verdict: body.verdict === "up" ? "up" : "down", issueTag: body.issueTag, comment: body.comment });
  traceRender(render.traceId, "feedback_submitted", { verdict: feedback.verdict, issueTag: feedback.issueTag }, render.id);
  await persistRenderBundle(render.id);
  return NextResponse.json({ ok: true });
}
