import { NextRequest, NextResponse } from "next/server";
import { assertRenderQuota } from "@/lib/billing/quota";
import { repository } from "@/lib/db/repository";
import { createRenderRequest } from "@/lib/render/orchestrator";
import { appProxyErrorBody, authenticateAppProxyRequest } from "@/lib/shopify/app-proxy";

export async function POST(request: NextRequest) {
  const auth = authenticateAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const body = await request.json();
  const room = repository.mustGet(repository.roomSessions, body.roomSessionId, "room_session");
  if (room.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "room_not_found" }, { status: 404 });
  }
  if (!room.verified) {
    return NextResponse.json({ error: "room_not_verified" }, { status: 409 });
  }
  try {
    assertRenderQuota(auth.shop.id);
  } catch {
    return NextResponse.json({ error: "quota_exhausted" }, { status: 402 });
  }
  const render = createRenderRequest({ roomSessionId: body.roomSessionId, tap: body.tap ?? { x: 0.5, y: 0.7 } });
  return NextResponse.json({ renderId: render.id, traceId: render.traceId, status: "queued" });
}
