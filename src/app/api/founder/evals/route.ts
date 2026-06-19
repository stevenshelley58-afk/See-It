import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function GET() {
  return NextResponse.json({
    datasets: [...repository.evalDatasets.values()],
    cases: [...repository.evalCases.values()],
    runs: [...repository.evalRuns.values()],
    results: [...repository.evalResults.values()]
  });
}
