import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const run = repository.evalRuns.get(params.id);
  if (!run) {
    return NextResponse.json({ error: "eval_run_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    run,
    dataset: repository.evalDatasets.get(run.evalDatasetId),
    results: [...repository.evalResults.values()].filter((result) => result.evalRunId === run.id)
  });
}
