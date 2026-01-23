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
} from "./types";

const DEFAULT_PAGE_SIZE = 20;

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
    where.status = filters.status;
  }
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = filters.dateFrom;
    if (filters.dateTo) where.createdAt.lte = filters.dateTo;
  }
  if (filters.promptVersion) {
    where.promptPackVersion = filters.promptVersion;
  }
  if (filters.model) {
    where.model = filters.model;
  }
  if (filters.requestId) {
    where.requestId = filters.requestId;
  }
  if (filters.productId) {
    where.productAsset = { productId: filters.productId };
  }

  const [runs, total] = await Promise.all([
    prisma.renderRun.findMany({
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
    prisma.renderRun.count({ where }),
  ]);

  return {
    runs: runs.map((run: typeof runs[number]) => ({
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      productTitle: run.productAsset?.productTitle || null,
      productId: run.productAsset?.productId || null,
      status: run.status,
      promptPackVersion: run.promptPackVersion,
      model: run.model,
      totalDurationMs: run.totalDurationMs,
      variantCount: 8, // Always 8 variants
      successCount: run.successCount,
      failCount: run.failCount,
      timeoutCount: run.timeoutCount,
      requestId: run.requestId,
      traceId: run.traceId,
    })),
    total,
    page: pagination.page,
    pages: Math.ceil(total / pagination.limit),
  };
}

/**
 * Get full run detail with variants and signed URLs.
 */
export async function getRunDetail(
  runId: string,
  shopId: string
): Promise<RunDetailV1 | null> {
  const run = await prisma.renderRun.findFirst({
    where: { id: runId, shopId },
    include: {
      productAsset: {
        select: { productTitle: true, productId: true },
      },
      variantResults: {
        orderBy: { variantId: "asc" },
      },
    },
  });

  if (!run) return null;

  // Generate signed URLs for variant images
  const variants = await Promise.all(
    run.variantResults.map(async (v: typeof run.variantResults[number]) => {
      let imageUrl: string | null = null;
      if (v.outputImageKey) {
        try {
          imageUrl = await StorageService.getSignedReadUrl(
            v.outputImageKey,
            60 * 60 * 1000 // 1 hour
          );
        } catch {
          // Ignore URL generation failures
        }
      }

      return {
        id: v.id,
        variantId: v.variantId,
        status: v.status,
        latencyMs: v.latencyMs,
        providerMs: v.providerMs,
        uploadMs: v.uploadMs,
        errorCode: v.errorCode,
        errorMessage: v.errorMessage,
        imageUrl,
        outputImageKey: v.outputImageKey,
      };
    })
  );

  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() || null,
    requestId: run.requestId,
    traceId: run.traceId,
    shopId: run.shopId,
    productAssetId: run.productAssetId,
    productTitle: run.productAsset?.productTitle || null,
    productId: run.productAsset?.productId || null,
    roomSessionId: run.roomSessionId,
    status: run.status,
    promptPackVersion: run.promptPackVersion,
    model: run.model,
    totalDurationMs: run.totalDurationMs,
    successCount: run.successCount,
    failCount: run.failCount,
    timeoutCount: run.timeoutCount,
    telemetryDropped: run.telemetryDropped,
    variants,
    resolvedFactsJson: run.resolvedFactsJson as Record<string, unknown>,
    promptPackJson: run.promptPackJson as Record<string, unknown>,
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
    telemetryDropped24h,
    latencyData,
  ] = await Promise.all([
    prisma.renderRun.count({
      where: { shopId, createdAt: { gte: oneHourAgo } },
    }),
    prisma.renderRun.count({
      where: { shopId, createdAt: { gte: oneHourAgo }, status: "failed" },
    }),
    prisma.renderRun.count({
      where: { shopId, createdAt: { gte: oneDayAgo } },
    }),
    prisma.renderRun.count({
      where: { shopId, createdAt: { gte: oneDayAgo }, status: "failed" },
    }),
    prisma.renderRun.count({
      where: { shopId, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.renderRun.count({
      where: { shopId, createdAt: { gte: sevenDaysAgo }, status: "failed" },
    }),
    prisma.renderRun.count({
      where: { shopId, createdAt: { gte: oneDayAgo }, telemetryDropped: true },
    }),
    prisma.renderRun.findMany({
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
    telemetryDropped24h: telemetryDropped24h,
  };
}
