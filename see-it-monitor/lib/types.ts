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

// =============================================================================
// Run Detail - matches backend ExternalRunDetail
// =============================================================================

export interface RunDetail {
  id: string;
  createdAt: string;
  completedAt: string | null;
  requestId: string;
  traceId: string | null;
  shopId: string;
  shopDomain: string;
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
  variants: VariantResult[];
  resolvedFactsJson?: Record<string, unknown>;
  promptPackJson?: Record<string, unknown>;
}

export interface VariantResult {
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
// Common types
// =============================================================================

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
