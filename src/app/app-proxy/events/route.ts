import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function POST(request: NextRequest) {
  const body = await request.json();
  repository.event({ surface: "widget", name: String(body.name ?? "widget_event"), props: body });
  return NextResponse.json({ ok: true });
}
