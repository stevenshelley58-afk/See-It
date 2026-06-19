import type { AiInputAsset, AiNormalizedResult, AiTaskType } from "@/lib/ai/types";

export type UUID = string;
export type Surface = "widget" | "admin" | "founder" | "demo" | "cron" | "system";
export type RenderKind = "shopper" | "lifestyle" | "demo" | "test" | "replay" | "eval";
export type PromptStatus = "draft" | "review" | "approved" | "active" | "archived";
export type ProviderStatus = "enabled" | "disabled" | "degraded";
export type ModelStatus = "enabled" | "disabled" | "deprecated" | "testing";
export type RenderStatus = "created" | "assets_pending" | "queued" | "running" | "evaluating" | "done" | "failed" | "cancelled" | "expired";
export type JobStatus = "queued" | "leased" | "running" | "succeeded" | "failed" | "dead" | "cancelled";

export interface ShopRecord {
  id: UUID;
  shopDomain: string;
  shopName?: string;
  contactEmail?: string;
  offlineAccessTokenEncrypted?: string;
  plan: "trial" | "starter" | "growth" | "cancelled";
  rendersQuota: number;
  lifestyleImagesQuota: number;
  billingStatus: string;
  roomPreviewEnabled: boolean;
  installedAt: string;
  uninstalledAt?: string;
}

export interface ProductSetupRecord {
  id: UUID;
  shopId: UUID;
  shopifyProductGid: string;
  shopifyProductHandle?: string;
  title: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  category: string;
  material?: string;
  colour?: string;
  primaryImageKey?: string;
  cutoutKey?: string;
  prepStatus: "none" | "extracting" | "awaiting_confirm" | "ready" | "failed";
  enabled: boolean;
}

export interface AiProviderRecord {
  id: UUID;
  providerKey: string;
  displayName: string;
  adapterKey: string;
  adapterVersion: string;
  status: ProviderStatus;
  secretRef?: string;
  baseUrl?: string;
  docsUrl?: string;
  notes?: string;
}

export interface AiModelRecord {
  id: UUID;
  providerId: UUID;
  providerKey: string;
  modelKey: string;
  displayName: string;
  modelVersion?: string;
  status: ModelStatus;
  capabilities: string[];
  allowedTasks: AiTaskType[];
  defaultParams: Record<string, unknown>;
  limits: Record<string, unknown>;
  pricing: Record<string, unknown>;
  docsUrl?: string;
}

export interface ModelRoutePolicyRecord {
  id: UUID;
  name: string;
  surface: Surface;
  taskType: AiTaskType;
  status: "draft" | "active" | "archived";
  policy: {
    primary: Array<{ providerKey: string; modelKey: string }>;
    fallbacks: Array<{ providerKey: string; modelKey: string; onErrorCodes?: string[] }>;
    escalation: Array<{ providerKey: string; modelKey: string; onGateFail?: boolean }>;
    maxAttempts: number;
    maxCostUsd: number;
    maxLatencyMs: number;
  };
}

export interface PromptTemplateRecord {
  id: UUID;
  name: string;
  taskType: AiTaskType;
  surface: Surface;
  description?: string;
}

