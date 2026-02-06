/**
 * Monitor Queries
 *
 * All read operations for the monitor UI.
 * Uses Prisma, returns V1 response types.
 */

import prisma from "~/db.server";
import { StorageService } from "~/services/storage.server";
import type {
  RunListFilters,
  RunListPagination,
  RunListResponseV1,
  RunDetailV1,
  EventListResponseV1,
  ArtifactListResponseV1,
  HealthStatsV1,
  DebugBundleV1,
  LLMCallSummaryV1,
} from "./types";

const DEFAULT_PAGE_SIZE = 20;

function toRunStatusV1(status: string): string {
  switch (status) {
    case "RUNNING":
      return "in_flight";
    case "COMPLETE":
      return "complete";
    case "PARTIAL":
      return "partial";
    case "FAILED":
      return "failed";
    default:
      return status;
  }
}

function toVariantStatusV1(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "success";
    case "FAILED":
      return "failed";
    case "TIMEOUT":
      return "timeout";
    default:
      return status;
  }
}

function fromRunStatusFilter(filter: string): string {
  switch (filter) {
    case "in_flight":
      return "RUNNING";
    case "complete":
      return "COMPLETE";
    case "partial":
      return "PARTIAL";
    case "failed":
      return "FAILED";
    default:
      return filter;
  }
}

/**
 * Get paginated list of runs with filters.
 */
export async function getRuns(
  shopId: string,
  filters: RunListFilters = {},
  pagination: RunListPagination = { page: 1, limit: DEFAULT_PAGE_SIZE }
): Promise<RunListResponseV1> {
  // Build where clause dynamically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { shopId };

  if (filters.status) {
    where.status = fromRunStatusFilter(filters.status);
  }
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
    if (filters.dateTo) where.createdAt.lte = filters.dateTo;
  }
  if (filters.pipelineConfigHash) {
    where.pipelineConfigHash = filters.pipelineConfigHash;
  }
  if (filters.traceId) {
    where.traceId = filters.traceId;
  }
  if (filters.productId) {
    where.productAsset = { productId: filters.productId };
  }

  const [runs, total] = await Promise.all([
    prisma.compositeRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
      include: {
        productAsset: {
          select: { productTitle: true, productId: true },
        },
      },
    }),
    prisma.compositeRun.count({ where }),
  ]);

  return {
    runs: runs.map((run: typeof runs[number]) => ({
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      productTitle: run.productAsset?.productTitle || null,
      productId: run.productAsset?.productId || null,
      status: toRunStatusV1(run.status),
      pipelineConfigHash: run.pipelineConfigHash,
      totalDurationMs: run.totalDurationMs,
      variantCount: 8, // Always 8 variants
      successCount: run.successCount,
      failCount: run.failCount,
      timeoutCount: run.timeoutCount,
      traceId: run.traceId,
    })),
    total,
    page: pagination.page,
    pages: Math.ceil(total / pagination.limit),
  };
}

/**
 * Get full run detail with variants, LLM calls, and signed URLs.
 */
