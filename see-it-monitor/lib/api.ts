import type {
  HealthResponse,
  RunsListResponse,
  RunsParams,
  RunDetail,
  RunEventsResponse,
  RunArtifactsResponse,
  ShopsListResponse,
  ShopsParams,
  ShopDetail,
  ApiError,
  LLMCallsResponse,
} from "./types";

import type {
  RuntimeConfigResponse,
  UpdateRuntimeConfigRequest,
  AuditLogEntry,
  AuditAction,
  PromptListResponse,
} from "./types-prompt-control";

// External API calls go through /api/external/* (never direct Railway calls)
const API_BASE = "/api/external";

// Internal API calls go directly to Next.js API routes
const INTERNAL_API_BASE = "/api";

/**
 * Base fetch wrapper with error handling
 */
async function fetchApi<T>(
  path: string,
  options?: {
    params?: Record<string, string | number | boolean | undefined>;
    reveal?: boolean;
  }
): Promise<T> {
  const url = new URL(`${API_BASE}/${path}`, window.location.origin);

  // Add query params
  if (options?.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  // Add reveal param if requested
  if (options?.reveal) {
    url.searchParams.set("_reveal", "true");
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: "fetch_error",
        message: `Request failed with status ${response.status}`,
      };
    }
    throw error;
  }

  return response.json();
}

/**
 * Get system health status
 */
export async function getHealth(): Promise<HealthResponse> {
  return fetchApi<HealthResponse>("health");
}

/**
 * Get list of runs (cursor-based pagination)
 */
export async function getRuns(params?: RunsParams): Promise<RunsListResponse> {
  return fetchApi<RunsListResponse>("runs", {
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

/**
 * Get a single run by ID
 */
export async function getRun(id: string, reveal?: boolean): Promise<RunDetail> {
  return fetchApi<RunDetail>(`runs/${id}`, { reveal });
}

/**
 * Get events for a run by ID
 */
export async function getRunEvents(
  id: string,
  reveal?: boolean
): Promise<RunEventsResponse> {
  return fetchApi<RunEventsResponse>(`runs/${id}/events`, { reveal });
}

/**
 * Get artifacts for a run by ID
 */
export async function getRunArtifacts(
  id: string,
  reveal?: boolean
): Promise<RunArtifactsResponse> {
  return fetchApi<RunArtifactsResponse>(`runs/${id}/artifacts`, { reveal });
}

/**
 * Get LLM calls for a run by ID (internal API - uses local Prisma)
 */
export async function getRunLLMCalls(runId: string): Promise<LLMCallsResponse> {
  const url = new URL(`${INTERNAL_API_BASE}/runs/${runId}/llm-calls`, window.location.origin);

  const response = await fetch(url.toString());

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: "fetch_error",
        message: `Request failed with status ${response.status}`,
      };
    }
    throw error;
  }

  return response.json();
}

/**
 * Get list of shops (cursor-based pagination)
 */
export async function getShops(params?: ShopsParams): Promise<ShopsListResponse> {
  return fetchApi<ShopsListResponse>("shops", {
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

/**
 * Get a single shop by ID
 */
export async function getShop(id: string, reveal?: boolean): Promise<ShopDetail> {
  return fetchApi<ShopDetail>(`shops/${id}`, { reveal });
}

// =============================================================================
// Runtime Config API (Internal - uses local Prisma)
// =============================================================================

export interface AuditLogParams {
  limit?: number;
  cursor?: string;
  action?: AuditAction;
  targetType?: string;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

/**
 * Get runtime config for a shop
 */
export async function getRuntimeConfig(shopId: string): Promise<RuntimeConfigResponse> {
  const url = new URL(`${INTERNAL_API_BASE}/shops/${shopId}/runtime-config`, window.location.origin);

  const response = await fetch(url.toString());

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: "fetch_error",
        message: `Request failed with status ${response.status}`,
      };
    }
    throw error;
  }

  return response.json();
}

/**
 * Update runtime config for a shop
 */
export async function updateRuntimeConfig(
  shopId: string,
  data: UpdateRuntimeConfigRequest,
  actor?: string
): Promise<RuntimeConfigResponse> {
  const url = new URL(`${INTERNAL_API_BASE}/shops/${shopId}/runtime-config`, window.location.origin);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (actor) {
    headers["x-actor"] = actor;
  }

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: "fetch_error",
        message: `Request failed with status ${response.status}`,
      };
    }
    throw error;
  }

  return response.json();
}

/**
 * Get audit log for a shop
 */
export async function getAuditLog(
  shopId: string,
  params?: AuditLogParams
): Promise<AuditLogResponse> {
  const url = new URL(`${INTERNAL_API_BASE}/shops/${shopId}/audit-log`, window.location.origin);

  if (params?.limit !== undefined) {
    url.searchParams.set("limit", String(params.limit));
  }
  if (params?.cursor) {
    url.searchParams.set("cursor", params.cursor);
  }
  if (params?.action) {
    url.searchParams.set("action", params.action);
  }
  if (params?.targetType) {
    url.searchParams.set("targetType", params.targetType);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: "fetch_error",
        message: `Request failed with status ${response.status}`,
      };
    }
    throw error;
  }

  return response.json();
}

// =============================================================================
// Prompts API (Internal - uses local Prisma)
// =============================================================================

/**
 * Get prompts list for a shop
 */
export async function getPrompts(shopId: string): Promise<PromptListResponse> {
  const url = new URL(`${INTERNAL_API_BASE}/shops/${shopId}/prompts`, window.location.origin);

  const response = await fetch(url.toString());

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: "fetch_error",
        message: `Request failed with status ${response.status}`,
      };
    }
    throw error;
  }

  return response.json();
}

/**
 * TanStack Query key factories
 */
export const queryKeys = {
  health: ["health"] as const,
  runs: {
    all: ["runs"] as const,
    list: (params?: RunsParams) => ["runs", "list", params] as const,
    detail: (id: string) => ["runs", "detail", id] as const,
    events: (id: string) => ["runs", "events", id] as const,
    artifacts: (id: string) => ["runs", "artifacts", id] as const,
    llmCalls: (id: string) => ["runs", "llm-calls", id] as const,
  },
  shops: {
    all: ["shops"] as const,
    list: (params?: ShopsParams) => ["shops", "list", params] as const,
    detail: (id: string) => ["shops", "detail", id] as const,
    runtimeConfig: (id: string) => ["shops", "runtime-config", id] as const,
    auditLog: (id: string, params?: AuditLogParams) => ["shops", "audit-log", id, params] as const,
  },
  prompts: {
    all: ["prompts"] as const,
    list: (shopId: string) => ["prompts", "list", shopId] as const,
    detail: (shopId: string, name: string) => ["prompts", "detail", shopId, name] as const,
  },
};
