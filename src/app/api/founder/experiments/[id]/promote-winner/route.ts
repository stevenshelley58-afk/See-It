import { NextResponse } from "next/server";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ id: params.id, action: "promote_winner", ok: true });
}
