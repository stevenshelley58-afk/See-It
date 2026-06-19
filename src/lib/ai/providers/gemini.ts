import { estimateInvocationCost } from "@/lib/ai/cost";
import type { AiInvocationRequest, AiNormalizedResult, AiProviderAdapter, AiTaskType } from "@/lib/ai/types";
import type { AiModelRecord } from "@/lib/db/schema";
import { readEnv } from "@/lib/env";
import { uploadGeneratedBase64Asset } from "@/lib/storage/generated-assets";

function simulatedGeminiResult(request: AiInvocationRequest, model: AiModelRecord, started: number): AiNormalizedResult {
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

function promptText(request: AiInvocationRequest) {
  return [
    request.promptSnapshot.resolvedSystemInstruction,
    request.promptSnapshot.resolvedDeveloperInstruction,
    request.promptSnapshot.resolvedUserPrompt,
    request.promptSnapshot.resolvedNegativePrompt ? "Avoid: " + request.promptSnapshot.resolvedNegativePrompt : undefined
  ].filter(Boolean).join("\n\n");
}

function findGeminiImagePart(body: Record<string, unknown>) {
  const candidates = Array.isArray(body.candidates) ? body.candidates as Record<string, unknown>[] : [];
  const content = candidates[0]?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts as Record<string, unknown>[] : [];
  for (const part of parts) {
    const inlineData = part.inlineData as Record<string, unknown> | undefined;
    if (inlineData && typeof inlineData.data === "string") {
      return {
        base64: inlineData.data,
        mimeType: typeof inlineData.mimeType === "string" ? inlineData.mimeType : "image/png"
      };
    }
  }
  return undefined;
}

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
    let env: ReturnType<typeof readEnv> | undefined;
    try {
      env = readEnv();
    } catch {
      return simulatedGeminiResult(request, model, started);
    }
    if (env.APP_ENV === "test" || !env.GEMINI_API_KEY) {
      return simulatedGeminiResult(request, model, started);
    }
    const generationConfig: Record<string, unknown> = {
      responseModalities: ["Image"]
    };
    if (request.params.aspectRatio || request.params.size) {
      generationConfig.responseFormat = {
        image: {
          aspectRatio: request.params.aspectRatio,
          imageSize: request.params.size
        }
      };
    }
    const response = await fetch("https://generativelanguage.googleapis.com/v1/models/" + model.modelKey + ":generateContent", {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText(request) }] }],
        generationConfig
      })
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        outputAssets: [],
        rawResponseRedactedJson: { provider: "gemini", status: response.status, body },
        error: {
          code: response.status >= 500 || response.status === 429 ? "provider_retryable_error" : "provider_bad_response",
          message: response.statusText,
          retryable: response.status >= 500 || response.status === 429,
          providerStatus: response.status
        },
        latencyMs: Math.max(1, Date.now() - started)
      };
    }
    const image = findGeminiImagePart(body);
    if (!image) {
      return {
        ok: false,
        outputAssets: [],
        rawResponseRedactedJson: { provider: "gemini", status: response.status, body: { ...body, candidates: "[redacted]" } },
        error: { code: "provider_bad_response", message: "Gemini response did not include image data", retryable: true, providerStatus: response.status },
        latencyMs: Math.max(1, Date.now() - started)
      };
    }
    const storageKey = "renders/" + request.traceId + "/gemini-output.png";
    const stored = await uploadGeneratedBase64Asset("renders", storageKey, image.base64, image.mimeType, env);
    return {
      ok: true,
      outputAssets: [{
        role: "image",
        storageKey,
        mimeType: image.mimeType,
        sha256: stored.sha256,
        bytes: stored.bytes
      }],
      providerResponseId: "gemini-" + request.idempotencyKey,
      finishReason: "stop",
      usageJson: body.usageMetadata,
      costEstimateUsd: estimateInvocationCost(request, model),
      rawResponseRedactedJson: { provider: "gemini", model: model.modelKey, usageMetadata: body.usageMetadata, candidates: "[image redacted]" },
      latencyMs: Math.max(1, Date.now() - started)
    };
  }
};
