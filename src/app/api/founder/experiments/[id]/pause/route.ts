import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadExperimentById, persistAudit, persistExperiment } from "@/lib/db/supabase-persistence";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const loaded = await loadExperimentById(id);
  if (!loaded) {
    return NextResponse.json({ error: "experiment_not_found" }, { status: 404 });
  }
  const current = repository.mustGet(repository.experiments, id, "ai_experiment");
  const next = repository.updateExperiment(id, { status: "paused", endAt: new Date().toISOString() });
  const audit = repository.audit("founder", "pause", "ai_experiment", id, current, next, body.reason);
  await persistExperiment(next);
  await persistAudit(audit);
  return NextResponse.json(next);
}
