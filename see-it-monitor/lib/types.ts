/**
 * =============================================================================
 * See It Monitor - API Type Definitions
 * =============================================================================
 *
 * SYNC SOURCE: These types must match the backend API responses.
 *
 * Run `npm run check:consistency` in the app directory to validate alignment.
 *
 * Source files:
 * - app/services/see-it-now/types.ts (ProductPlacementFacts, PromptPack)
 * - app/services/monitor/types.ts (RunListItemV1, RunDetailV1, etc.)
 * - app/routes/external.v1.*.tsx (API response shapes)
 *
 * Key types synced from backend:
 * - WaterfallMs: Waterfall timing breakdown (download, inference, upload)
 * - RunTotals: Aggregated run metrics (tokens, cost, call counts)
 * - LLMCall: LLM call instrumentation data
 * - CompositeVariant: Individual variant output details
 *
 * Naming conventions:
 * - All API responses use camelCase (not snake_case)
 * - Timestamps are ISO 8601 strings
 * - IDs are UUIDs or CUIDs depending on the model
 *
 * =============================================================================
 */

// =============================================================================
// Health API - matches backend ExternalHealthStats
// =============================================================================

export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  failureRate1h: number;
  failureRate24h: number;
  totalRuns1h: number;
  totalRuns24h: number;
  latencyP50: number | null;
  latencyP95: number | null;
  providerErrors24h: number;
  storageErrors24h: number;
}

// =============================================================================
// Runs API - matches backend ExternalRunsListResponse
// =============================================================================

export interface RunsListResponse {
  runs: RunListItem[];
  cursor: string | null;
  total?: number;
}

export interface RunListItem {
  id: string;
  createdAt: string;
  shopId: string;
  shopDomain: string;
  productTitle: string | null;
  productId: string | null;
  status: string;
  pipelineConfigHash: string;
  totalDurationMs: number | null;
  variantCount: number;
  successCount: number;
  failCount: number;
  timeoutCount: number;
  traceId: string;
}

// =============================================================================
// Run Detail - matches backend ExternalRunDetail
// =============================================================================

export interface RunDetail {
  id: string;
  createdAt: string;
  completedAt: string | null;
  traceId: string;
  shopId: string;
  shopDomain: string;
  productAssetId: string;
  productTitle: string | null;
  productId: string | null;
  roomSessionId: string | null;
  status: string;
  pipelineConfigHash: string;
  totalDurationMs: number | null;
  successCount: number;
  failCount: number;
  timeoutCount: number;
  variants: CompositeVariant[];
  // LLM calls (summarized unless revealed)
  llmCalls?: LLMCallSummary[];
  // Only included if revealEnabled
  resolvedFactsSnapshot?: Record<string, unknown>;
  placementSetSnapshot?: Record<string, unknown>;
  pipelineConfigSnapshot?: Record<string, unknown>;
  // Prompt Control Plane fields (legacy - may be deprecated)
  resolvedConfigSnapshot?: ResolvedConfigSnapshot | null;
  // Waterfall timing (may be populated after run completes)
  waterfallMs?: WaterfallMs | null;
  runTotals?: RunTotals | null;
}

// Summary of LLM call from run detail (matches ExternalRunDetail.llmCalls)
export interface LLMCallSummary {
  id: string;
  variantId: string | null;
  promptKey: string;
  status: string;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costEstimate: string | null;
  callSummary: {
    model?: string;
    imageCount?: number;
    promptName?: string;
    promptPreview?: string;
  };
  debugPayload?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
}

// =============================================================================
// Prompt Control Plane Types (for Run Detail)
// =============================================================================

export interface ResolvedConfigSnapshot {
  resolvedAt: string;
  runtime: RuntimeConfigSnapshot;
  prompts: Record<string, ResolvedPromptSnapshot>;
  blockedPrompts: Record<string, string>; // promptName -> reason
}

export interface RuntimeConfigSnapshot {
  maxConcurrency: number;
  forceFallbackModel: string | null;
  modelAllowList: string[];
  caps: {
    maxTokensOutput: number;
    maxImageBytes: number;
  };
  dailyCostCap: number;
  disabledPrompts: string[];
}

export interface ResolvedPromptSnapshot {
  promptDefinitionId: string;
  promptVersionId: string | null;
  version: number | null;
  templateHash: string;
  model: string;
  params: Record<string, unknown>;
  messages: PromptMessage[];
  templates: {
    system: string | null;
    developer: string | null;
    user: string | null;
  };
  resolutionHash: string;
  source: "active" | "system-fallback" | "override";
  overridesApplied: string[];
}

