import { sha256Text } from "@/lib/ai/prompt-hash";
import type { AiInvocationRequest, AiNormalizedResult, AiProviderAdapter, AiTaskType } from "@/lib/ai/types";
import type { AiModelRecord } from "@/lib/db/schema";

const SUPPORTED: AiTaskType[] = [
  "product_dimension_extract",
  "product_cutout",
  "room_analysis",
  "render_composite",
  "render_refine",
  "lifestyle_generate",
  "quality_gate",
  "prompt_eval",
  "caption",
  "personalization"
];

export const localAdapter: AiProviderAdapter = {
  providerKey: "local",
  adapterVersion: "local-deterministic-v1",
  supports(model: AiModelRecord, taskType: AiTaskType) {
    return model.providerKey === "local" && SUPPORTED.includes(taskType);
  },
  async invoke(request: AiInvocationRequest): Promise<AiNormalizedResult> {
    const started = Date.now();
    const digest = sha256Text(request.traceId + request.taskType + request.promptSnapshot.promptHash).slice(0, 16);
    if (request.params.providerSpecific?.forceProviderError === true) {
      return {
        ok: false,
        outputAssets: [],
        error: { code: "provider_timeout", message: "Forced provider error", retryable: true, providerStatus: 504 },
        providerResponseId: "local-forced-error-" + digest,
        finishReason: "error",
        usageJson: { local: true },
        costEstimateUsd: 0,
        rawResponseRedactedJson: { result: "forced-error" },
        latencyMs: Math.max(1, Date.now() - started)
      };
    }
    if (request.taskType === "quality_gate") {
      return {
        ok: true,
        outputAssets: [{ role: "json", json: { pass: true, score: 8.2, notes: "deterministic local gate" } }],
        providerResponseId: "local-gate-" + digest,
        finishReason: "stop",
        usageJson: { local: true },
        costEstimateUsd: 0,
        rawResponseRedactedJson: { result: "pass" },
        latencyMs: Math.max(1, Date.now() - started)
      };
    }
    return {
      ok: true,
      outputAssets: [{
        role: request.taskType === "caption" ? "text" : "image",
        storageKey: "renders/" + request.traceId + "/local-" + digest + ".png",
        text: request.taskType === "caption" ? "Generated product lifestyle caption" : undefined,
        mimeType: "image/png",
        width: 1200,
        height: 900,
        sha256: digest
      }],
      providerResponseId: "local-" + digest,
      finishReason: "stop",
      usageJson: { local: true },
      costEstimateUsd: 0,
      rawResponseRedactedJson: { id: "local-" + digest, deterministic: true },
      latencyMs: Math.max(1, Date.now() - started)
    };
  }
};
