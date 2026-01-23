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
  requestId?: string;
  promptVersion?: number;
  model?: string;
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
  promptPackVersion: number;
  model: string;
  totalDurationMs: number | null;
  variantCount: number;
  successCount: number;
  failCount: number;
  timeoutCount: number;
  requestId: string;
  traceId: string | null;
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
  providerMs: number | null;
  uploadMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  imageUrl: string | null;
  outputImageKey: string | null;
}

export interface RunDetailV1 {
  id: string;
  createdAt: string;
  completedAt: string | null;
  requestId: string;
  traceId: string | null;
  shopId: string;
  productAssetId: string;
  productTitle: string | null;
  productId: string | null;
  roomSessionId: string | null;
  status: string;
  promptPackVersion: number;
  model: string;
  totalDurationMs: number | null;
  successCount: number;
  failCount: number;
  timeoutCount: number;
  telemetryDropped: boolean;
  variants: VariantDetailV1[];
  resolvedFactsJson: Record<string, unknown>;
  promptPackJson: Record<string, unknown>;
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
  telemetryDropped24h: number;
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
