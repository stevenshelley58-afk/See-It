import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadExperimentById, persistAudit, persistExperiment, persistExperimentArm } from "@/lib/db/supabase-persistence";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const loaded = await loadExperimentById(id);
  if (!loaded) {
    return NextResponse.json({ error: "experiment_not_found" }, { status: 404 });
  }
  const current = repository.mustGet(repository.experiments, id, "ai_experiment");
  const arms = [...repository.experimentArms.values()].filter((arm) => arm.experimentId === id);
  const winningArm = arms.find((arm) => arm.id === body.armId) ?? arms.find((arm) => arm.status === "active") ?? arms[0];
  if (!winningArm) {
    return NextResponse.json({ error: "experiment_has_no_arms" }, { status: 400 });
  }
  for (const arm of arms) {
    repository.experimentArms.set(arm.id, { ...arm, status: arm.id === winningArm.id ? "active" : "archived" });
  }
  const next = repository.updateExperiment(id, { status: "completed", endAt: new Date().toISOString(), trafficPercent: 0 });
  const nextArms = [...repository.experimentArms.values()].filter((arm) => arm.experimentId === id);
  const audit = repository.audit("founder", "promote_winner", "ai_experiment", id, current, { experiment: next, winningArmId: winningArm.id }, body.reason);
  await persistExperiment(next);
  for (const arm of nextArms) {
    await persistExperimentArm(arm);
  }
  await persistAudit(audit);
  return NextResponse.json({ experiment: next, winningArm: repository.experimentArms.get(winningArm.id), arms: nextArms });
}
