import { NextRequest, NextResponse } from "next/server";
import { createRenderRequest } from "@/lib/render/orchestrator";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const render = createRenderRequest({ roomSessionId: body.roomSessionId, tap: body.tap ?? { x: 0.5, y: 0.7 } });
  return NextResponse.json({ renderId: render.id, traceId: render.traceId, status: "queued" });
}
