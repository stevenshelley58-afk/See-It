import { estimateInvocationCost } from "@/lib/ai/cost";
import type { AiInvocationRequest, AiNormalizedResult, AiProviderAdapter, AiTaskType } from "@/lib/ai/types";
import type { AiModelRecord } from "@/lib/db/schema";
import { readEnv } from "@/lib/env";
import { uploadGeneratedBase64Asset } from "@/lib/storage/generated-assets";

function simulatedCustomHttpResult(request: AiInvocationRequest, model: AiModelRecord, started: number): AiNormalizedResult {
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

async function extractBase64Image(body: Record<string, unknown>) {
  for (const key of ["b64_json", "imageBase64", "base64", "image"]) {
    if (typeof body[key] === "string") {
      return { base64: body[key], mimeType: typeof body.mimeType === "string" ? body.mimeType : "image/png" };
    }
  }
  const output = body.output as Record<string, unknown> | undefined;
  if (output) {
    return extractBase64Image(output);
  }
  if (typeof body.url === "string") {
    const response = await fetch(body.url);
    if (!response.ok) {
      throw new Error("custom_http_image_url_fetch_failed:" + response.status);
    }
    return {
      base64: Buffer.from(await response.arrayBuffer()).toString("base64"),
      mimeType: response.headers.get("content-type") ?? "image/png"
    };
  }
  return undefined;
}

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
    let env: ReturnType<typeof readEnv> | undefined;
    try {
      env = readEnv();
    } catch {
      return simulatedCustomHttpResult(request, model, started);
    }
    if (env.APP_ENV === "test" || !env.CUSTOM_IMAGE_API_KEY || !env.CUSTOM_IMAGE_API_BASE_URL) {
      return simulatedCustomHttpResult(request, model, started);
    }
    const response = await fetch(env.CUSTOM_IMAGE_API_BASE_URL.replace(/\/$/, "") + "/v1/images", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.CUSTOM_IMAGE_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        traceId: request.traceId,
        taskType: request.taskType,
        model: model.modelKey,
        prompt: request.promptSnapshot,
        assets: request.assets,
        params: request.params,
        idempotencyKey: request.idempotencyKey
      })
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        outputAssets: [],
        rawResponseRedactedJson: { provider: "custom-http", status: response.status, body },
        error: {
          code: response.status >= 500 || response.status === 429 ? "provider_retryable_error" : "provider_bad_response",
          message: response.statusText,
          retryable: response.status >= 500 || response.status === 429,
          providerStatus: response.status
        },
        latencyMs: Math.max(1, Date.now() - started)
      };
    }
    const image = await extractBase64Image(body);
    if (!image) {
      return {
        ok: false,
        outputAssets: [],
        rawResponseRedactedJson: { provider: "custom-http", status: response.status, body: { ...body, image: "[redacted]" } },
        error: { code: "provider_bad_response", message: "Custom image response did not include image data", retryable: true, providerStatus: response.status },
        latencyMs: Math.max(1, Date.now() - started)
      };
    }
    const storageKey = "renders/" + request.traceId + "/custom-http-output.png";
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
      providerResponseId: typeof body.id === "string" ? body.id : "custom-http-" + request.idempotencyKey,
      finishReason: typeof body.finishReason === "string" ? body.finishReason : "stop",
      usageJson: typeof body.usage === "object" && body.usage ? body.usage : {},
      costEstimateUsd: estimateInvocationCost(request, model),
      rawResponseRedactedJson: { provider: "custom-http", model: model.modelKey, id: body.id, usage: body.usage, image: "[redacted]" },
      latencyMs: Math.max(1, Date.now() - started)
    };
  }
};
