"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Activity,
  Store,
  Clock,
} from "lucide-react";
import { getHealth, getRuns, getShops, queryKeys } from "@/lib/api";
import {
  formatLatency,
  formatDuration,
  formatRelativeTime,
  getRunStatusVariant,
} from "@/lib/utils";
import {
  Shell,
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  StatCard,
  Badge,
} from "@/components/layout/shell";
import type { HealthResponse, RunListItem, ShopListItem } from "@/lib/types";

// =============================================================================
// Status helpers
// =============================================================================

function getStatusVariant(
  status: HealthResponse["status"]
): "success" | "warning" | "error" {
  switch (status) {
    case "healthy":
      return "success";
    case "degraded":
      return "warning";
    case "unhealthy":
      return "error";
  }
}

function StatusIcon({ status }: { status: HealthResponse["status"] }) {
  switch (status) {
    case "healthy":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "degraded":
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case "unhealthy":
      return <AlertCircle className="h-5 w-5 text-red-500" />;
  }
}

// =============================================================================
// Loading skeleton components
// =============================================================================

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent>
        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-2" />
        <div className="h-8 w-16 bg-gray-200 rounded animate-pulse mb-1" />
        <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
      </CardContent>
    </Card>
  );
}

function RunRowSkeleton() {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="h-3 w-32 bg-gray-100 rounded animate-pulse" />
      </div>
      <div className="h-5 w-16 bg-gray-200 rounded-full animate-pulse" />
    </div>
  );
}

function ShopRowSkeleton() {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className="h-4 w-36 bg-gray-200 rounded animate-pulse" />
        <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
      </div>
      <div className="h-5 w-20 bg-gray-200 rounded-full animate-pulse" />
    </div>
  );
}

// =============================================================================
// Error panel component
// =============================================================================

function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      <AlertCircle className="h-8 w-8 text-red-400 mb-3" />
      <p className="font-medium text-red-800 text-center">{title}</p>
      <p className="text-sm text-red-600 text-center mt-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 text-sm font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Helper to sort shops by worst success rate
// =============================================================================

function sortShopsByWorstRate(shops: ShopListItem[]): ShopListItem[] {
  return [...shops].sort((a, b) => {
    // Shops with runs come first, sorted by worst success rate
    if (a.runsInWindow === 0 && b.runsInWindow === 0) return 0;
    if (a.runsInWindow === 0) return 1; // Push no-runs to end
    if (b.runsInWindow === 0) return -1;
    return a.successRateInWindow - b.successRateInWindow; // Lower success = worse = first
  });
}

// =============================================================================
// Helper to format percentage (values already 0-100 from backend)
// =============================================================================

