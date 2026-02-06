/**
 * Monitor API Response Types - Version 1
 *
 * These are STABLE contracts for the UI.
 * Only ADD fields, never remove or rename.
 */

// =============================================================================
// Run List
// =============================================================================

export interface RunListFilters {
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
  productId?: string;
  traceId?: string;
  pipelineConfigHash?: string;
}

export interface RunListPagination {
  page: number;
  limit: number;
}

export interface RunListItemV1 {
  id: string;
  createdAt: string;
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

export interface RunListResponseV1 {
  runs: RunListItemV1[];
  total: number;
  page: number;
  pages: number;
}

// =============================================================================
// Run Detail
// =============================================================================

export interface VariantDetailV1 {
  id: string;
  variantId: string;
  status: string;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  imageUrl: string | null;
  imageRef: string | null;
  imageHash: string | null;
}

export interface LLMCallSummaryV1 {
  id: string;
  variantId: string | null;
  promptKey: string;
  status: string;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costEstimate: string | null;
  callSummary: {
    promptName: string;
    model: string;
    imageCount: number;
    promptPreview: string;
  };
  // Only included when reveal=true
  debugPayload?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
}

export interface RunDetailV1 {
  id: string;
  createdAt: string;
  completedAt: string | null;
  traceId: string;
  shopId: string;
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
  variants: VariantDetailV1[];
  // Snapshots (always included)
  resolvedFactsSnapshot: Record<string, unknown>;
  placementSetSnapshot: Record<string, unknown>;
  pipelineConfigSnapshot: Record<string, unknown>;
  // LLM calls (summarized unless reveal=true)
  llmCalls: LLMCallSummaryV1[];
  // Image references
  preparedProductImageRef: string;
  roomImageRef: string;
  // Timing breakdown
  waterfallMs: Record<string, unknown> | null;
  runTotals: Record<string, unknown> | null;
}

// =============================================================================
// Events
// =============================================================================

export interface EventV1 {
  id: string;
  ts: string;
  source: string;
  type: string;
  severity: string;
  variantId: string | null;
  payload: Record<string, unknown>;
  overflowArtifactId?: string | null;
}

export interface EventListResponseV1 {
  events: EventV1[];
}

// =============================================================================
// Artifacts
// =============================================================================

export interface ArtifactV1 {
  id: string;
  ts: string;
  type: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  url: string | null;
}

export interface ArtifactListResponseV1 {
  artifacts: ArtifactV1[];
}

// =============================================================================
// Health
// =============================================================================

export interface HealthStatsV1 {
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
}

// =============================================================================
// Debug Bundle
// =============================================================================

export interface DebugBundleV1 {
  exportedAt: string;
  run: RunDetailV1;
  events: EventV1[];
  artifacts: ArtifactV1[];
}
