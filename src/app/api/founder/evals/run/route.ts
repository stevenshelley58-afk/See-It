import { NextResponse } from "next/server";
import { runBenchmarkSuite } from "@/lib/render/evals";

export async function POST() {
  return NextResponse.json(runBenchmarkSuite());
}
