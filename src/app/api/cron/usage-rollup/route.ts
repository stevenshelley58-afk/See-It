import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ ok: true, jobType: "usage_rollup" });
}

export const GET = POST;
