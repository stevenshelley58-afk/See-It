import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { persistEvent } from "@/lib/db/supabase-persistence";
import { appProxyErrorBody, authenticateDurableAppProxyRequest, enforceAppProxyRateLimit } from "@/lib/shopify/app-proxy";

export async function POST(request: NextRequest) {
  const auth = await authenticateDurableAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const body = await request.json().catch(() => ({}));
  const roomSessionId = typeof body.roomSessionId === "string" ? body.roomSessionId : undefined;
  const limit = enforceAppProxyRateLimit(request, auth, { roomSessionId });
  if (!limit.ok) {
    return NextResponse.json(appProxyErrorBody(limit), { status: limit.status });
  }
  await persistEvent(repository.event({ surface: "widget", name: String(body.name ?? "widget_event"), shopId: auth.shop.id, props: body }));
  return NextResponse.json({ ok: true });
}
