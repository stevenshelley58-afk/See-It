import { NextResponse } from "next/server";
import { createDurableReplay } from "@/lib/render/replay";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await createDurableReplay(id));
}
