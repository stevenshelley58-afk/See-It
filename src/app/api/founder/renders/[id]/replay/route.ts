import { NextResponse } from "next/server";
import { createDurableReplay } from "@/lib/render/replay";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json(await createDurableReplay(params.id));
}