export async function getRunDetail(
  runId: string,
  shopId: string,
  revealEnabled: boolean = false
): Promise<RunDetailV1 | null> {
  const run = await prisma.compositeRun.findFirst({
    where: { id: runId, shopId },
    include: {
      productAsset: {
        select: { productTitle: true, productId: true },
      },
      compositeVariants: {
        orderBy: { variantId: "asc" },
      },
    },
  });

  if (!run) return null;

  // Fetch LLM calls for this run
  const llmCalls = await prisma.lLMCall.findMany({
    where: {
      ownerType: "COMPOSITE_RUN",
      ownerId: runId,
    },
    orderBy: { startedAt: "asc" },
  });

  // Generate signed URLs for variant images
  const variants = await Promise.all(
    run.compositeVariants.map(async (v: typeof run.compositeVariants[number]) => {
      let imageUrl: string | null = null;
      if (v.imageRef) {
        try {
          imageUrl = await StorageService.getSignedReadUrl(
            v.imageRef,
            60 * 60 * 1000 // 1 hour
          );
        } catch {
          // Ignore URL generation failures
        }
      }

      return {
        id: v.id,
        variantId: v.variantId,
        status: toVariantStatusV1(v.status),
        latencyMs: v.latencyMs,
        providerMs: null,
        uploadMs: null,
        errorCode: v.errorCode,
        errorMessage: v.errorMessage,
        imageUrl,
        imageRef: v.imageRef,
        imageHash: v.imageHash,
      };
    })
  );

  // Format LLM calls - only include debugPayload if reveal is enabled
  const formattedCalls: LLMCallSummaryV1[] = llmCalls.map(
    (call: (typeof llmCalls)[number]) => {
    const result: LLMCallSummaryV1 = {
      id: call.id,
      variantId: call.variantId,
      promptKey: call.promptKey,
      status: call.status,
      latencyMs: call.latencyMs,
      tokensIn: call.tokensIn,
      tokensOut: call.tokensOut,
      costEstimate: call.costEstimate?.toString() || null,
      callSummary: call.callSummary as LLMCallSummaryV1["callSummary"],
    };

    if (revealEnabled) {
      result.debugPayload = call.debugPayload as Record<string, unknown>;
      result.outputSummary = call.outputSummary as Record<string, unknown> | undefined;
    }

    return result;
    }
  );

  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() || null,
    traceId: run.traceId,
    shopId: run.shopId,
    productAssetId: run.productAssetId,
    productTitle: run.productAsset?.productTitle || null,
    productId: run.productAsset?.productId || null,
    roomSessionId: run.roomSessionId,
    status: toRunStatusV1(run.status),
    pipelineConfigHash: run.pipelineConfigHash,
    totalDurationMs: run.totalDurationMs,
    successCount: run.successCount,
    failCount: run.failCount,
    timeoutCount: run.timeoutCount,
    variants,
    resolvedFactsSnapshot: run.resolvedFactsSnapshot as Record<string, unknown>,
    placementSetSnapshot: run.placementSetSnapshot as Record<string, unknown>,
    pipelineConfigSnapshot: run.pipelineConfigSnapshot as Record<string, unknown>,
    llmCalls: formattedCalls,
    preparedProductImageRef: run.preparedProductImageRef,
    roomImageRef: run.roomImageRef,
    waterfallMs: run.waterfallMs as Record<string, unknown> | null,
    runTotals: run.runTotals as Record<string, unknown> | null,
  };
}

/**
 * Get event timeline for a run.
 */
export async function getRunEvents(
  runId: string,
  shopId: string
): Promise<EventListResponseV1> {
  const events = await prisma.monitorEvent.findMany({
    where: { runId, shopId },
    orderBy: { ts: "asc" },
  });

  return {
    events: events.map((e: typeof events[number]) => ({
      id: e.id,
      ts: e.ts.toISOString(),
      source: e.source,
      type: e.type,
      severity: e.severity,
      variantId: e.variantId,
      payload: e.payload as Record<string, unknown>,
      overflowArtifactId: e.overflowArtifactId,
    })),
  };
}

/**
 * Get artifacts for a run.
 */
export async function getRunArtifacts(
  runId: string,
  shopId: string
): Promise<ArtifactListResponseV1> {
  const artifacts = await prisma.monitorArtifact.findMany({
    where: { runId, shopId },
    orderBy: { ts: "asc" },
  });

  const withUrls = await Promise.all(
    artifacts.map(async (a: typeof artifacts[number]) => {
      let url: string | null = null;
      try {
        url = await StorageService.getSignedReadUrl(a.gcsKey, 60 * 60 * 1000);
      } catch {
        // Ignore
      }

      return {
        id: a.id,
        ts: a.ts.toISOString(),
        type: a.type,
        contentType: a.contentType,
        byteSize: a.byteSize,
        width: a.width,
        height: a.height,
        url,
      };
    })
  );

  return { artifacts: withUrls };
}

/**
 * Get health statistics.
 */
