import { estimateInvocationCost } from "@/lib/ai/cost";
import type { AiInvocationRequest, AiNormalizedResult, AiProviderAdapter, AiTaskType } from "@/lib/ai/types";
import type { AiModelRecord } from "@/lib/db/schema";

export const customHttpAdapter: AiProviderAdapter = {
  providerKey: "custom-http",
  adapterVersion: "custom-http-v1",
  supports(model: AiModelRecord, taskType: AiTaskType) {
    return model.providerKey === "custom-http" && model.allowedTasks.includes(taskType);
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
        storageKey: "renders/" + request.traceId + "/custom-http-output.png",
        mimeType: "image/png",
        width: 1200,
        height: 1200,
        sha256: request.promptSnapshot.promptHash.slice(0, 32)
      }],
      providerResponseId: "custom-http-simulated-" + request.idempotencyKey,
      finishReason: "stop",
      usageJson: { simulated: true },
      costEstimateUsd: estimateInvocationCost(request, model),
      rawResponseRedactedJson: { provider: "custom-http", simulated: true },
      latencyMs: Math.max(1, Date.now() - started)
    };
  }
};
