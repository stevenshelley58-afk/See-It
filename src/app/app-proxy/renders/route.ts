import { NextRequest, NextResponse } from "next/server";
import { assertRenderQuota } from "@/lib/billing/quota";
import { loadRoomSessionById, persistRenderBundle } from "@/lib/db/supabase-persistence";
import { createDurableRenderRequest } from "@/lib/render/orchestrator";
import { appProxyErrorBody, authenticateDurableAppProxyRequest, enforceAppProxyRateLimit } from "@/lib/shopify/app-proxy";

export async function POST(request: NextRequest) {
  const auth = await authenticateDurableAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const body = await request.json().catch(() => ({}));
  const room = await loadRoomSessionById(String(body.roomSessionId ?? ""));
  if (!room || room.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  const limit = enforceAppProxyRateLimit(request, auth, { roomSessionId: room.id });
  if (!limit.ok) {
    return NextResponse.json(appProxyErrorBody(limit), { status: limit.status });
  }
  if (!room.verified) {
    return NextResponse.json({ error: "room_not_verified" }, { status: 409 });
  }
  try {
    assertRenderQuota(auth.shop.id);
  } catch {
    return NextResponse.json({ error: "quota_exhausted" }, { status: 402 });
  }
  const render = await createDurableRenderRequest({ roomSessionId: room.id, tap: body.tap ?? { x: 0.5, y: 0.7 } });
  await persistRenderBundle(render.id);
  return NextResponse.json({ renderId: render.id, traceId: render.traceId, status: "queued" });
}
