import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadRenderFixtures, runBenchmarkSuite } from "@/lib/render/evals";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const report = runBenchmarkSuite();
  const dataset = repository.createEvalDataset({
    name: String(body.datasetName ?? report.dataset),
    description: "Smoke benchmark fixture dataset",
    status: "active"
  });
  const fixtures = loadRenderFixtures();
  const cases = fixtures.map((fixture) => repository.createEvalCase({
    evalDatasetId: dataset.id,
    caseSlug: fixture.caseSlug,
    expectedJson: fixture as unknown as Record<string, unknown>,
    notes: fixture.humanReviewRequired ? "human_review_required" : undefined
  }));
  const run = repository.createEvalRun({
    evalDatasetId: dataset.id,
    name: String(body.name ?? "smoke benchmark"),
    renderRecipeVersionId: typeof body.renderRecipeVersionId === "string" ? body.renderRecipeVersionId : undefined,
    modelRoutePolicyId: typeof body.modelRoutePolicyId === "string" ? body.modelRoutePolicyId : undefined,
    status: "running",
    summaryJson: {},
    createdBy: "founder"
  });
  const results = report.results.map((result) => {
    const evalCase = cases.find((item) => item.caseSlug === result.caseSlug);
    return repository.createEvalResult({
      evalRunId: run.id,
      evalCaseId: evalCase?.id,
      automatedScoreJson: result.automatedScore as unknown as Record<string, unknown>,
      manualScoreJson: {},
      status: result.status as "pass" | "fail" | "review"
    });
  });
  const completed = repository.updateEvalRun(run.id, {
    status: report.gate ? "completed" : "failed",
    summaryJson: report,
    completedAt: new Date().toISOString()
  });
  repository.audit("founder", "run", "eval_run", run.id, undefined, { run: completed, results }, body.reason);
  return NextResponse.json({ dataset, run: completed, results, report });
}
