import { estimateInvocationCost } from "@/lib/ai/cost";
import type { AiInvocationRequest, AiNormalizedResult, AiProviderAdapter, AiTaskType } from "@/lib/ai/types";
import type { AiModelRecord } from "@/lib/db/schema";

export const geminiAdapter: AiProviderAdapter = {
  providerKey: "gemini",
  adapterVersion: "gemini-image-docs-2026-06-v1",
  supports(model: AiModelRecord, taskType: AiTaskType) {
    return model.providerKey === "gemini" && model.allowedTasks.includes(taskType);
  },
  validateParams(params) {
    if (params.outputFormat && !["png", "jpg", "webp"].includes(params.outputFormat)) {
      throw new Error("Unsupported Gemini output format");
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
        storageKey: "renders/" + request.traceId + "/gemini-output.png",
        mimeType: "image/png",
        width: 1400,
        height: 1050,
        sha256: request.promptSnapshot.promptHash.slice(0, 32)
      }],
      providerResponseId: "gemini-simulated-" + request.idempotencyKey,
      finishReason: "stop",
      usageJson: { simulated: true, model: model.modelKey },
      costEstimateUsd: estimateInvocationCost(request, model),
      rawResponseRedactedJson: { provider: "gemini", model: model.modelKey, simulated: true },
      latencyMs: Math.max(1, Date.now() - started)
    };
  }
};