function formatPercentFromBackend(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

// =============================================================================
// Main Control Room component
// =============================================================================

export default function ControlRoom() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Health query - refresh every 30s when auto-refresh is on
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: getHealth,
    refetchInterval: autoRefresh ? 30000 : false,
  });

  // Runs query - refresh every 5s when auto-refresh is on
  const runsQuery = useQuery({
    queryKey: queryKeys.runs.list({ limit: 20 }),
    queryFn: () => getRuns({ limit: 20 }),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  // Shops query - refresh every 5s when auto-refresh is on
  const shopsQuery = useQuery({
    queryKey: queryKeys.shops.list({ limit: 10, windowDays: 1 }),
    queryFn: () => getShops({ limit: 10, windowDays: 1 }),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const health = healthQuery.data;
  const runs = runsQuery.data?.runs ?? [];
  const shops = shopsQuery.data?.shops ?? [];
  const sortedShops = sortShopsByWorstRate(shops);

  // Count failed runs for error summary
  const failedRunsCount = runs.filter((r) => r.failCount > 0).length;

  return (
    <Shell>
      {/* Header with auto-refresh toggle */}
      <PageHeader
        title="Control Room"
        description="System health and activity overview"
      >
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            autoRefresh
              ? "bg-green-100 text-green-700 hover:bg-green-200"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          <RefreshCw
            className={`h-4 w-4 ${
              autoRefresh && (healthQuery.isFetching || runsQuery.isFetching || shopsQuery.isFetching)
                ? "animate-spin"
                : ""
            }`}
          />
          {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
        </button>
      </PageHeader>

      {/* System Status Banner */}
      <div className="mb-6">
        <Card>
          <CardHeader
            title="System Health"
            action={
              health && (
                <Badge variant={getStatusVariant(health.status)}>
                  {health.status.charAt(0).toUpperCase() + health.status.slice(1)}
                </Badge>
              )
            }
          />
          <CardContent>
            {healthQuery.isLoading ? (
              <div className="flex items-center justify-center py-4">
                <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : healthQuery.isError ? (
              <ErrorPanel
                title="Failed to fetch health status"
                message={(healthQuery.error as Error)?.message || "Unknown error"}
                onRetry={() => healthQuery.refetch()}
              />
            ) : health ? (
              <div className="flex items-center gap-4">
                <StatusIcon status={health.status} />
                <div>
                  <p className="font-medium text-gray-900">
                    {health.status === "healthy"
                      ? "All systems operational"
                      : health.status === "degraded"
                      ? "Some systems experiencing issues"
                      : "Critical systems down"}
                  </p>
                  <p className="text-sm text-gray-500">
                    {health.totalRuns1h} runs in last hour
                    {health.totalRuns24h > 0 && ` • ${health.totalRuns24h} runs in last 24h`}
                  </p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {healthQuery.isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Failure Rate (1h)"
              value={
                health?.failureRate1h !== undefined
                  ? formatPercentFromBackend(health.failureRate1h)
                  : "—"
              }
              subtitle={`${health?.totalRuns1h ?? 0} total runs`}
            />
            <StatCard
              label="Failure Rate (24h)"
              value={
                health?.failureRate24h !== undefined
                  ? formatPercentFromBackend(health.failureRate24h)
                  : "—"
              }
              subtitle={`${health?.totalRuns24h ?? 0} total runs`}
            />
            <StatCard
              label="Latency P50"
              value={
                health?.latencyP50 !== null && health?.latencyP50 !== undefined
                  ? formatLatency(health.latencyP50)
                  : "—"
              }
              subtitle="Median response time"
            />
            <StatCard
              label="Latency P95"
              value={
                health?.latencyP95 !== null && health?.latencyP95 !== undefined
                  ? formatLatency(health.latencyP95)
                  : "—"
              }
              subtitle="95th percentile"
            />
          </>
        )}
      </div>

      {/* Live Feed and Hot Shops Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Live Feed - Recent Runs */}
        <Card>
          <CardHeader
            title="Live Feed"
            description="Last 20 render runs"
            action={
              <Link
                href="/runs"
                className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                View all <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
          <CardContent className="p-0">
            {runsQuery.isLoading ? (
              <div className="divide-y divide-gray-100">
                {[...Array(5)].map((_, i) => (
                  <RunRowSkeleton key={i} />
                ))}
              </div>
            ) : runsQuery.isError ? (
              <ErrorPanel
                title="Failed to load runs"
                message={(runsQuery.error as Error)?.message || "Unknown error"}
                onRetry={() => runsQuery.refetch()}
              />
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <Activity className="h-8 w-8 mb-2" />
                <p className="text-sm">No recent runs</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                {runs.map((run) => (
                  <Link
                    key={run.id}
                    href={`/runs/${run.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 truncate">
                          {run.shopDomain.replace(".myshopify.com", "")}
                        </span>
                        {run.productTitle && (
                          <span className="text-gray-400 text-sm truncate hidden sm:inline">
                            • {run.productTitle}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(run.createdAt)}
                        {run.totalDurationMs !== null && (
                          <span>• {formatDuration(run.totalDurationMs)}</span>
                        )}
                        <span>
                          • {run.successCount}/{run.variantCount} variants
                        </span>
                      </div>
                    </div>
                    <Badge variant={getRunStatusVariant(run.status)}>
                      {run.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hot Shops - Worst performing */}
        <Card>
          <CardHeader
            title="Hot Shops"
            description="Shops with lowest success rate (24h)"
            action={
              <Link
                href="/shops"
                className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                View all <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
          <CardContent className="p-0">
            {shopsQuery.isLoading ? (
              <div className="divide-y divide-gray-100">
                {[...Array(5)].map((_, i) => (
                  <ShopRowSkeleton key={i} />
                ))}
              </div>
            ) : shopsQuery.isError ? (
              <ErrorPanel
                title="Failed to load shops"
                message={(shopsQuery.error as Error)?.message || "Unknown error"}
                onRetry={() => shopsQuery.refetch()}
              />
            ) : sortedShops.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <Store className="h-8 w-8 mb-2" />
                <p className="text-sm">No active shops</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                {sortedShops.map((shop) => (
                  <Link
                    key={shop.shopId}
                    href={`/shops/${shop.shopId}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {shop.shopDomain.replace(".myshopify.com", "")}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {shop.runsInWindow} runs
                        {shop.lastRunAt && (
                          <> • Last: {formatRelativeTime(shop.lastRunAt)}</>
                        )}
                      </p>
                    </div>
                    <Badge
                      variant={
                        shop.runsInWindow === 0
                          ? "default"
                          : shop.successRateInWindow >= 90
                          ? "success"
                          : shop.successRateInWindow >= 70
                          ? "warning"
                          : "error"
                      }
                    >
                      {shop.runsInWindow === 0
                        ? "No runs"
                        : `${shop.successRateInWindow.toFixed(0)}% success`}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Error Summary Card */}
      <Card>
        <CardHeader
          title="Error Summary"
          description="Runs with failures in recent feed"
        />
        <CardContent>
          {runsQuery.isLoading ? (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : failedRunsCount === 0 ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-md">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="font-medium text-green-800">No failures detected</p>
                <p className="text-sm text-green-600">
                  All {runs.length} recent runs completed successfully
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-red-50 rounded-md">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                <div>
                  <p className="font-medium text-red-800">
                    {failedRunsCount} runs with failures
                  </p>
                  <p className="text-sm text-red-600">
                    Click on a run in the Live Feed to view error details
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Note: Detailed error messages are available in individual run details.
                The runs list endpoint provides failure counts but not error messages.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
