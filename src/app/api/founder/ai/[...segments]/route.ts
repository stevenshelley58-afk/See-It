import { NextRequest, NextResponse } from "next/server";
import {
  activatePromptDeployment,
  blockPromptVersionFromProduction,
  clonePromptVersion,
  createPromptDraft,
  diffPromptVersionIds,
  editPromptDraft,
  previewPromptVersion,
  runOneOffPromptTest,
  setPromptVersionStatus
} from "@/lib/ai/prompt-control";
import { ensureAiRegistrySeeded, listModels, listProviders } from "@/lib/ai/registry";
import type { AiTaskType } from "@/lib/ai/types";
import { repository } from "@/lib/db/repository";
import { loadAiControlPlane, persistAiControlPlane, persistAuditLogs } from "@/lib/db/supabase-persistence";
import type { Surface } from "@/lib/db/schema";

function jsonError(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

type AiRouteContext = { params: Promise<{ segments?: string[] }> };

async function resolveSegments(params: AiRouteContext["params"]) {
  const resolved = await params;
  return resolved.segments ?? [];
}

export async function GET(_request: NextRequest, { params }: AiRouteContext) {
  await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const segments = await resolveSegments(params);
  const [resource, id] = segments;
  if (resource === "providers") return NextResponse.json({ providers: listProviders() });
  if (resource === "models") return NextResponse.json({ models: listModels() });
  if (resource === "prompts" && id) {
    return NextResponse.json({
      template: repository.promptTemplates.get(id),
      versions: [...repository.promptVersions.values()].filter((version) => version.promptTemplateId === id)
    });
  }
  if (resource === "prompts") return NextResponse.json({ templates: [...repository.promptTemplates.values()], versions: [...repository.promptVersions.values()] });
  if (resource === "bundles") return NextResponse.json({ bundles: [...repository.bundles.values()], versions: [...repository.bundleVersions.values()] });
  if (resource === "recipes") return NextResponse.json({ recipes: [...repository.recipes.values()], versions: [...repository.recipeVersions.values()] });
  if (resource === "deployments") return NextResponse.json({ deployments: [...repository.deployments.values()] });
  return NextResponse.json({ error: "unknown_founder_ai_resource", resource, segments }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: AiRouteContext) {
  await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const body = await request.json().catch(() => ({}));
  const segments = await resolveSegments(params);
  const [resource, id, action] = segments;
  try {
    if (resource === "prompts" && !id) {
      const template = body.promptTemplateId
        ? repository.mustGet(repository.promptTemplates, String(body.promptTemplateId), "prompt_template")
        : repository.createPromptTemplate({
            name: String(body.name ?? "founder_prompt"),
            taskType: String(body.taskType ?? "render_composite") as AiTaskType,
            surface: String(body.surface ?? "widget") as Surface,
            description: body.description
          });
      const draft = createPromptDraft({ ...body, promptTemplateId: template.id, createdBy: "founder" });
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(draft);
    }
    if (resource === "prompts" && action === "versions") {
      const draft = createPromptDraft({ ...body, promptTemplateId: id, createdBy: "founder" });
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(draft);
    }
    if (resource === "prompt-versions" && action === "approve") {
      const next = setPromptVersionStatus(id, "approved", "founder", body.reason);
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(next);
    }
    if (resource === "prompt-versions" && action === "archive") {
      const next = setPromptVersionStatus(id, "archived", "founder", body.reason);
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(next);
    }
    if (resource === "prompt-versions" && action === "clone") {
      const clone = clonePromptVersion(id, "founder", body);
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(clone);
    }
    if (resource === "prompt-versions" && action === "preview") {
      return NextResponse.json(previewPromptVersion(id, body.variables ?? {}));
    }
    if (resource === "prompt-versions" && action === "diff") {
      return NextResponse.json(diffPromptVersionIds(id, String(body.toPromptVersionId)));
    }
    if (resource === "prompt-versions" && action === "block") {
      const blocked = blockPromptVersionFromProduction(id, "founder", String(body.reason ?? "blocked from production"));
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(blocked);
    }
    if (resource === "prompt-versions" && action === "test") {
      const result = await runOneOffPromptTest({ promptVersionId: id, variables: body.variables ?? {}, providerKey: body.providerKey, modelKey: body.modelKey, actor: "founder" });
      await persistAuditLogs();
      return NextResponse.json(result);
    }
    if (resource === "deployments" && id === "activate") {
      const deployment = activatePromptDeployment({
        surface: String(body.surface ?? "widget") as Surface,
        taskType: String(body.taskType ?? "render_composite") as AiTaskType,
        renderRecipeVersionId: String(body.renderRecipeVersionId),
        trafficPercent: body.trafficPercent,
        actor: "founder",
        reason: body.reason
      });
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(deployment);
    }
    if (resource === "deployments" && action === "rollback") {
      const deployment = repository.rollbackDeployment(id, "founder", String(body.reason ?? "manual rollback"));
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(deployment);
    }
    if (resource === "deployments" && action === "pause") {
      const current = repository.mustGet(repository.deployments, id, "prompt_deployment");
      const next = { ...current, status: "paused" as const, endedAt: new Date().toISOString() };
      repository.deployments.set(id, next);
      repository.audit("founder", "pause", "prompt_deployment", id, current, next, body.reason);
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(next);
    }
    return NextResponse.json({ error: "unknown_founder_ai_action", resource, id, action }, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: AiRouteContext) {
  await loadAiControlPlane();
  ensureAiRegistrySeeded();
  const body = await request.json().catch(() => ({}));
  const segments = await resolveSegments(params);
  const [resource, id] = segments;
  try {
    if (resource === "prompt-versions") {
      const next = editPromptDraft(id, body, "founder");
      await persistAiControlPlane();
      await persistAuditLogs();
      return NextResponse.json(next);
    }
    repository.audit("founder", "api_patch", segments.join("/"), undefined, undefined, body, "founder api");
    return NextResponse.json({ error: "unknown_founder_ai_patch", resource, id }, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}
