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
import { promptHash } from "@/lib/ai/prompt-hash";
import type { AiTaskType } from "@/lib/ai/types";
import { repository } from "@/lib/db/repository";
import { loadAiControlPlane, persistAiControlPlane, persistAuditLogs, persistEvalDataset, persistEvalResult, persistEvalRun, persistRenderBundle } from "@/lib/db/supabase-persistence";
import type { ModelStatus, PromptStatus, ProviderStatus, Surface } from "@/lib/db/schema";
import { runBenchmarkSuite } from "@/lib/render/evals";
import { createDurableReplay } from "@/lib/render/replay";

function jsonError(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

type AiRouteContext = { params: Promise<{ segments?: string[] }> };

async function resolveSegments(params: AiRouteContext["params"]) {
  const resolved = await params;
  return resolved.segments ?? [];
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown, fallback: string[] = []) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asProviderStatus(value: unknown, fallback: ProviderStatus = "disabled") {
  return value === "enabled" || value === "disabled" || value === "degraded" ? value : fallback;
}

function asModelStatus(value: unknown, fallback: ModelStatus = "testing") {
  return value === "enabled" || value === "disabled" || value === "deprecated" || value === "testing" ? value : fallback;
}

function asPromptStatus(value: unknown, fallback: PromptStatus = "draft") {
  return value === "draft" || value === "review" || value === "approved" || value === "active" || value === "archived" ? value : fallback;
}

function asSurface(value: unknown, fallback: Surface = "widget") {
  return value === "widget" || value === "admin" || value === "founder" || value === "demo" || value === "cron" || value === "system" ? value : fallback;
}

function asTaskType(value: unknown, fallback: AiTaskType = "render_composite") {
  const task = optionalString(value);
  return (task ?? fallback) as AiTaskType;
}

function activeRoutePolicyId(taskType: AiTaskType, surface: Surface) {
  const policy = [...repository.routePolicies.values()].find((item) => item.status === "active" && item.taskType === taskType && item.surface === surface);
  if (policy) {
    return policy.id;
  }
  return [...repository.routePolicies.values()].find((item) => item.status === "active" && item.taskType === taskType)?.id;
}

async function persistControlPlaneAndAudit() {
  await persistAiControlPlane();
  await persistAuditLogs();
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
    if (resource === "providers" && !id) {
      const providerKey = requiredString(body.providerKey, "providerKey");
      const current = [...repository.providers.values()].find((provider) => provider.providerKey === providerKey);
      const provider = repository.upsertProvider({
        providerKey,
        displayName: optionalString(body.displayName) ?? providerKey,
        adapterKey: optionalString(body.adapterKey) ?? providerKey,
        adapterVersion: optionalString(body.adapterVersion) ?? providerKey + "-manual-v1",
        status: asProviderStatus(body.status),
        secretRef: optionalString(body.secretRef),
        baseUrl: optionalString(body.baseUrl),
        docsUrl: optionalString(body.docsUrl),
        notes: optionalString(body.notes)
      });
      repository.audit("founder", current ? "upsert" : "create", "ai_provider", provider.id, current, provider, body.reason);
      await persistControlPlaneAndAudit();
      return NextResponse.json(provider);
    }
    if (resource === "models" && !id) {
      const providerKey = requiredString(body.providerKey, "providerKey");
      const provider = [...repository.providers.values()].find((item) => item.providerKey === providerKey);
      if (!provider) {
        return NextResponse.json({ error: "provider_not_found", providerKey }, { status: 404 });
      }
      const modelKey = requiredString(body.modelKey, "modelKey");
      const current = [...repository.models.values()].find((model) => model.providerKey === provider.providerKey && model.modelKey === modelKey && model.modelVersion === optionalString(body.modelVersion));
      const model = repository.upsertModel({
        providerId: provider.id,
        providerKey: provider.providerKey,
        modelKey,
        displayName: optionalString(body.displayName) ?? modelKey,
        modelVersion: optionalString(body.modelVersion),
        status: asModelStatus(body.status),
        capabilities: stringArray(body.capabilities),
        allowedTasks: stringArray(body.allowedTasks).map((task) => task as AiTaskType),
        defaultParams: recordValue(body.defaultParams),
        limits: recordValue(body.limits),
        pricing: recordValue(body.pricing),
        docsUrl: optionalString(body.docsUrl)
      });
      repository.audit("founder", current ? "upsert" : "create", "ai_model", model.id, current, model, body.reason);
      await persistControlPlaneAndAudit();
      return NextResponse.json(model);
    }
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
    if (resource === "bundles" && !id) {
      const bundle = repository.createBundle({
        name: optionalString(body.name) ?? "founder_bundle",
        surface: asSurface(body.surface),
        description: optionalString(body.description)
      });
      const promptVersionMap = recordValue(body.promptVersionMap);
      const version = Object.keys(promptVersionMap).length > 0
        ? repository.createBundleVersion({
            promptBundleId: bundle.id,
            version: Number(body.version ?? 1),
            status: asPromptStatus(body.status),
            promptVersionMap: Object.fromEntries(Object.entries(promptVersionMap).map(([key, value]) => [key, String(value)])),
            bundleHash: optionalString(body.bundleHash) ?? promptHash({ promptBundleId: bundle.id, promptVersionMap })
          })
        : undefined;
      repository.audit("founder", "create", "prompt_bundle", bundle.id, undefined, { bundle, version }, body.reason);
      await persistControlPlaneAndAudit();
      return NextResponse.json({ bundle, version });
    }
    if (resource === "bundle-versions" && action === "approve") {
      const current = repository.mustGet(repository.bundleVersions, id, "prompt_bundle_version");
      const next = { ...current, status: "approved" as const };
      repository.bundleVersions.set(id, next);
      repository.audit("founder", "approve", "prompt_bundle_version", id, current, next, body.reason);
      await persistControlPlaneAndAudit();
      return NextResponse.json(next);
    }
    if (resource === "recipes" && !id) {
      const surface = asSurface(body.surface);
      const kind = body.kind === "shopper" || body.kind === "lifestyle" || body.kind === "demo" || body.kind === "test" || body.kind === "replay" || body.kind === "eval" ? body.kind : "shopper";
      const recipe = repository.createRecipe({
        name: optionalString(body.name) ?? "founder_recipe",
        surface,
        kind,
        description: optionalString(body.description)
      });
      const promptBundleVersionId = optionalString(body.promptBundleVersionId);
      const taskType = asTaskType(body.taskType);
      const modelRoutePolicyId = optionalString(body.modelRoutePolicyId) ?? activeRoutePolicyId(taskType, surface);
      const version = promptBundleVersionId && modelRoutePolicyId
        ? repository.createRecipeVersion({
            renderRecipeId: recipe.id,
            version: Number(body.version ?? 1),
            status: asPromptStatus(body.status),
            promptBundleVersionId,
            modelRoutePolicyId,
            gatePolicy: recordValue(body.gatePolicy),
            retryPolicy: recordValue(body.retryPolicy),
            storagePolicy: recordValue(body.storagePolicy),
            outputPolicy: recordValue(body.outputPolicy),
            recipeHash: optionalString(body.recipeHash) ?? promptHash({ renderRecipeId: recipe.id, promptBundleVersionId, modelRoutePolicyId })
          })
        : undefined;
      repository.audit("founder", "create", "render_recipe", recipe.id, undefined, { recipe, version }, body.reason);
      await persistControlPlaneAndAudit();
      return NextResponse.json({ recipe, version });
    }
    if (resource === "recipe-versions" && action === "approve") {
      const current = repository.mustGet(repository.recipeVersions, id, "render_recipe_version");
      const next = { ...current, status: "approved" as const };
      repository.recipeVersions.set(id, next);
      repository.audit("founder", "approve", "render_recipe_version", id, current, next, body.reason);
      await persistControlPlaneAndAudit();
      return NextResponse.json(next);
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
    if (resource === "test-render" && !id) {
      const promptVersionId = optionalString(body.promptVersionId) ?? [...repository.promptVersions.values()][0]?.id;
      if (!promptVersionId) {
        return NextResponse.json({ error: "prompt_version_required" }, { status: 400 });
      }
      const result = await runOneOffPromptTest({
        promptVersionId,
        variables: {
          productTitle: "Founder test product",
          tapX: 0.5,
          tapY: 0.7,
          dimensionsText: "35 x 65 x 35 cm",
          ...recordValue(body.variables)
        },
        providerKey: optionalString(body.providerKey),
        modelKey: optionalString(body.modelKey),
        actor: "founder"
      });
      await persistAuditLogs();
      return NextResponse.json(result);
    }
    if (resource === "benchmark" && !id) {
      const report = runBenchmarkSuite();
      const dataset = repository.createEvalDataset({ name: report.dataset, status: "active", description: "Founder benchmark run from Prompt Control Center" });
      const run = repository.createEvalRun({
        evalDatasetId: dataset.id,
        name: optionalString(body.name) ?? "founder benchmark",
        status: report.gate ? "completed" : "failed",
        summaryJson: report,
        createdBy: "founder",
        completedAt: new Date().toISOString()
      });
      const results = report.results.map((result) => repository.createEvalResult({
        evalRunId: run.id,
        automatedScoreJson: result,
        manualScoreJson: {},
        status: result.status === "pass" ? "pass" : "fail"
      }));
      await persistEvalDataset(dataset);
      await persistEvalRun(run);
      for (const result of results) {
        await persistEvalResult(result);
      }
      return NextResponse.json({ dataset, run, report });
    }
    if (resource === "replay" && !id) {
      const sourceRenderRequestId = optionalString(body.renderRequestId) ?? optionalString(body.sourceRenderRequestId);
      if (!sourceRenderRequestId) {
        return NextResponse.json({ error: "renderRequestId is required" }, { status: 400 });
      }
      const replay = await createDurableReplay(sourceRenderRequestId, {
        modelKey: optionalString(body.modelKey),
        promptVersionId: optionalString(body.promptVersionId)
      });
      await persistRenderBundle(replay.id);
      return NextResponse.json(replay);
    }
    if (resource === "prompt-versions" && action === "test") {
      const result = await runOneOffPromptTest({ promptVersionId: id, variables: body.variables ?? {}, providerKey: body.providerKey, modelKey: body.modelKey, actor: "founder" });
      await persistAuditLogs();
      return NextResponse.json(result);
    }
    if (resource === "deployments" && !id) {
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
    if (resource === "providers") {
      const current = repository.mustGet(repository.providers, id, "ai_provider");
      const next = {
        ...current,
        displayName: optionalString(body.displayName) ?? current.displayName,
        adapterKey: optionalString(body.adapterKey) ?? current.adapterKey,
        adapterVersion: optionalString(body.adapterVersion) ?? current.adapterVersion,
        status: asProviderStatus(body.status, current.status),
        secretRef: optionalString(body.secretRef) ?? current.secretRef,
        baseUrl: optionalString(body.baseUrl) ?? current.baseUrl,
        docsUrl: optionalString(body.docsUrl) ?? current.docsUrl,
        notes: optionalString(body.notes) ?? current.notes
      };
      repository.providers.set(id, next);
      repository.audit("founder", "patch", "ai_provider", id, current, next, body.reason);
      await persistControlPlaneAndAudit();
      return NextResponse.json(next);
    }
    if (resource === "models") {
      const current = repository.mustGet(repository.models, id, "ai_model");
      const next = {
        ...current,
        displayName: optionalString(body.displayName) ?? current.displayName,
        modelVersion: optionalString(body.modelVersion) ?? current.modelVersion,
        status: asModelStatus(body.status, current.status),
        capabilities: Array.isArray(body.capabilities) ? stringArray(body.capabilities) : current.capabilities,
        allowedTasks: Array.isArray(body.allowedTasks) ? stringArray(body.allowedTasks).map((task) => task as AiTaskType) : current.allowedTasks,
        defaultParams: body.defaultParams ? recordValue(body.defaultParams) : current.defaultParams,
        limits: body.limits ? recordValue(body.limits) : current.limits,
        pricing: body.pricing ? recordValue(body.pricing) : current.pricing,
        docsUrl: optionalString(body.docsUrl) ?? current.docsUrl
      };
      repository.models.set(id, next);
      repository.audit("founder", "patch", "ai_model", id, current, next, body.reason);
      await persistControlPlaneAndAudit();
      return NextResponse.json(next);
    }
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
