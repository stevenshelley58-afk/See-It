import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ ok: true, jobType: "sync_sender" });
}

export const GET = POST;
