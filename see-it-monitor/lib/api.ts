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
} from "./types";

// All calls go through /api/external/* (never direct Railway calls)
const API_BASE = "/api/external";

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
  },
  shops: {
    all: ["shops"] as const,
    list: (params?: ShopsParams) => ["shops", "list", params] as const,
    detail: (id: string) => ["shops", "detail", id] as const,
  },
};
