import type { AiTaskType } from "@/lib/ai/types";
import { compilePrompt, diffPromptVersions } from "@/lib/ai/prompt-compiler";
import { promptHash } from "@/lib/ai/prompt-hash";
import { invokeAi } from "@/lib/ai/router";
import { repository } from "@/lib/db/repository";
import type { PromptStatus, PromptVersionRecord, Surface } from "@/lib/db/schema";

type PromptDraftInput = {
  promptTemplateId: string;
  createdBy: string;
  systemInstruction?: string;
  developerInstruction?: string;
  userPromptTemplate: string;
  negativePromptTemplate?: string;
  variablesSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  allowedAssetRoles?: string[];
  requiredAssetOrder?: string[];
  defaultParams?: Record<string, unknown>;
  notes?: string;
};

function nextPromptVersion(promptTemplateId: string) {
  const versions = [...repository.promptVersions.values()].filter((version) => version.promptTemplateId === promptTemplateId);
  return versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
}

function versionHash(input: Pick<PromptVersionRecord, "promptTemplateId" | "version" | "systemInstruction" | "developerInstruction" | "userPromptTemplate" | "negativePromptTemplate" | "variablesSchema" | "defaultParams">) {
  return promptHash({
    promptTemplateId: input.promptTemplateId,
    version: input.version,
    systemInstruction: input.systemInstruction,
    developerInstruction: input.developerInstruction,
    userPromptTemplate: input.userPromptTemplate,
    negativePromptTemplate: input.negativePromptTemplate,
    variablesSchema: input.variablesSchema,
    defaultParams: input.defaultParams
  });
}

export function createPromptDraft(input: PromptDraftInput) {
  const template = repository.mustGet(repository.promptTemplates, input.promptTemplateId, "prompt_template");
  const record = repository.createPromptVersion({
    promptTemplateId: template.id,
    version: nextPromptVersion(template.id),
    status: "draft",
    systemInstruction: input.systemInstruction,
    developerInstruction: input.developerInstruction,
    userPromptTemplate: input.userPromptTemplate,
    negativePromptTemplate: input.negativePromptTemplate,
    variablesSchema: input.variablesSchema ?? {},
    outputSchema: input.outputSchema ?? {},
    allowedAssetRoles: input.allowedAssetRoles ?? [],
    requiredAssetOrder: input.requiredAssetOrder ?? [],
    defaultParams: input.defaultParams ?? {},
    promptHash: "",
    notes: input.notes,
    createdBy: input.createdBy
  });
  const next = repository.updatePromptVersion(record.id, { promptHash: versionHash(record) });
  repository.audit(input.createdBy, "create_draft", "prompt_version", next.id, undefined, next, input.notes);
  return next;
}

export function editPromptDraft(promptVersionId: string, patch: Partial<Omit<PromptVersionRecord, "id" | "promptTemplateId" | "version" | "approvedAt" | "approvedBy">>, actor = "founder") {
  const current = repository.mustGet(repository.promptVersions, promptVersionId, "prompt_version");
  if (!["draft", "review"].includes(current.status)) {
    throw new Error("Only draft or review prompt versions can be edited");
  }
  const nextCandidate = { ...current, ...patch, approvedAt: undefined, approvedBy: undefined };
  const next = repository.updatePromptVersion(promptVersionId, { ...patch, approvedAt: undefined, approvedBy: undefined, promptHash: versionHash(nextCandidate) });
  repository.audit(actor, "edit_draft", "prompt_version", promptVersionId, current, next, "prompt draft edit");
  return next;
}

export function clonePromptVersion(promptVersionId: string, actor = "founder", patch: Partial<PromptDraftInput> = {}) {
  const source = repository.mustGet(repository.promptVersions, promptVersionId, "prompt_version");
  const clone = createPromptDraft({
    promptTemplateId: source.promptTemplateId,
    createdBy: actor,
    systemInstruction: patch.systemInstruction ?? source.systemInstruction,
    developerInstruction: patch.developerInstruction ?? source.developerInstruction,
    userPromptTemplate: patch.userPromptTemplate ?? source.userPromptTemplate,
    negativePromptTemplate: patch.negativePromptTemplate ?? source.negativePromptTemplate,
    variablesSchema: patch.variablesSchema ?? source.variablesSchema,
    outputSchema: patch.outputSchema ?? source.outputSchema,
    allowedAssetRoles: patch.allowedAssetRoles ?? source.allowedAssetRoles,
    requiredAssetOrder: patch.requiredAssetOrder ?? source.requiredAssetOrder,
    defaultParams: patch.defaultParams ?? source.defaultParams,
    notes: patch.notes ?? "cloned from " + source.id
  });
  repository.audit(actor, "clone", "prompt_version", clone.id, source, clone, "prompt clone");
  return clone;
}

