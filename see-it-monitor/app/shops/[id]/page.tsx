"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Store,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  Settings,
  FileText,
  History,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Shell,
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  Badge,
  CopyButton,
} from "@/components/layout/shell";
import {
  getShop,
  getRuntimeConfig,
  getAuditLog,
  getPrompts,
  queryKeys,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RunListItem, ShopDetail, ApiError } from "@/lib/types";
import type { RuntimeConfigResponse, AuditLogEntry, PromptListResponse } from "@/lib/types-prompt-control";

// =============================================================================
// Utility Functions
// =============================================================================

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getRunStatusVariant(status: string): "default" | "success" | "warning" | "error" {
  switch (status.toLowerCase()) {
    case "complete":
    case "success":
      return "success";
    case "partial":
    case "in_flight":
      return "warning";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

// =============================================================================
// Tabs Component
// =============================================================================

type TabId = "overview" | "config" | "prompts" | "audit";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: TabId;
  onTabChange: (tabId: TabId) => void;
}

function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div className="border-b border-gray-200 mb-6">
      <nav className="-mb-px flex space-x-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// =============================================================================
// Skeleton Components
// =============================================================================

function ShopInfoSkeleton() {
  return (
    <Card className="mb-6">
      <CardContent>
        <div className="animate-pulse space-y-4">
          <div className="flex justify-between">
            <div className="h-6 bg-gray-200 rounded w-48" />
            <div className="h-6 bg-gray-200 rounded w-20" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 bg-gray-200 rounded w-16" />
                <div className="h-5 bg-gray-200 rounded w-24" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardContent className="py-4">
            <div className="animate-pulse space-y-2">
              <div className="h-3 bg-gray-200 rounded w-16" />
              <div className="h-8 bg-gray-200 rounded w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// Error Component
// =============================================================================

interface ErrorPanelProps {
  message: string;
  onRetry: () => void;
}

function ErrorPanel({ message, onRetry }: ErrorPanelProps) {
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
          <p className="text-sm text-gray-600 mb-4">{message}</p>
          <button
            onClick={onRetry}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Health Stats Panel
// =============================================================================

interface HealthStatsPanelProps {
  health: ShopDetail["health"];
}

function HealthStatsPanel({ health }: HealthStatsPanelProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="py-4">
          <p className="text-xs text-gray-500 uppercase">Failure Rate (1h)</p>
          <div className="flex items-center gap-2">
            <p className={cn(
              "text-2xl font-bold",
              health.failureRate1h > 5 ? "text-red-600" : "text-green-600"
            )}>
              {health.failureRate1h.toFixed(1)}%
            </p>
            {health.failureRate1h > 5 ? (
              <TrendingDown className="h-5 w-5 text-red-500" />
            ) : (
              <TrendingUp className="h-5 w-5 text-green-500" />
            )}
          </div>
          <p className="text-xs text-gray-500">{health.totalRuns1h} runs</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-xs text-gray-500 uppercase">Failure Rate (24h)</p>
          <div className="flex items-center gap-2">
            <p className={cn(
              "text-2xl font-bold",
              health.failureRate24h > 5 ? "text-red-600" : "text-green-600"
            )}>
              {health.failureRate24h.toFixed(1)}%
            </p>
          </div>
          <p className="text-xs text-gray-500">{health.totalRuns24h} runs</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-xs text-gray-500 uppercase">Latency (P50)</p>
          <p className="text-2xl font-bold text-gray-900">
            {formatDuration(health.latencyP50)}
          </p>
          <p className="text-xs text-gray-500">P95: {formatDuration(health.latencyP95)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-xs text-gray-500 uppercase">Errors (24h)</p>
          <p className="text-2xl font-bold text-gray-900">
            {health.providerErrors24h + health.storageErrors24h}
          </p>
          <p className="text-xs text-gray-500">
            Provider: {health.providerErrors24h}, Storage: {health.storageErrors24h}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Recent Runs Panel
// =============================================================================

interface RecentRunsPanelProps {
  runs: RunListItem[];
}

function RecentRunsPanel({ runs }: RecentRunsPanelProps) {
  if (runs.length === 0) {
    return (
      <Card className="mb-6">
        <CardHeader title="Recent Runs" />
        <CardContent>
          <p className="text-sm text-gray-500 text-center py-4">No recent runs</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader title="Recent Runs" description={`${runs.length} most recent`} />
      <CardContent className="p-0">
        <div className="divide-y divide-gray-100">
          {runs.slice(0, 10).map((run) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {run.productTitle || "Unknown Product"}
                </p>
                <p className="text-xs text-gray-500">
                  {formatRelativeTime(run.createdAt)}
                </p>
              </div>
              <Badge variant={getRunStatusVariant(run.status)}>
                {run.status}
              </Badge>
              <span className="text-xs text-gray-500">
                {run.successCount}/{run.variantCount}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Top Errors Panel
// =============================================================================

interface TopErrorsPanelProps {
  errors: { message: string; count: number }[];
}

function TopErrorsPanel({ errors }: TopErrorsPanelProps) {
  if (errors.length === 0) {
    return (
      <Card>
        <CardHeader title="Top Errors" />
        <CardContent>
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="h-5 w-5" />
            <p className="text-sm">No errors in the past 24 hours</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Top Errors" description="Most frequent errors (24h)" />
      <CardContent className="p-0">
        <div className="divide-y divide-gray-100">
          {errors.map((error, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              <p className="text-sm text-gray-700 flex-1 truncate">{error.message}</p>
              <Badge variant="error">{error.count}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Runtime Config Panel
// =============================================================================

interface RuntimeConfigPanelProps {
  shopId: string;
}

function RuntimeConfigPanel({ shopId }: RuntimeConfigPanelProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.shops.runtimeConfig(shopId),
    queryFn: () => getRuntimeConfig(shopId),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Runtime Configuration" />
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex justify-between">
                <div className="h-4 bg-gray-200 rounded w-32" />
                <div className="h-4 bg-gray-200 rounded w-24" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return <ErrorPanel message="Failed to load runtime config" onRetry={() => refetch()} />;
  }

  if (!data) return null;

  const config = data.config;

  return (
    <Card>
      <CardHeader
        title="Runtime Configuration"
        description={`Last updated: ${formatRelativeTime(config.updatedAt)}`}
      />
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-gray-500 uppercase">Max Concurrency</p>
            <p className="text-lg font-medium">{config.maxConcurrency}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Force Fallback Model</p>
            <p className="text-lg font-medium">{config.forceFallbackModel || "None"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Daily Cost Cap</p>
            <p className="text-lg font-medium">${config.dailyCostCap}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Max Output Tokens</p>
            <p className="text-lg font-medium">{config.maxTokensOutputCap.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Max Image Bytes</p>
            <p className="text-lg font-medium">{(config.maxImageBytesCap / 1024 / 1024).toFixed(1)} MB</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Model Allow List</p>
            <p className="text-lg font-medium">
              {config.modelAllowList.length > 0 ? config.modelAllowList.join(", ") : "Any"}
            </p>
          </div>
        </div>

        {config.disabledPromptNames.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase mb-2">Disabled Prompts</p>
            <div className="flex flex-wrap gap-2">
              {config.disabledPromptNames.map((name) => (
                <Badge key={name} variant="warning">{name}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Prompts Panel
// =============================================================================

interface PromptsPanelProps {
  shopId: string;
}

function PromptsPanel({ shopId }: PromptsPanelProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.prompts.list(shopId),
    queryFn: () => getPrompts(shopId),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Prompts" />
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return <ErrorPanel message="Failed to load prompts" onRetry={() => refetch()} />;
  }

  if (!data || data.prompts.length === 0) {
    return (
      <Card>
        <CardHeader title="Prompts" />
        <CardContent>
          <p className="text-sm text-gray-500 text-center py-4">No custom prompts configured</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Prompts" description={`${data.prompts.length} prompt(s) configured`} />
      <CardContent className="p-0">
        <div className="divide-y divide-gray-100">
          {data.prompts.map((prompt) => (
            <div key={prompt.name} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{prompt.name}</p>
                <p className="text-xs text-gray-500">
                  v{prompt.activeVersion?.version ?? "N/A"} &middot; {prompt.activeVersion?.model ?? prompt.defaultModel}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={!prompt.isDisabled ? "success" : "default"}>
                  {!prompt.isDisabled ? "Active" : "Disabled"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Audit Log Panel
// =============================================================================

interface AuditLogPanelProps {
  shopId: string;
}

function AuditLogPanel({ shopId }: AuditLogPanelProps) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: queryKeys.shops.auditLog(shopId, {}),
    queryFn: ({ pageParam }) => getAuditLog(shopId, { limit: 20, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  const toggleEntry = (id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Audit Log" />
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return <ErrorPanel message="Failed to load audit log" onRetry={() => refetch()} />;
  }

  const entries = data?.pages.flatMap((page) => page.entries) ?? [];

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader title="Audit Log" />
        <CardContent>
          <p className="text-sm text-gray-500 text-center py-4">No audit entries</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Audit Log" description="Configuration change history" />
      <CardContent className="p-0">
        <div className="divide-y divide-gray-100">
          {entries.map((entry) => {
            const isExpanded = expandedEntries.has(entry.id);
            return (
              <div key={entry.id}>
                <button
                  onClick={() => toggleEntry(entry.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
                >
                  {entry.changes ? (
                    isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  <span className="text-xs text-gray-400 w-24 shrink-0">
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                  <Badge className="shrink-0">{entry.action}</Badge>
                  <span className="text-sm text-gray-700 truncate flex-1">
                    {entry.targetType}: {entry.targetName || entry.targetId}
                  </span>
                  <span className="text-xs text-gray-500 shrink-0">{entry.actor}</span>
                </button>
                {isExpanded && entry.changes && (
                  <div className="px-4 pb-3 pl-10">
                    <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-48">
                      {JSON.stringify(entry.changes, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {hasNextPage && (
          <div className="flex justify-center py-4 border-t border-gray-100">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              {isFetchingNextPage ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                "Load more"
              )}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function ShopDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabId>("overview");

  // Shop detail query
  const shopQuery = useQuery({
    queryKey: queryKeys.shops.detail(id),
    queryFn: () => getShop(id),
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.shops.detail(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.shops.runtimeConfig(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.shops.auditLog(id, {}) });
    queryClient.invalidateQueries({ queryKey: queryKeys.prompts.list(id) });
  };

  const shop = shopQuery.data;
  const isRefreshing = shopQuery.isFetching;

  const tabs: Tab[] = [
    { id: "overview", label: "Overview", icon: <Store className="h-4 w-4" /> },
    { id: "config", label: "Runtime Config", icon: <Settings className="h-4 w-4" /> },
    { id: "prompts", label: "Prompts", icon: <FileText className="h-4 w-4" /> },
    { id: "audit", label: "Audit Log", icon: <History className="h-4 w-4" /> },
  ];

  return (
    <Shell>
      {/* Back Link */}
      <div className="mb-4">
        <Link
          href="/shops"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Shops
        </Link>
      </div>

      {/* Header */}
      <PageHeader
        title={shop ? shop.shop.shopDomain.replace(".myshopify.com", "") : "Shop Details"}
        description={shop ? `Plan: ${shop.shop.plan} • Connected: ${formatRelativeTime(shop.shop.createdAt)}` : "Loading..."}
      >
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md",
            "text-gray-700 bg-white border border-gray-300",
            "hover:bg-gray-50 disabled:opacity-50"
          )}
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          Refresh
        </button>
      </PageHeader>

      {/* Shop Info Card */}
      {shopQuery.isLoading ? (
        <ShopInfoSkeleton />
      ) : shopQuery.isError ? (
        <ErrorPanel
          message="Failed to load shop details"
          onRetry={() => shopQuery.refetch()}
        />
      ) : shop ? (
        <Card className="mb-6">
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Store className="h-6 w-6 text-gray-400" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {shop.shop.shopDomain}
                  </h2>
                  <p className="text-xs text-gray-500 font-mono">{shop.shop.shopId}</p>
                </div>
              </div>
              <CopyButton value={shop.shop.shopId} label="Copy ID" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase">Plan</p>
                <Badge>{shop.shop.plan}</Badge>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Connected</p>
                <p className="text-sm text-gray-900">{formatRelativeTime(shop.shop.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Total Runs (7d)</p>
                <p className="text-sm text-gray-900">{shop.health.totalRuns7d.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Failure Rate (7d)</p>
                <p className={cn(
                  "text-sm font-medium",
                  shop.health.failureRate7d > 5 ? "text-red-600" : "text-green-600"
                )}>
                  {shop.health.failureRate7d.toFixed(1)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Content */}
      {activeTab === "overview" && shop && (
        <>
          <HealthStatsPanel health={shop.health} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentRunsPanel runs={shop.recentRuns} />
            <TopErrorsPanel errors={shop.topErrors} />
          </div>
        </>
      )}

      {activeTab === "overview" && shopQuery.isLoading && (
        <>
          <StatsSkeleton />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card><CardContent><div className="h-64 animate-pulse bg-gray-100 rounded" /></CardContent></Card>
            <Card><CardContent><div className="h-64 animate-pulse bg-gray-100 rounded" /></CardContent></Card>
          </div>
        </>
      )}

      {activeTab === "config" && <RuntimeConfigPanel shopId={id} />}

      {activeTab === "prompts" && <PromptsPanel shopId={id} />}

      {activeTab === "audit" && <AuditLogPanel shopId={id} />}
    </Shell>
  );
}
