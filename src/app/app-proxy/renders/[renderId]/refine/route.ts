import { NextRequest, NextResponse } from "next/server";
import { assertRenderQuota } from "@/lib/billing/quota";
import { repository } from "@/lib/db/repository";
import { loadRenderRequestById, persistRenderBundle } from "@/lib/db/supabase-persistence";
import { createDurableRenderRequest } from "@/lib/render/orchestrator";
import { appProxyErrorBody, authenticateDurableAppProxyRequest, enforceAppProxyRateLimit } from "@/lib/shopify/app-proxy";

export async function POST(request: NextRequest, { params }: { params: { renderId: string } }) {
  const auth = await authenticateDurableAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const source = await loadRenderRequestById(params.renderId);
  if (!source || source.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "render_not_found" }, { status: 404 });
  }
  const limit = enforceAppProxyRateLimit(request, auth, { roomSessionId: source.roomSessionId });
  if (!limit.ok) {
    return NextResponse.json(appProxyErrorBody(limit), { status: limit.status });
  }
  const body = await request.json().catch(() => ({}));
  const hint = String(body.hint ?? "").slice(0, 200);
  if (source.status !== "done") {
    return NextResponse.json({ error: "parent render must be done" }, { status: 409 });
  }
  if (source.remainingRefinements <= 0) {
    return NextResponse.json({ error: "max refinements reached" }, { status: 409 });
  }
  if (!source.roomSessionId) {
    return NextResponse.json({ error: "source_assets_unavailable" }, { status: 409 });
  }
  try {
    assertRenderQuota(auth.shop.id);
  } catch {
    return NextResponse.json({ error: "quota_exhausted" }, { status: 402 });
  }
  repository.updateRenderRequest(source.id, { remainingRefinements: source.remainingRefinements - 1 });
  const render = await createDurableRenderRequest({ roomSessionId: source.roomSessionId, tap: { x: source.tapX ?? 0.5, y: source.tapY ?? 0.7 }, sourceRenderRequestId: source.id, hintText: hint });
  await persistRenderBundle(source.id);
  await persistRenderBundle(render.id);
  return NextResponse.json({ renderId: render.id, traceId: render.traceId, status: "queued" });
}
