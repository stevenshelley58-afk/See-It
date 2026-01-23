"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertCircle, CheckCircle, AlertTriangle } from "lucide-react";
import { getHealth, queryKeys } from "@/lib/api";
import { cn, formatLatency, formatPercent, formatRelativeTime } from "@/lib/utils";
import {
  Shell,
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  StatCard,
  Badge,
} from "@/components/layout/shell";
import type { HealthResponse } from "@/lib/types";

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

export default function ControlRoom() {
  const {
    data: health,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.health,
    queryFn: getHealth,
    refetchInterval: 30000, // 30 seconds
  });

  return (
    <Shell>
      <PageHeader
        title="Control Room"
        description="System health and activity overview"
      >
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          Refresh
        </button>
      </PageHeader>

      {/* Health Status Card */}
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
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : isError ? (
              <div className="flex items-center gap-3 p-4 bg-red-50 rounded-md">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                <div>
                  <p className="font-medium text-red-800">
                    Failed to fetch health status
                  </p>
                  <p className="text-sm text-red-600">
                    {(error as Error)?.message || "Unknown error"}
                  </p>
                </div>
              </div>
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
                    Last checked: {formatRelativeTime(health.timestamp)}
                    {health.version && ` • Version: ${health.version}`}
                  </p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Failure Rate (1h)"
          value={
            health?.metrics?.failure_rate_1h !== undefined
              ? formatPercent(health.metrics.failure_rate_1h)
              : "—"
          }
          subtitle="Last hour"
        />
        <StatCard
          label="Failure Rate (24h)"
          value={
            health?.metrics?.failure_rate_24h !== undefined
              ? formatPercent(health.metrics.failure_rate_24h)
              : "—"
          }
          subtitle="Last 24 hours"
        />
        <StatCard
          label="Latency P50"
          value={
            health?.metrics?.latency_p50_ms !== undefined
              ? formatLatency(health.metrics.latency_p50_ms)
              : "—"
          }
          subtitle="Median response time"
        />
        <StatCard
          label="Latency P95"
          value={
            health?.metrics?.latency_p95_ms !== undefined
              ? formatLatency(health.metrics.latency_p95_ms)
              : "—"
          }
          subtitle="95th percentile"
        />
      </div>

      {/* Recent Errors */}
      {health?.metrics?.recent_errors && health.metrics.recent_errors.length > 0 && (
        <div className="mb-6">
          <Card>
            <CardHeader
              title="Recent Errors"
              description="Top 5 errors in the last 24 hours"
            />
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {health.metrics.recent_errors.slice(0, 5).map((err, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {err.error}
                      </p>
                      <p className="text-xs text-gray-500">
                        Last seen: {formatRelativeTime(err.last_seen)}
                      </p>
                    </div>
                    <Badge variant="error">{err.count} occurrences</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Placeholder Cards for Stage 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Recent Runs" description="Latest render runs" />
          <CardContent>
            <div className="flex items-center justify-center py-8 text-gray-400">
              <p className="text-sm">Coming in Stage 2</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Shop Activity" description="Active shops overview" />
          <CardContent>
            <div className="flex items-center justify-center py-8 text-gray-400">
              <p className="text-sm">Coming in Stage 2</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
