import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const current = repository.mustGet(repository.experiments, params.id, "ai_experiment");
  const arms = [...repository.experimentArms.values()].filter((arm) => arm.experimentId === params.id);
  const winningArm = arms.find((arm) => arm.id === body.armId) ?? arms.find((arm) => arm.status === "active") ?? arms[0];
  if (!winningArm) {
    return NextResponse.json({ error: "experiment_has_no_arms" }, { status: 400 });
  }
  for (const arm of arms) {
    repository.experimentArms.set(arm.id, { ...arm, status: arm.id === winningArm.id ? "active" : "archived" });
  }
  const next = repository.updateExperiment(params.id, { status: "completed", endAt: new Date().toISOString(), trafficPercent: 0 });
  repository.audit("founder", "promote_winner", "ai_experiment", params.id, current, { experiment: next, winningArmId: winningArm.id }, body.reason);
  return NextResponse.json({ experiment: next, winningArm: repository.experimentArms.get(winningArm.id), arms: [...repository.experimentArms.values()].filter((arm) => arm.experimentId === params.id) });
}
