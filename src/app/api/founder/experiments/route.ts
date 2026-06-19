import { NextRequest, NextResponse } from "next/server";
import { deterministicAssignment } from "@/lib/experiments/assignment";
import { repository } from "@/lib/db/repository";
import { persistAudit, persistExperiment, persistExperimentArm, persistExperimentAssignment } from "@/lib/db/supabase-persistence";
import type { AiExperimentRecord, Surface } from "@/lib/db/schema";

export async function GET() {
  return NextResponse.json({
    experiments: [...repository.experiments.values()],
    arms: [...repository.experimentArms.values()],
    assignments: [...repository.experimentAssignments.values()]
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const experiment = repository.createExperiment({
    name: String(body.name ?? "Founder experiment"),
    type: String(body.type ?? "model_test") as AiExperimentRecord["type"],
    surface: String(body.surface ?? "widget") as Surface,
    status: String(body.status ?? "draft") as AiExperimentRecord["status"],
    startAt: body.startAt,
    endAt: body.endAt,
    trafficPercent: Number(body.trafficPercent ?? 0),
    successMetric: body.successMetric,
    guardrailJson: body.guardrailJson ?? {},
    createdBy: "founder"
  });
  const armInputs = Array.isArray(body.arms) && body.arms.length > 0
    ? body.arms
    : [
        { name: "control", trafficWeight: 50 },
        { name: "variant", trafficWeight: 50 }
      ];
  const arms = armInputs.map((arm: Record<string, unknown>) => repository.createExperimentArm({
    experimentId: experiment.id,
    name: String(arm.name ?? "arm"),
    renderRecipeVersionId: typeof arm.renderRecipeVersionId === "string" ? arm.renderRecipeVersionId : undefined,
    aiModelId: typeof arm.aiModelId === "string" ? arm.aiModelId : undefined,
    promptBundleVersionId: typeof arm.promptBundleVersionId === "string" ? arm.promptBundleVersionId : undefined,
    paramsOverrideJson: typeof arm.paramsOverrideJson === "object" && arm.paramsOverrideJson ? arm.paramsOverrideJson as Record<string, unknown> : {},
    trafficWeight: Number(arm.trafficWeight ?? 0),
    status: String(arm.status ?? "active") as "active" | "paused" | "archived"
  }));
  const assignmentKey = typeof body.assignmentKey === "string" ? body.assignmentKey : undefined;
  const assignedArmId = assignmentKey
    ? deterministicAssignment(assignmentKey, arms.map((arm: { id: string; trafficWeight: number }) => ({ id: arm.id, trafficWeight: arm.trafficWeight })))
    : undefined;
  const assignment = assignmentKey && assignedArmId
    ? repository.assignExperiment({ experimentId: experiment.id, armId: assignedArmId, assignmentKey, renderRequestId: body.renderRequestId })
    : undefined;
  const audit = repository.audit("founder", "create", "ai_experiment", experiment.id, undefined, { experiment, arms, assignment }, body.reason);
  await persistExperiment(experiment);
  for (const arm of arms) {
    await persistExperimentArm(arm);
  }
  if (assignment) {
    await persistExperimentAssignment(assignment);
  }
  await persistAudit(audit);
  return NextResponse.json({ experiment, arms, assignment });
}
