import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadExperimentById, persistAudit, persistExperiment } from "@/lib/db/supabase-persistence";
import type { AiExperimentRecord } from "@/lib/db/schema";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const loaded = await loadExperimentById(id);
  if (!loaded) {
    return NextResponse.json({ error: "experiment_not_found" }, { status: 404 });
  }
  const current = repository.mustGet(repository.experiments, id, "ai_experiment");
  const next = repository.updateExperiment(id, {
    name: typeof body.name === "string" ? body.name : current.name,
    type: typeof body.type === "string" ? body.type as AiExperimentRecord["type"] : current.type,
    surface: typeof body.surface === "string" ? body.surface as AiExperimentRecord["surface"] : current.surface,
    status: typeof body.status === "string" ? body.status as AiExperimentRecord["status"] : current.status,
    startAt: typeof body.startAt === "string" ? body.startAt : current.startAt,
    endAt: typeof body.endAt === "string" ? body.endAt : current.endAt,
    trafficPercent: body.trafficPercent === undefined ? current.trafficPercent : Number(body.trafficPercent),
    successMetric: typeof body.successMetric === "string" ? body.successMetric : current.successMetric,
    guardrailJson: typeof body.guardrailJson === "object" && body.guardrailJson ? body.guardrailJson as Record<string, unknown> : current.guardrailJson
  });
  const audit = repository.audit("founder", "update", "ai_experiment", id, current, next, body.reason);
  await persistExperiment(next);
  await persistAudit(audit);
  return NextResponse.json(next);
}