export interface PromptMessage {
  role: "system" | "developer" | "user";
  content: string;
}

export interface WaterfallMs {
  download_ms: number;
  prompt_build_ms: number;
  inference_ms: number;
  inference_p50_ms?: number;
  inference_p95_ms?: number;
  upload_ms: number;
  total_ms: number;
}

export interface RunTotals {
  tokens_in: number;
  tokens_out: number;
  cost_estimate: number;
  calls_total: number;
  calls_succeeded: number;
  calls_failed: number;
  calls_timeout: number;
}

export interface CompositeVariant {
  id: string;
  variantId: string;
  status: string;
  latencyMs: number | null;
  providerMs: number | null;
  uploadMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  imageUrl: string | null;
}

/** @deprecated Use CompositeVariant instead */
export type VariantResult = CompositeVariant;

// =============================================================================
// Run Events - for /runs/:id/events endpoint
// =============================================================================

export interface RunEvent {
  id: string;
  ts: string;                    // ISO timestamp
  severity: string;              // e.g., "info", "warn", "error"
  source: string;                // e.g., "renderer", "provider", "storage"
  type: string;                  // e.g., "variant_started", "variant_completed"
  variantId: string | null;      // Linked variant (if applicable)
  payload: Record<string, unknown> | null; // Event-specific data (may be redacted)
}

export interface RunEventsResponse {
  events: RunEvent[];
}

// =============================================================================
// Run Artifacts - for /runs/:id/artifacts endpoint
// =============================================================================

export interface RunArtifact {
  id: string;
  type: string;                  // e.g., "variant_output", "room_input", "prompt"
  contentType: string;           // MIME type: "image/png", "application/json"
  byteSize: number;
  dimensions: { width: number; height: number } | null;
  sha256: string;
  url: string | null;            // Signed URL (may be null if reveal=false)
  createdAt: string;
}

export interface RunArtifactsResponse {
  artifacts: RunArtifact[];
}

// =============================================================================
// Shops API - matches backend ExternalShopListItem
// =============================================================================

export interface ShopsListResponse {
  shops: ShopListItem[];
  cursor: string | null;
  total?: number;
}

export interface ShopListItem {
  shopId: string;
  shopDomain: string;
  runsInWindow: number;
  successRateInWindow: number; // 0-100 percentage
  lastRunAt: string | null;
}

// =============================================================================
// Shop Detail - matches backend ExternalShopDetail
// =============================================================================

export interface ShopDetail {
  shop: {
    shopId: string;
    shopDomain: string;
    plan: string;
    createdAt: string;
  };
  recentRuns: RunListItem[];
  topErrors: { message: string; count: number }[];
  health: {
    failureRate1h: number;
    failureRate24h: number;
    failureRate7d: number;
    totalRuns1h: number;
    totalRuns24h: number;
    totalRuns7d: number;
    latencyP50: number | null;
    latencyP95: number | null;
    providerErrors24h: number;
    storageErrors24h: number;
    telemetryDropped24h: number;
  };
}

// =============================================================================
// Query params
// =============================================================================

export interface RunsParams {
  limit?: number;
  cursor?: string;
  status?: string;
  shopId?: string;
}

export interface ShopsParams {
  limit?: number;
  cursor?: string;
  windowDays?: number;
}

// =============================================================================
// LLM Calls - for /api/runs/:id/llm-calls endpoint
// =============================================================================

export type LLMCallStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "TIMEOUT";

export interface LLMCall {
  id: string;
  promptName: string;
  promptVersionId: string | null;
  model: string;
  status: LLMCallStatus;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costEstimate: number | null;
  errorType: string | null;
  errorMessage: string | null;
  retryCount: number;
  providerRequestId: string | null;
  providerModel: string | null;
  resolutionHash: string;
  requestHash: string;
  inputRef: LLMCallInputRef | null;
  inputPayload: Record<string, unknown> | null;
  outputRef: LLMCallOutputRef | null;
}

export interface LLMCallInputRef {
  messageCount?: number;
  imageCount?: number;
  preview?: string;
  resolutionHash?: string;
}

export interface LLMCallOutputRef {
  preview?: string;
  length?: number;
}

export interface LLMCallsResponse {
  llmCalls: LLMCall[];
  count: number;
}

// =============================================================================
// Common types
// =============================================================================

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
