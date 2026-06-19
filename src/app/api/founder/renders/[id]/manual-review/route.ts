import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  repository.audit("founder", "manual_review", "render_request", params.id, undefined, undefined, "manual_review");
  return NextResponse.json({ ok: true, action: "manual_review" });
}
