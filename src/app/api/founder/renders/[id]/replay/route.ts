import { NextResponse } from "next/server";
import { createReplay } from "@/lib/render/replay";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json(createReplay(params.id));
}
