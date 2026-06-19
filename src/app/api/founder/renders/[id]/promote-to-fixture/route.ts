import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  repository.audit("founder", "promote_to_fixture", "render_request", params.id, undefined, undefined, "promote_to_fixture");
  return NextResponse.json({ ok: true, action: "promote_to_fixture" });
}
