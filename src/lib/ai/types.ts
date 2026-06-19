import type { AiModelRecord } from "@/lib/db/schema";

export type AiTaskType =
  | "product_dimension_extract"
  | "product_cutout"
  | "room_analysis"
  | "render_composite"
  | "render_refine"
  | "lifestyle_generate"
  | "quality_gate"
  | "prompt_eval"
  | "caption"
  | "personalization";

export type AiInputAsset = {
  role:
    | "product_image"
    | "product_cutout"
    | "room_image"
    | "previous_render"
    | "mask"
    | "reference"
    | "style_reference";
  storageKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  sha256?: string;
  order: number;
};

export type AiInvocationRequest = {
  traceId: string;
  surface: "widget" | "admin" | "founder" | "demo" | "cron" | "system";
  taskType: AiTaskType;
  providerKey: string;
  modelKey: string;
  modelVersion?: string;
  promptSnapshot: {
    promptTemplateId: string;
    promptVersionId: string;
    promptBundleVersionId?: string;
    renderRecipeVersionId?: string;
    resolvedSystemInstruction?: string;
    resolvedDeveloperInstruction?: string;
    resolvedUserPrompt: string;
    resolvedNegativePrompt?: string;
    variablesJson: Record<string, unknown>;
    promptHash: string;
  };
  assets: AiInputAsset[];
  params: {
    aspectRatio?: string;
    size?: string;
    quality?: string;
    seed?: number;
    temperature?: number;
    guidanceScale?: number;
    outputFormat?: "png" | "jpg" | "webp";
    safety?: Record<string, unknown>;
    providerSpecific?: Record<string, unknown>;
  };
  idempotencyKey: string;
};

export type AiNormalizedResult = {
  ok: boolean;
  outputAssets: Array<{
    role: "image" | "mask" | "json" | "text" | "debug";
    storageKey?: string;
    text?: string;
    json?: unknown;
    mimeType?: string;
    width?: number;
    height?: number;
    sha256?: string;
    bytes?: number;
  }>;
  providerResponseId?: string;
  finishReason?: string;
  safetyJson?: unknown;
  usageJson?: unknown;
  costEstimateUsd?: number;
  rawResponseRedactedJson?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    providerStatus?: number;
    rawErrorRedactedJson?: unknown;
  };
  latencyMs: number;
};

export interface AiProviderAdapter {
  providerKey: string;
  adapterVersion: string;
  supports(model: AiModelRecord, taskType: AiTaskType): boolean;
  invoke(request: AiInvocationRequest, model: AiModelRecord): Promise<AiNormalizedResult>;
  estimateCost?(request: AiInvocationRequest, model: AiModelRecord): Promise<number | null>;
  validateParams?(params: AiInvocationRequest["params"], model: AiModelRecord): void;
}

export const AI_CAPABILITIES = [
  "text_to_image",
  "image_edit",
  "multi_image_reference",
  "ordered_image_inputs",
  "mask_edit",
  "transparent_background",
  "aspect_ratio_control",
  "size_control",
  "seed_control",
  "style_reference",
  "negative_prompt",
  "safety_settings",
  "async_response",
  "sync_response",
  "json_output",
  "cost_estimate",
  "raw_usage",
  "high_fidelity_reference"
] as const;