export interface PromptVersionRecord {
  id: UUID;
  promptTemplateId: UUID;
  version: number;
  status: PromptStatus;
  systemInstruction?: string;
  developerInstruction?: string;
  userPromptTemplate: string;
  negativePromptTemplate?: string;
  variablesSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  allowedAssetRoles: string[];
  requiredAssetOrder: string[];
  defaultParams: Record<string, unknown>;
  promptHash: string;
  notes?: string;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface PromptBundleRecord {
  id: UUID;
  name: string;
  surface: Surface;
  description?: string;
}

export interface PromptBundleVersionRecord {
  id: UUID;
  promptBundleId: UUID;
  version: number;
  status: PromptStatus;
  promptVersionMap: Record<string, UUID>;
  bundleHash: string;
}

export interface RenderRecipeRecord {
  id: UUID;
  name: string;
  surface: Surface;
  kind: RenderKind;
  description?: string;
}

export interface RenderRecipeVersionRecord {
  id: UUID;
  renderRecipeId: UUID;
  version: number;
  status: PromptStatus;
  promptBundleVersionId: UUID;
  modelRoutePolicyId: UUID;
  gatePolicy: Record<string, unknown>;
  retryPolicy: Record<string, unknown>;
  storagePolicy: Record<string, unknown>;
  outputPolicy: Record<string, unknown>;
  recipeHash: string;
}

export interface PromptDeploymentRecord {
  id: UUID;
  surface: Surface;
  taskType?: AiTaskType;
  renderRecipeVersionId: UUID;
  status: "active" | "rolled_back" | "paused";
  trafficPercent: number;
  startedAt: string;
  endedAt?: string;
  createdBy: string;
  reason?: string;
}

export interface RoomSessionRecord {
  id: UUID;
  shopId?: UUID;
  productSetupId?: UUID;
  source: "widget" | "demo" | "merchant_test" | "eval";
  roomKey: string;
  normalizedRoomKey?: string;
  expiresAt: string;
  verified?: boolean;
  width?: number;
  height?: number;
}

export interface RenderRequestRecord {
  id: UUID;
  traceId: string;
  shopId?: UUID;
  roomSessionId?: UUID;
  productSetupId?: UUID;
  sourceRenderRequestId?: UUID;
  kind: RenderKind;
  surface: Surface;
  status: RenderStatus;
  tapX?: number;
  tapY?: number;
  hintText?: string;
  attemptCount: number;
  selectedResultAssetId?: UUID;
  finalGateScore?: number;
  finalErrorCode?: string;
  finalMessage?: string;
  remainingRefinements: number;
  createdAt: string;
  completedAt?: string;
}

export interface RenderAttemptRecord {
  id: UUID;
  renderRequestId: UUID;
  attemptNumber: number;
  parentAttemptId?: UUID;
  aiInvocationId?: UUID;
  providerId?: UUID;
  aiModelId?: UUID;
  renderRecipeVersionId?: UUID;
  promptBundleVersionId?: UUID;
  status: "queued" | "running" | "provider_done" | "stored" | "evaluated" | "accepted" | "rejected" | "failed" | "cancelled";
  reason?: string;
  resultAssetId?: UUID;
  gateScore?: number;
  gateDetail?: Record<string, unknown>;
  latencyMs?: number;
  costEstimateUsd?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface AiInvocationRecord {
  id: UUID;
  traceId: string;
  surface: Surface;
  taskType: AiTaskType;
  providerId: UUID;
  aiModelId: UUID;
  adapterKey: string;
  adapterVersion: string;
  promptTemplateId?: UUID;
  promptVersionId?: UUID;
  promptBundleVersionId?: UUID;
  renderRecipeVersionId?: UUID;
  resolvedSystemInstruction?: string;
  resolvedDeveloperInstruction?: string;
  resolvedUserPrompt?: string;
  resolvedNegativePrompt?: string;
  variablesJson: Record<string, unknown>;
  imageInputs: AiInputAsset[];
  params: Record<string, unknown>;
  requestJsonRedacted: unknown;
  responseJsonRedacted: unknown;
  normalizedResult: AiNormalizedResult | Record<string, never>;
  providerResponseId?: string;
  finishReason?: string;
  safetyJson: unknown;
  usageJson: unknown;
  costEstimateUsd?: number;
  latencyMs?: number;
  status: "created" | "sent" | "succeeded" | "failed" | "cancelled";
  errorCode?: string;
  errorMessage?: string;
  retryable: boolean;
  idempotencyKey: string;
  createdAt: string;
  completedAt?: string;
}

export interface RenderAssetRecord {
  id: UUID;
  renderRequestId: UUID;
  renderAttemptId?: UUID;
  aiInvocationId?: UUID;
  role: string;
  storageBucket: string;
  storageKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  sha256?: string;
  bytes?: number;
  retentionExpiresAt?: string;
}

export interface RenderTraceEventRecord {
  id: UUID;
  traceId: string;
  renderRequestId?: UUID;
  renderAttemptId?: UUID;
  aiInvocationId?: UUID;
  eventName: string;
  eventLevel: "debug" | "info" | "warn" | "error";
  message?: string;
  props: Record<string, unknown>;
  durationMs?: number;
  createdAt: string;
}

export interface RenderFeedbackRecord {
  id: UUID;
  renderRequestId: UUID;
  verdict: "up" | "down";
  issueTag?: string;
  comment?: string;
}

export interface JobRecord {
  id: UUID;
  type: string;
  status: JobStatus;
  priority: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  leaseOwner?: string;
  leasedUntil?: string;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  runAfter: string;
  createdAt: string;
  completedAt?: string;
}

export interface EventLogRecord {
  id: UUID;
  surface: string;
  name: string;
  shopId?: UUID;
  renderRequestId?: UUID;
  productSetupId?: UUID;
  aiInvocationId?: UUID;
  props: Record<string, unknown>;
  ts: string;
}

export interface AuditLogRecord {
  id: UUID;
  actor: string;
  action: string;
  entityType: string;
  entityId?: UUID;
  before?: unknown;
  after?: unknown;
  reason?: string;
  createdAt: string;
}
