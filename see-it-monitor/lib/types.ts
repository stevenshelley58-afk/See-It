// Health API Response
export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version?: string;
  checks?: {
    database?: HealthCheck;
    redis?: HealthCheck;
    worker?: HealthCheck;
  };
  metrics?: HealthMetrics;
}

export interface HealthCheck {
  status: "healthy" | "degraded" | "unhealthy";
  latency_ms?: number;
  message?: string;
}

export interface HealthMetrics {
  failure_rate_1h?: number;
  failure_rate_24h?: number;
  latency_p50_ms?: number;
  latency_p95_ms?: number;
  recent_errors?: RecentError[];
}

export interface RecentError {
  error: string;
  count: number;
  last_seen: string;
}

// Runs API Response
export interface RunsListResponse {
  runs: Run[];
  pagination: Pagination;
}

export interface Run {
  id: string;
  shop_id: string;
  shop_name?: string;
  status: RunStatus;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;
}

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// Shops API Response
export interface ShopsListResponse {
  shops: Shop[];
  pagination: Pagination;
}

export interface Shop {
  id: string;
  name: string;
  domain: string;
  status: ShopStatus;
  last_run_at?: string;
  total_runs?: number;
  failure_rate?: number;
}

export type ShopStatus = "active" | "inactive" | "suspended";

// Common types
export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

// Query filter types
export interface RunsFilters {
  page?: number;
  per_page?: number;
  status?: RunStatus;
  shop_id?: string;
  since?: string;
  until?: string;
}

export interface ShopsFilters {
  page?: number;
  per_page?: number;
  status?: ShopStatus;
  search?: string;
}