export function setPromptVersionStatus(promptVersionId: string, status: PromptStatus, actor = "founder", reason?: string) {
  const current = repository.mustGet(repository.promptVersions, promptVersionId, "prompt_version");
  const patch: Partial<PromptVersionRecord> = { status };
  if (status === "approved") {
    patch.approvedBy = actor;
    patch.approvedAt = new Date().toISOString();
  }
  if (status === "archived") {
    patch.approvedBy = undefined;
    patch.approvedAt = undefined;
  }
  const next = repository.updatePromptVersion(promptVersionId, patch);
  repository.audit(actor, "set_status:" + status, "prompt_version", promptVersionId, current, next, reason);
  return next;
}

export function previewPromptVersion(promptVersionId: string, variables: Record<string, unknown>) {
  const version = repository.mustGet(repository.promptVersions, promptVersionId, "prompt_version");
  return compilePrompt(version, variables);
}

export function diffPromptVersionIds(fromPromptVersionId: string, toPromptVersionId: string) {
  const from = repository.mustGet(repository.promptVersions, fromPromptVersionId, "prompt_version");
  const to = repository.mustGet(repository.promptVersions, toPromptVersionId, "prompt_version");
  return diffPromptVersions(from, to);
}

export function activatePromptDeployment(input: { surface: Surface; taskType: AiTaskType; renderRecipeVersionId: string; trafficPercent?: number; actor?: string; reason?: string }) {
  const actor = input.actor ?? "founder";
  const recipeVersion = repository.mustGet(repository.recipeVersions, input.renderRecipeVersionId, "render_recipe_version");
  if (!["approved", "active"].includes(recipeVersion.status)) {
    throw new Error("Only approved or active recipe versions can be deployed");
  }
  const bundleVersion = repository.mustGet(repository.bundleVersions, recipeVersion.promptBundleVersionId, "prompt_bundle_version");
  if (!["approved", "active"].includes(bundleVersion.status)) {
    throw new Error("Only approved or active prompt bundles can be deployed");
  }
  for (const promptVersionId of Object.values(bundleVersion.promptVersionMap)) {
    const promptVersion = repository.mustGet(repository.promptVersions, promptVersionId, "prompt_version");
    if (!["approved", "active"].includes(promptVersion.status)) {
      throw new Error("Prompt version is not approved for production: " + promptVersionId);
    }
  }
  for (const current of repository.deployments.values()) {
    if (current.status === "active" && current.surface === input.surface && current.taskType === input.taskType) {
      repository.rollbackDeployment(current.id, actor, "replaced by deployment activation");
    }
  }
  const deployment = repository.createDeployment({
    surface: input.surface,
    taskType: input.taskType,
    renderRecipeVersionId: input.renderRecipeVersionId,
    status: "active",
    trafficPercent: input.trafficPercent ?? 100,
    createdBy: actor,
    reason: input.reason ?? "activation"
  });
  repository.audit(actor, "activate", "prompt_deployment", deployment.id, undefined, deployment, input.reason);
  return deployment;
}

export function blockPromptVersionFromProduction(promptVersionId: string, actor = "founder", reason = "blocked from production") {
  const affectedDeployments = [];
  for (const deployment of repository.deployments.values()) {
    if (deployment.status !== "active") {
      continue;
    }
    const recipeVersion = repository.recipeVersions.get(deployment.renderRecipeVersionId);
    const bundleVersion = recipeVersion ? repository.bundleVersions.get(recipeVersion.promptBundleVersionId) : undefined;
    if (bundleVersion && Object.values(bundleVersion.promptVersionMap).includes(promptVersionId)) {
      affectedDeployments.push(repository.rollbackDeployment(deployment.id, actor, reason));
    }
  }
  const promptVersion = setPromptVersionStatus(promptVersionId, "archived", actor, reason);
  return { promptVersion, affectedDeployments };
}

export async function runOneOffPromptTest(input: { promptVersionId: string; variables: Record<string, unknown>; providerKey?: string; modelKey?: string; actor?: string }) {
  const compiled = previewPromptVersion(input.promptVersionId, input.variables);
  const providerKey = input.providerKey ?? "local";
  const modelKey = input.modelKey ?? "local-deterministic-image";
  const result = await invokeAi({
    traceId: "prompt_test_" + crypto.randomUUID(),
    surface: "founder",
    taskType: "prompt_eval",
    providerKey,
    modelKey,
    promptSnapshot: compiled,
    assets: [],
    params: {},
    idempotencyKey: "prompt-test:" + input.promptVersionId + ":" + promptHash({ variables: input.variables, providerKey, modelKey })
  });
  repository.audit(input.actor ?? "founder", "test", "prompt_version", input.promptVersionId, undefined, result.invocationId, "one-off prompt test");
  return result;
}
