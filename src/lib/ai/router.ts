import { estimateInvocationCost } from "@/lib/ai/cost";
import { getAdapter } from "@/lib/ai/registry";
import { redactSecrets } from "@/lib/ai/redaction";
import type { AiInvocationRequest, AiNormalizedResult } from "@/lib/ai/types";
import { repository } from "@/lib/db/repository";

export async function invokeAi(request: AiInvocationRequest): Promise<{ invocationId: string; result: AiNormalizedResult }> {
  const model = [...repository.models.values()].find((item) => item.providerKey === request.providerKey && item.modelKey === request.modelKey && (!request.modelVersion || item.modelVersion === request.modelVersion));
  if (!model) {
    throw new Error("AI model not found: " + request.providerKey + "/" + request.modelKey);
  }
  const provider = [...repository.providers.values()].find((item) => item.providerKey === request.providerKey);
  if (!provider) {
    throw new Error("AI provider not found: " + request.providerKey);
  }
  const adapter = getAdapter(request.providerKey);
  if (!adapter.supports(model, request.taskType)) {
    throw new Error("Adapter " + adapter.providerKey + " does not support " + model.modelKey + " for " + request.taskType);
  }
  adapter.validateParams?.(request.params, model);
  const created = repository.createAiInvocation({
    traceId: request.traceId,
    surface: request.surface,
    taskType: request.taskType,
    providerId: provider.id,
    aiModelId: model.id,
    adapterKey: provider.adapterKey,
    adapterVersion: adapter.adapterVersion,
    promptTemplateId: request.promptSnapshot.promptTemplateId,
    promptVersionId: request.promptSnapshot.promptVersionId,
    promptBundleVersionId: request.promptSnapshot.promptBundleVersionId,
    renderRecipeVersionId: request.promptSnapshot.renderRecipeVersionId,
    resolvedSystemInstruction: request.promptSnapshot.resolvedSystemInstruction,
    resolvedDeveloperInstruction: request.promptSnapshot.resolvedDeveloperInstruction,
    resolvedUserPrompt: request.promptSnapshot.resolvedUserPrompt,
    resolvedNegativePrompt: request.promptSnapshot.resolvedNegativePrompt,
    variablesJson: request.promptSnapshot.variablesJson,
    imageInputs: request.assets,
    params: request.params,
    requestJsonRedacted: redactSecrets(request),
    responseJsonRedacted: {},
    normalizedResult: {},
    safetyJson: {},
    usageJson: {},
    costEstimateUsd: estimateInvocationCost(request, model),
    status: "created",
    retryable: false,
    idempotencyKey: request.idempotencyKey
  });
  repository.trace({ traceId: request.traceId, aiInvocationId: created.id, eventName: "ai_invocation_created", eventLevel: "info", props: { provider: provider.providerKey, model: model.modelKey } });
  repository.updateAiInvocation(created.id, { status: "sent" });
  repository.trace({ traceId: request.traceId, aiInvocationId: created.id, eventName: "provider_request_sent", eventLevel: "info", props: { adapter: adapter.adapterVersion } });
  const result = await adapter.invoke(request, model);
  repository.trace({ traceId: request.traceId, aiInvocationId: created.id, eventName: "provider_response_received", eventLevel: result.ok ? "info" : "error", props: { ok: result.ok, errorCode: result.error?.code } });
  repository.updateAiInvocation(created.id, {
    status: result.ok ? "succeeded" : "failed",
    responseJsonRedacted: redactSecrets(result.rawResponseRedactedJson ?? result),
    normalizedResult: result,
    providerResponseId: result.providerResponseId,
    finishReason: result.finishReason,
    safetyJson: result.safetyJson ?? {},
    usageJson: result.usageJson ?? {},
    costEstimateUsd: result.costEstimateUsd,
    latencyMs: result.latencyMs,
    errorCode: result.error?.code,
    errorMessage: result.error?.message,
    retryable: Boolean(result.error?.retryable),
    completedAt: new Date().toISOString()
  });
  return { invocationId: created.id, result };
}
