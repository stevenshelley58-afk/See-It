import { NextResponse } from "next/server";
import { runBenchmarkSuite } from "@/lib/render/evals";

export async function GET() {
  return NextResponse.json(runBenchmarkSuite());
}
