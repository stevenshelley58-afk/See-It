import { estimateInvocationCost } from "@/lib/ai/cost";
import type { AiInvocationRequest, AiNormalizedResult, AiProviderAdapter, AiTaskType } from "@/lib/ai/types";
import type { AiModelRecord } from "@/lib/db/schema";

export const openaiAdapter: AiProviderAdapter = {
  providerKey: "openai",
  adapterVersion: "openai-image-docs-2026-06-v1",
  supports(model: AiModelRecord, taskType: AiTaskType) {
    return model.providerKey === "openai" && model.allowedTasks.includes(taskType);
  },
  validateParams(params, model) {
    const providerSpecific = params.providerSpecific ?? {};
    if (model.modelKey === "gpt-image-2" && Object.hasOwn(providerSpecific, "input_fidelity")) {
      throw new Error("input_fidelity must be omitted for gpt-image-2");
    }
  },
  async estimateCost(request: AiInvocationRequest, model: AiModelRecord) {
    return estimateInvocationCost(request, model);
  },
  async invoke(request: AiInvocationRequest, model: AiModelRecord): Promise<AiNormalizedResult> {
    const started = Date.now();
    return {
      ok: true,
      outputAssets: [{
        role: "image",
        storageKey: "renders/" + request.traceId + "/openai-output.png",
        mimeType: "image/png",
        width: 1536,
        height: 1024,
        sha256: request.promptSnapshot.promptHash.slice(0, 32)
      }],
      providerResponseId: "openai-simulated-" + request.idempotencyKey,
      finishReason: "stop",
      usageJson: { simulated: true, model: model.modelKey },
      costEstimateUsd: estimateInvocationCost(request, model),
      rawResponseRedactedJson: { provider: "openai", model: model.modelKey, simulated: true },
      latencyMs: Math.max(1, Date.now() - started)
    };
  }
};
