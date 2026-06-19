import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json(repository.renderBundleForRequest(params.id));
}
