import { estimateInvocationCost } from "@/lib/ai/cost";
import type { AiInvocationRequest, AiNormalizedResult, AiProviderAdapter, AiTaskType } from "@/lib/ai/types";
import type { AiModelRecord } from "@/lib/db/schema";
import { readEnv } from "@/lib/env";
import { uploadGeneratedBase64Asset } from "@/lib/storage/generated-assets";

function simulatedOpenAiResult(request: AiInvocationRequest, model: AiModelRecord, started: number): AiNormalizedResult {
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

function promptText(request: AiInvocationRequest) {
  return [
    request.promptSnapshot.resolvedSystemInstruction,
    request.promptSnapshot.resolvedDeveloperInstruction,
    request.promptSnapshot.resolvedUserPrompt,
    request.promptSnapshot.resolvedNegativePrompt ? "Avoid: " + request.promptSnapshot.resolvedNegativePrompt : undefined
  ].filter(Boolean).join("\n\n");
}

async function responseImageBase64(item: Record<string, unknown>) {
  if (typeof item.b64_json === "string") {
    return item.b64_json;
  }
  if (typeof item.url === "string") {
    const response = await fetch(item.url);
    if (!response.ok) {
      throw new Error("openai_image_url_fetch_failed:" + response.status);
    }
    return Buffer.from(await response.arrayBuffer()).toString("base64");
  }
  return undefined;
}

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
    let env: ReturnType<typeof readEnv> | undefined;
    try {
      env = readEnv();
    } catch {
      return simulatedOpenAiResult(request, model, started);
    }
    if (env.APP_ENV === "test" || !env.OPENAI_API_KEY) {
      return simulatedOpenAiResult(request, model, started);
    }
    const payload = {
      model: model.modelKey,
      prompt: promptText(request),
      n: 1,
      size: String(request.params.size ?? model.defaultParams.size ?? "1536x1024"),
      output_format: request.params.outputFormat ?? model.defaultParams.outputFormat ?? "png"
    };
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        outputAssets: [],
        rawResponseRedactedJson: { provider: "openai", status: response.status, body },
        error: {
          code: response.status >= 500 || response.status === 429 ? "provider_retryable_error" : "provider_bad_response",
          message: typeof body.error === "object" ? "OpenAI image request failed" : response.statusText,
          retryable: response.status >= 500 || response.status === 429,
          providerStatus: response.status
        },
        latencyMs: Math.max(1, Date.now() - started)
      };
    }
    const data = Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
    const imageBase64 = data[0] ? await responseImageBase64(data[0]) : undefined;
    if (!imageBase64) {
      return {
        ok: false,
        outputAssets: [],
        rawResponseRedactedJson: { provider: "openai", status: response.status, body: { ...body, data: "[redacted]" } },
        error: { code: "provider_bad_response", message: "OpenAI response did not include image data", retryable: true, providerStatus: response.status },
        latencyMs: Math.max(1, Date.now() - started)
      };
    }
    const storageKey = "renders/" + request.traceId + "/openai-output.png";
    const stored = await uploadGeneratedBase64Asset("renders", storageKey, imageBase64, "image/png", env);
    return {
      ok: true,
      outputAssets: [{
        role: "image",
        storageKey,
        mimeType: "image/png",
        sha256: stored.sha256,
        bytes: stored.bytes
      }],
      providerResponseId: typeof body.id === "string" ? body.id : "openai-" + request.idempotencyKey,
      finishReason: "stop",
      usageJson: body.usage,
      costEstimateUsd: estimateInvocationCost(request, model),
      rawResponseRedactedJson: { provider: "openai", model: model.modelKey, created: body.created, usage: body.usage, data: "[image redacted]" },
      latencyMs: Math.max(1, Date.now() - started)
    };
  }
};
