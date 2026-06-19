import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { appProxyErrorBody, authenticateAppProxyRequest } from "@/lib/shopify/app-proxy";

export async function POST(request: NextRequest) {
  const auth = authenticateAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const body = await request.json();
  repository.event({ surface: "widget", name: String(body.name ?? "widget_event"), shopId: auth.shop.id, props: body });
  return NextResponse.json({ ok: true });
}