export async function getHealthStats(shopId: string): Promise<HealthStatsV1> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    total1h,
    failed1h,
    total24h,
    failed24h,
    total7d,
    failed7d,
    latencyData,
  ] = await Promise.all([
    prisma.compositeRun.count({
      where: { shopId, createdAt: { gte: oneHourAgo } },
    }),
    prisma.compositeRun.count({
      where: { shopId, createdAt: { gte: oneHourAgo }, status: "FAILED" },
    }),
    prisma.compositeRun.count({
      where: { shopId, createdAt: { gte: oneDayAgo } },
    }),
    prisma.compositeRun.count({
      where: { shopId, createdAt: { gte: oneDayAgo }, status: "FAILED" },
    }),
    prisma.compositeRun.count({
      where: { shopId, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.compositeRun.count({
      where: { shopId, createdAt: { gte: sevenDaysAgo }, status: "FAILED" },
    }),
    prisma.compositeRun.findMany({
      where: {
        shopId,
        createdAt: { gte: oneDayAgo },
        totalDurationMs: { not: null },
      },
      select: { totalDurationMs: true },
      orderBy: { totalDurationMs: "asc" },
    }),
  ]);

  // Calculate percentiles
  let latencyP50: number | null = null;
  let latencyP95: number | null = null;

  if (latencyData.length > 0) {
    const durations = latencyData
      .map((r: typeof latencyData[number]) => r.totalDurationMs)
      .filter((d: number | null): d is number => d !== null);

    if (durations.length > 0) {
      latencyP50 = durations[Math.floor(durations.length * 0.5)];
      latencyP95 = durations[Math.floor(durations.length * 0.95)];
    }
  }

  // Count provider/storage errors from events
  const [providerErrors, storageErrors] = await Promise.all([
    prisma.monitorEvent.count({
      where: {
        shopId,
        ts: { gte: oneDayAgo },
        type: "error",
        source: "provider",
      },
    }),
    prisma.monitorEvent.count({
      where: {
        shopId,
        ts: { gte: oneDayAgo },
        type: "error",
        source: "storage",
      },
    }),
  ]);

  return {
    failureRate1h: total1h > 0 ? (failed1h / total1h) * 100 : 0,
    failureRate24h: total24h > 0 ? (failed24h / total24h) * 100 : 0,
    failureRate7d: total7d > 0 ? (failed7d / total7d) * 100 : 0,
    totalRuns1h: total1h,
    totalRuns24h: total24h,
    totalRuns7d: total7d,
    latencyP50,
    latencyP95,
    providerErrors24h: providerErrors,
    storageErrors24h: storageErrors,
  };
}

/**
 * Export debug bundle - assembles all run data for ZIP export.
 */
export async function exportDebugBundle(
  runId: string,
  shopId: string
): Promise<DebugBundleV1 | null> {
  // Fetch all data in parallel (with reveal=true for full debug info)
  const [run, eventsResult, artifactsResult] = await Promise.all([
    getRunDetail(runId, shopId, true),
    getRunEvents(runId, shopId),
    getRunArtifacts(runId, shopId),
  ]);

  if (!run) return null;

  return {
    exportedAt: new Date().toISOString(),
    run,
    events: eventsResult.events,
    artifacts: artifactsResult.artifacts,
  };
}

// =============================================================================
// External API Functions
// =============================================================================

/**
 * Cursor pagination utilities
 */
interface RunCursor {
  id: string;
  createdAt: string;
}

interface ShopCursor {
  id: string;
}

function encodeCursor(data: RunCursor | ShopCursor): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function decodeRunCursor(cursor: string): RunCursor | null {
  try {
    const data = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
    if (typeof data.id === "string" && typeof data.createdAt === "string") {
      return data as RunCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeShopCursor(cursor: string): ShopCursor | null {
  try {
    const data = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
    if (typeof data.id === "string") {
      return data as ShopCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sensitive keys to redact from event payloads (case-insensitive)
 */
const SENSITIVE_KEYS = new Set([
  "prompt",
  "roomurl",
  "providerresponse",
  "headers",
  "authorization",
  "cookies",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "secret",
  "password",
  "token",
]);

/**
 * Recursively redact sensitive keys from payload
 */
function redactPayload(
  payload: unknown,
  visited = new Set<unknown>()
): { value: unknown; wasRedacted: boolean } {
  // Prevent circular references
  if (visited.has(payload)) {
    return { value: payload, wasRedacted: false };
  }

  if (payload === null || payload === undefined) {
    return { value: payload, wasRedacted: false };
  }

  if (typeof payload !== "object") {
    // Truncate large strings
    if (typeof payload === "string" && payload.length > 5000) {
      return {
        value: payload.slice(0, 5000),
        wasRedacted: true,
      };
    }
    return { value: payload, wasRedacted: false };
  }

  visited.add(payload);

  if (Array.isArray(payload)) {
    // Truncate large arrays
    const truncated = payload.length > 100;
    const items = truncated ? payload.slice(0, 50) : payload;
    let anyRedacted = truncated;

    const result = items.map((item) => {
      const { value, wasRedacted } = redactPayload(item, visited);
      if (wasRedacted) anyRedacted = true;
      return value;
    });

    if (truncated) {
      return {
        value: [...result, { __monitor_truncated: true, originalLength: payload.length }],
        wasRedacted: true,
      };
    }

    return { value: result, wasRedacted: anyRedacted };
  }

  // Object
  const obj = payload as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  let anyRedacted = false;

  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(keyLower)) {
      anyRedacted = true;
      // Skip this key entirely (don't add to result)
      continue;
    }

    const { value: redactedValue, wasRedacted } = redactPayload(value, visited);
    if (wasRedacted) anyRedacted = true;
    result[key] = redactedValue;
  }

  if (anyRedacted) {
    result.__monitor_redacted = true;
  }

  return { value: result, wasRedacted: anyRedacted };
}

/**
 * External runs list types
 */
export interface ExternalRunsFilters {
  status?: string;
  shopId?: string;
}

export interface ExternalRunsListItem {
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

export interface ExternalRunsListResponse {
  runs: ExternalRunsListItem[];
  cursor: string | null;
  total?: number;
}

/**
 * Get paginated list of runs for external API (cursor-based).
 */
export async function getRunsExternal(
  filters: ExternalRunsFilters = {},
  cursor: string | null,
  limit: number = 20,
  includeTotal: boolean = false
): Promise<ExternalRunsListResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (filters.status) {
    where.status = fromRunStatusFilter(filters.status);
  }
  if (filters.shopId) {
    where.shopId = filters.shopId;
  }

  // Cursor-based pagination: createdAt DESC, id DESC
  let decodedCursor: RunCursor | null = null;
  if (cursor) {
    decodedCursor = decodeRunCursor(cursor);
    if (decodedCursor) {
      where.OR = [
        { createdAt: { lt: new Date(decodedCursor.createdAt) } },
        {
          createdAt: { equals: new Date(decodedCursor.createdAt) },
          id: { lt: decodedCursor.id },
        },
      ];
    }
  }

  const runsPromise = prisma.compositeRun.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1, // Fetch one extra to detect if there's a next page
    include: {
      shop: {
        select: { shopDomain: true },
      },
      productAsset: {
        select: { productTitle: true, productId: true },
      },
    },
  });

  const totalPromise = includeTotal
    ? prisma.compositeRun.count({
        where: {
          ...(filters.status ? { status: fromRunStatusFilter(filters.status) } : {}),
          ...(filters.shopId ? { shopId: filters.shopId } : {}),
        },
      })
    : Promise.resolve(undefined);

  const [runs, total] = await Promise.all([runsPromise, totalPromise]);

  const hasMore = runs.length > limit;
  const items = hasMore ? runs.slice(0, limit) : runs;

  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor({
          id: items[items.length - 1].id,
          createdAt: items[items.length - 1].createdAt.toISOString(),
        })
      : null;

  const response: ExternalRunsListResponse = {
    runs: items.map((run: typeof items[number]) => ({
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      shopId: run.shopId,
      shopDomain: run.shop.shopDomain,
      productTitle: run.productAsset?.productTitle || null,
      productId: run.productAsset?.productId || null,
      status: toRunStatusV1(run.status),
      pipelineConfigHash: run.pipelineConfigHash,
      totalDurationMs: run.totalDurationMs,
      variantCount: 8,
      successCount: run.successCount,
      failCount: run.failCount,
      timeoutCount: run.timeoutCount,
      traceId: run.traceId,
    })),
    cursor: nextCursor,
  };

  if (includeTotal && total !== undefined) {
    response.total = total;
  }

  return response;
}

/**
 * External run detail type (omits sensitive data when not revealed)
 */
export interface ExternalRunDetail {
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
  variants: {
    id: string;
    variantId: string;
    status: string;
    latencyMs: number | null;
    providerMs: number | null;
    uploadMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    imageUrl: string | null;
    imageRef: string | null;
    imageHash: string | null;
  }[];
  // LLM calls (summarized unless revealed)
  llmCalls: LLMCallSummaryV1[];
  // Only included if revealEnabled
  resolvedFactsSnapshot?: Record<string, unknown>;
  placementSetSnapshot?: Record<string, unknown>;
  pipelineConfigSnapshot?: Record<string, unknown>;
}

/**
 * Get run detail for external API (redacts sensitive data unless revealed).
 */
export async function getRunDetailExternal(
  runId: string,
  shopId: string | undefined,
  revealEnabled: boolean
): Promise<ExternalRunDetail | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { id: runId };
  if (shopId) {
    where.shopId = shopId;
  }

  const run = await prisma.compositeRun.findFirst({
    where,
    include: {
      shop: {
        select: { shopDomain: true },
      },
      productAsset: {
        select: { productTitle: true, productId: true },
      },
      compositeVariants: {
        orderBy: { variantId: "asc" },
      },
    },
  });

  if (!run) return null;

  // Fetch LLM calls for this run
  const llmCalls = await prisma.lLMCall.findMany({
    where: {
      ownerType: "COMPOSITE_RUN",
      ownerId: runId,
    },
    orderBy: { startedAt: "asc" },
  });

  // Generate signed URLs for variant images (always included)
  const variants = await Promise.all(
    run.compositeVariants.map(async (v: typeof run.compositeVariants[number]) => {
      let imageUrl: string | null = null;
      if (v.imageRef) {
        try {
          imageUrl = await StorageService.getSignedReadUrl(
            v.imageRef,
            60 * 60 * 1000 // 1 hour
          );
        } catch {
          // Ignore URL generation failures
        }
      }

      return {
        id: v.id,
        variantId: v.variantId,
        status: toVariantStatusV1(v.status),
        latencyMs: v.latencyMs,
        providerMs: null,
        uploadMs: null,
        errorCode: v.errorCode,
        errorMessage: v.errorMessage,
        imageUrl,
        imageRef: v.imageRef,
        imageHash: v.imageHash,
      };
    })
  );

  // Format LLM calls
  const formattedCalls: LLMCallSummaryV1[] = llmCalls.map(
    (call: (typeof llmCalls)[number]) => {
    const result: LLMCallSummaryV1 = {
      id: call.id,
      variantId: call.variantId,
      promptKey: call.promptKey,
      status: call.status,
      latencyMs: call.latencyMs,
      tokensIn: call.tokensIn,
      tokensOut: call.tokensOut,
      costEstimate: call.costEstimate?.toString() || null,
      callSummary: call.callSummary as LLMCallSummaryV1["callSummary"],
    };

    if (revealEnabled) {
      result.debugPayload = call.debugPayload as Record<string, unknown>;
      result.outputSummary = call.outputSummary as Record<string, unknown> | undefined;
    }

    return result;
    }
  );

  const result: ExternalRunDetail = {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() || null,
    traceId: run.traceId,
    shopId: run.shopId,
    shopDomain: run.shop.shopDomain,
    productAssetId: run.productAssetId,
    productTitle: run.productAsset?.productTitle || null,
    productId: run.productAsset?.productId || null,
    roomSessionId: run.roomSessionId,
    status: toRunStatusV1(run.status),
    pipelineConfigHash: run.pipelineConfigHash,
    totalDurationMs: run.totalDurationMs,
    successCount: run.successCount,
    failCount: run.failCount,
    timeoutCount: run.timeoutCount,
    variants,
    llmCalls: formattedCalls,
  };

  // Only include snapshots if revealed
  if (revealEnabled) {
    result.resolvedFactsSnapshot = run.resolvedFactsSnapshot as Record<string, unknown>;
    result.placementSetSnapshot = run.placementSetSnapshot as Record<string, unknown>;
    result.pipelineConfigSnapshot = run.pipelineConfigSnapshot as Record<string, unknown>;
  }

  return result;
}

/**
 * External event type
 */
export interface ExternalEvent {
  id: string;
  ts: string;
  source: string;
  type: string;
  severity: string;
  variantId: string | null;
  payload: Record<string, unknown>;
  overflowArtifactId: string | null;
}

/**
 * Get events for external API (redacts sensitive payload keys unless revealed).
 */
export async function getRunEventsExternal(
  runId: string,
  shopId: string | undefined,
  revealEnabled: boolean
): Promise<{ events: ExternalEvent[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { runId };
  if (shopId) {
    where.shopId = shopId;
  }

  const events = await prisma.monitorEvent.findMany({
    where,
    orderBy: { ts: "asc" },
  });

  return {
    events: events.map((e: typeof events[number]) => {
      let payload = e.payload as Record<string, unknown>;

      if (!revealEnabled) {
        const { value } = redactPayload(payload);
        payload = value as Record<string, unknown>;

        // Payload size guard: truncate if >10KB after redaction
        const payloadStr = JSON.stringify(payload);
        if (payloadStr.length > 10000) {
          payload = {
            __monitor_truncated: true,
            message: "Payload too large, truncated for external API",
            originalSize: payloadStr.length,
          };
        }
      }

      return {
        id: e.id,
        ts: e.ts.toISOString(),
        source: e.source,
        type: e.type,
        severity: e.severity,
        variantId: e.variantId,
        payload,
        overflowArtifactId: e.overflowArtifactId,
      };
    }),
  };
}

/**
 * External artifact type
 */
export interface ExternalArtifact {
  id: string;
  /** @deprecated Use createdAt */
  ts: string;
  createdAt: string;
  type: string;
  contentType: string;
  byteSize: number;
  /** @deprecated Use dimensions */
  width: number | null;
  /** @deprecated Use dimensions */
  height: number | null;
  dimensions: { width: number; height: number } | null;
  sha256: string | null;
  url: string | null;
}

/**
 * Artifact types to exclude unless revealed
 */
const SENSITIVE_ARTIFACT_TYPES = new Set([
  "room_input",
  "debug_bundle",
  "provider_payload",
]);

/**
 * Get artifacts for external API (filters sensitive artifacts unless revealed).
 */
export async function getRunArtifactsExternal(
  runId: string,
  shopId: string | undefined,
  revealEnabled: boolean
): Promise<{ artifacts: ExternalArtifact[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { runId };
  if (shopId) {
    where.shopId = shopId;
  }

  const artifacts = await prisma.monitorArtifact.findMany({
    where,
    orderBy: { ts: "asc" },
  });

  // Filter artifacts based on reveal status
  const filtered = revealEnabled
    ? artifacts
    : artifacts.filter((a: typeof artifacts[number]) => {
        // Exclude sensitive types
        if (SENSITIVE_ARTIFACT_TYPES.has(a.type)) return false;
        // Exclude sensitive retention class
        if (a.retentionClass === "sensitive") return false;
        return true;
      });

  // Generate signed URLs for included artifacts
  const withUrls = await Promise.all(
    filtered.map(async (a: typeof filtered[number]) => {
      let url: string | null = null;
      try {
        url = await StorageService.getSignedReadUrl(a.gcsKey, 60 * 60 * 1000);
      } catch {
        // Ignore
      }

      return {
        id: a.id,
        ts: a.ts.toISOString(),
        createdAt: a.ts.toISOString(),
        type: a.type,
        contentType: a.contentType,
        byteSize: a.byteSize,
        width: a.width,
        height: a.height,
        dimensions:
          typeof a.width === "number" && typeof a.height === "number"
            ? { width: a.width, height: a.height }
            : null,
        sha256: a.sha256 ?? null,
        url,
      };
    })
  );

  return { artifacts: withUrls };
}

/**
 * Get single artifact by ID for external API.
 * Hides sensitive artifacts unless revealed.
 */
export async function getArtifactExternal(
  artifactId: string,
  shopId: string | undefined,
  revealEnabled: boolean
): Promise<ExternalArtifact | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { id: artifactId };
  if (shopId) {
    where.shopId = shopId;
  }

  const artifact = await prisma.monitorArtifact.findFirst({ where });
  if (!artifact) return null;

  if (!revealEnabled) {
    if (SENSITIVE_ARTIFACT_TYPES.has(artifact.type)) return null;
    if (artifact.retentionClass === "sensitive") return null;
  }

  let url: string | null = null;
  try {
    url = await StorageService.getSignedReadUrl(artifact.gcsKey, 60 * 60 * 1000);
  } catch {
    // Ignore
  }

  return {
    id: artifact.id,
    ts: artifact.ts.toISOString(),
    createdAt: artifact.ts.toISOString(),
    type: artifact.type,
    contentType: artifact.contentType,
    byteSize: artifact.byteSize,
    width: artifact.width,
    height: artifact.height,
    dimensions:
      typeof artifact.width === "number" && typeof artifact.height === "number"
        ? { width: artifact.width, height: artifact.height }
        : null,
    sha256: artifact.sha256 ?? null,
    url,
  };
}

/**
 * External shop list item
 */
export interface ExternalShopListItem {
  shopId: string;
  shopDomain: string;
  runsInWindow: number;
  successRateInWindow: number;
  lastRunAt: string | null;
}

/**
 * Get paginated list of shops for external API.
 */
export async function getShopsExternal(
  cursor: string | null,
  limit: number = 50,
  windowDays: number = 7,
  includeTotal: boolean = false
): Promise<{ shops: ExternalShopListItem[]; cursor: string | null; total?: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  // Cursor-based pagination by id ASC
  let decodedCursor: ShopCursor | null = null;
  if (cursor) {
    decodedCursor = decodeShopCursor(cursor);
    if (decodedCursor) {
      where.id = { gt: decodedCursor.id };
    }
  }

  const shopsPromise = prisma.shop.findMany({
    where,
    orderBy: { id: "asc" },
    take: limit + 1,
    select: { id: true, shopDomain: true },
  });

  const totalPromise = includeTotal
    ? prisma.shop.count()
    : Promise.resolve(undefined);

  const [shops, total] = await Promise.all([shopsPromise, totalPromise]);

  const hasMore = shops.length > limit;
  const items = hasMore ? shops.slice(0, limit) : shops;

  if (items.length === 0) {
    const response: { shops: ExternalShopListItem[]; cursor: string | null; total?: number } = {
      shops: [],
      cursor: null,
    };
    if (includeTotal && total !== undefined) {
      response.total = total;
    }
    return response;
  }

  // Get shop IDs for aggregate query
  const shopIds = items.map((s: typeof items[number]) => s.id);
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Single aggregate query for all shops
  const aggregates = await prisma.compositeRun.groupBy({
    by: ["shopId"],
    where: {
      shopId: { in: shopIds },
      createdAt: { gte: windowStart },
    },
    _count: { _all: true },
    _max: { createdAt: true },
  });

  // Count successes separately (Prisma groupBy doesn't support conditional counts)
  const successCounts = await prisma.compositeRun.groupBy({
    by: ["shopId"],
    where: {
      shopId: { in: shopIds },
      createdAt: { gte: windowStart },
      status: "COMPLETE",
    },
    _count: { _all: true },
  });

  // Build lookup maps
  const aggregateMap = new Map<string, { total: number; lastRunAt: Date | null }>();
  for (const agg of aggregates) {
    aggregateMap.set(agg.shopId, {
      total: agg._count._all,
      lastRunAt: agg._max.createdAt,
    });
  }

  const successMap = new Map<string, number>();
  for (const sc of successCounts) {
    successMap.set(sc.shopId, sc._count._all);
  }

  // Build response
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor({ id: items[items.length - 1].id })
      : null;

  const response: { shops: ExternalShopListItem[]; cursor: string | null; total?: number } = {
    shops: items.map((shop: typeof items[number]) => {
      const agg = aggregateMap.get(shop.id);
      const successCount = successMap.get(shop.id) || 0;
      const totalRuns = agg?.total || 0;

      return {
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        runsInWindow: totalRuns,
        successRateInWindow: totalRuns > 0 ? (successCount / totalRuns) * 100 : 0,
        lastRunAt: agg?.lastRunAt?.toISOString() || null,
      };
    }),
    cursor: nextCursor,
  };

  if (includeTotal && total !== undefined) {
    response.total = total;
  }

  return response;
}

/**
 * Normalize error message for grouping
 */
function normalizeErrorMessage(message: string): string {
  return message
    .toLowerCase()
    .trim()
    .replace(/\d+/g, "#") // Replace digits with #
    .replace(/[a-f0-9-]{36}/gi, "{uuid}") // Replace UUIDs
    .replace(/\s+/g, " ") // Collapse whitespace
    .slice(0, 80); // Limit length
}

/**
 * External shop detail
 */
export interface ExternalShopDetail {
  shop: {
    shopId: string;
    shopDomain: string;
    plan: string;
    createdAt: string;
  };
  recentRuns: ExternalRunsListItem[];
  topErrors: { message: string; count: number }[];
  health: HealthStatsV1;
}

/**
 * Get shop detail for external API.
 */
export async function getShopDetailExternal(
  shopId: string,
  recentRunsLimit: number = 10
): Promise<ExternalShopDetail | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      createdAt: true,
    },
  });

  if (!shop) return null;

  // Get recent runs
  const recentRuns = await prisma.compositeRun.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: recentRunsLimit,
    include: {
      shop: {
        select: { shopDomain: true },
      },
      productAsset: {
        select: { productTitle: true, productId: true },
      },
    },
  });

  // Get top errors from recent failed runs
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failedVariants = await prisma.compositeVariant.findMany({
    where: {
      compositeRun: { shopId },
      status: "FAILED",
      createdAt: { gte: oneDayAgo },
      errorMessage: { not: null },
    },
    select: { errorMessage: true },
  });

  // Group and count errors
  const errorCounts = new Map<string, number>();
  for (const v of failedVariants) {
    if (v.errorMessage) {
      const normalized = normalizeErrorMessage(v.errorMessage);
      errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
    }
  }

  const topErrors = Array.from(errorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));

  // Get health stats
  const health = await getHealthStats(shopId);

  return {
    shop: {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      plan: shop.plan,
      createdAt: shop.createdAt.toISOString(),
    },
    recentRuns: recentRuns.map((run: typeof recentRuns[number]) => ({
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      shopId: run.shopId,
      shopDomain: run.shop.shopDomain,
      productTitle: run.productAsset?.productTitle || null,
      productId: run.productAsset?.productId || null,
      status: toRunStatusV1(run.status),
      pipelineConfigHash: run.pipelineConfigHash,
      totalDurationMs: run.totalDurationMs,
      variantCount: 8,
      successCount: run.successCount,
      failCount: run.failCount,
      timeoutCount: run.timeoutCount,
      traceId: run.traceId,
    })),
    topErrors,
    health,
  };
}

