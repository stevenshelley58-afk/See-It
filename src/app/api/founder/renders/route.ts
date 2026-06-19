import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function GET() {
  return NextResponse.json({ renders: [...repository.renderRequests.values()] });
}