/**
 * External health stats response
 */
export interface ExternalHealthStats {
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

/**
 * Get global health stats for external API.
 */
export async function getHealthStatsExternal(): Promise<ExternalHealthStats> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    total1h,
    failed1h,
    total24h,
    failed24h,
    latencyData,
    providerErrors,
    storageErrors,
  ] = await Promise.all([
    prisma.compositeRun.count({
      where: { createdAt: { gte: oneHourAgo } },
    }),
    prisma.compositeRun.count({
      where: { createdAt: { gte: oneHourAgo }, status: "FAILED" },
    }),
    prisma.compositeRun.count({
      where: { createdAt: { gte: oneDayAgo } },
    }),
    prisma.compositeRun.count({
      where: { createdAt: { gte: oneDayAgo }, status: "FAILED" },
    }),
    prisma.compositeRun.findMany({
      where: {
        createdAt: { gte: oneDayAgo },
        totalDurationMs: { not: null },
      },
      select: { totalDurationMs: true },
      orderBy: { totalDurationMs: "asc" },
    }),
    prisma.monitorEvent.count({
      where: {
        ts: { gte: oneDayAgo },
        type: "error",
        source: "provider",
      },
    }),
    prisma.monitorEvent.count({
      where: {
        ts: { gte: oneDayAgo },
        type: "error",
        source: "storage",
      },
    }),
  ]);

  // Calculate percentiles
  let latencyP50: number | null = null;
  let latencyP95: number | null = null;

  if (latencyData.length > 0) {
    const durations = latencyData
      .map((r: typeof latencyData[number]) => r.totalDurationMs)
      .filter((d: number | null): d is number => d !== null);

    if (durations.length > 0) {
      latencyP50 = durations[Math.floor(durations.length * 0.5)];
      latencyP95 = durations[Math.floor(durations.length * 0.95)];
    }
  }

  const failureRate1h = total1h > 0 ? (failed1h / total1h) * 100 : 0;
  const failureRate24h = total24h > 0 ? (failed24h / total24h) * 100 : 0;

  // Determine overall status
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (failureRate1h > 50 || failureRate24h > 30) {
    status = "unhealthy";
  } else if (failureRate1h > 10 || failureRate24h > 5) {
    status = "degraded";
  }

  return {
    status,
    failureRate1h,
    failureRate24h,
    totalRuns1h: total1h,
    totalRuns24h: total24h,
    latencyP50,
    latencyP95,
    providerErrors24h: providerErrors,
    storageErrors24h: storageErrors,
  };
}
