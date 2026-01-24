"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  FileText,
  Plus,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  ChevronRight,
  PowerOff,
  Store,
} from "lucide-react";
import {
  Shell,
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  Badge,
} from "@/components/layout/shell";
import { cn, formatLatency, formatRelativeTime } from "@/lib/utils";
import { getPrompts, getShops, queryKeys } from "@/lib/api";
import type { PromptSummary } from "@/lib/types-prompt-control";

// =============================================================================
// Constants
// =============================================================================

// Default shop ID for development - will be replaced with shop selector
const DEFAULT_SHOP_ID = "SYSTEM";

type FilterStatus = "all" | "active" | "draft" | "disabled";

// =============================================================================
// Components
// =============================================================================

function StatusBadge({ prompt }: { prompt: PromptSummary }) {
  if (prompt.isDisabled) {
    return (
      <Badge variant="default" className="bg-gray-100 text-gray-600">
        <PowerOff className="h-3 w-3 mr-1" />
        Disabled
      </Badge>
    );
  }

  if (prompt.draftVersion) {
    return (
      <Badge variant="warning">
        Has Draft
      </Badge>
    );
  }

  if (prompt.activeVersion) {
    return (
      <Badge variant="success">
        Active
      </Badge>
    );
  }

  return (
    <Badge variant="default" className="bg-amber-100 text-amber-700">
      No Active
    </Badge>
  );
}

function MetricCell({
  value,
  label,
  format = "number",
  warning,
  critical,
}: {
  value: number | null;
  label: string;
  format?: "number" | "percent" | "latency" | "currency";
  warning?: number;
  critical?: number;
}) {
  if (value === null) {
    return (
      <div className="text-center min-w-[60px]">
        <p className="text-sm text-gray-300">-</p>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
    );
  }

  let displayValue: string;
  let colorClass = "text-gray-900";

  switch (format) {
    case "percent":
      displayValue = `${value.toFixed(1)}%`;
      if (critical !== undefined && value <= critical) colorClass = "text-red-600";
      else if (warning !== undefined && value <= warning) colorClass = "text-amber-600";
      break;
    case "latency":
      displayValue = formatLatency(value);
      if (critical !== undefined && value >= critical) colorClass = "text-red-600";
      else if (warning !== undefined && value >= warning) colorClass = "text-amber-600";
      break;
    case "currency":
      displayValue = `$${value.toFixed(4)}`;
      break;
    default:
      displayValue = value.toLocaleString();
  }

  return (
    <div className="text-center min-w-[60px]">
      <p className={cn("text-sm font-semibold", colorClass)}>{displayValue}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

function PromptRow({ prompt, shopId }: { prompt: PromptSummary; shopId: string }) {
  const activeModel = prompt.activeVersion?.model || prompt.defaultModel;
  const lastChanged = prompt.activeVersion?.activatedAt;

  return (
    <Link
      href={`/prompts/${prompt.name}?shopId=${shopId}`}
      className={cn(
        "block border-b border-gray-100 last:border-0 transition-colors",
        prompt.isDisabled ? "bg-gray-50/50" : "hover:bg-gray-50"
      )}
    >
      <div className="px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Name & Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h3
                className={cn(
                  "font-mono text-sm font-semibold",
                  prompt.isDisabled ? "text-gray-400" : "text-gray-900"
                )}
              >
                {prompt.name}
              </h3>
              {prompt.activeVersion && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  v{prompt.activeVersion.version}
                </span>
              )}
              {!prompt.activeVersion && !prompt.isDisabled && (
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                  No active
                </span>
              )}
            </div>
            <p
              className={cn(
                "text-sm mt-1 line-clamp-1",
                prompt.isDisabled ? "text-gray-400" : "text-gray-500"
              )}
            >
              {prompt.description || "No description"}
            </p>
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {activeModel}
              </span>
              {lastChanged && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Changed {formatRelativeTime(lastChanged)}
                </span>
              )}
            </div>
          </div>

          {/* Center: Status Badge */}
          <div className="flex items-center">
            <StatusBadge prompt={prompt} />
          </div>

          {/* Right: Metrics Grid (24h) */}
          <div className="flex items-center gap-4">
            <MetricCell
              value={prompt.metrics.latencyP50}
              label="p50"
              format="latency"
            />
            <MetricCell
              value={prompt.metrics.latencyP95}
              label="p95"
              format="latency"
              warning={5000}
              critical={10000}
            />
            <MetricCell
              value={prompt.metrics.successRate24h}
              label="Success"
              format="percent"
              warning={95}
              critical={90}
            />
            <MetricCell
              value={prompt.metrics.avgCost}
              label="Avg Cost"
              format="currency"
            />
          </div>

          {/* Arrow */}
          <div className="flex items-center">
            <ChevronRight className="h-5 w-5 text-gray-300" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <FileText className="h-12 w-12 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 mb-1">No prompts found</h3>
      <p className="text-sm text-gray-500 mb-4">
        {hasFilters
          ? "Try adjusting your filters to see more results"
          : "Create your first prompt definition to get started"}
      </p>
      {!hasFilters && (
        <button className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Create Prompt
        </button>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="divide-y divide-gray-100">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-64 bg-gray-100 rounded animate-pulse mt-2" />
              <div className="h-3 w-48 bg-gray-100 rounded animate-pulse mt-2" />
            </div>
            <div className="h-6 w-20 bg-gray-100 rounded-full animate-pulse" />
            <div className="flex gap-4">
              {[...Array(4)].map((_, j) => (
                <div key={j} className="text-center">
                  <div className="h-4 w-12 bg-gray-200 rounded animate-pulse" />
                  <div className="h-3 w-10 bg-gray-100 rounded animate-pulse mt-1 mx-auto" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShopSelector({
  selectedShopId,
  onSelect,
}: {
  selectedShopId: string;
  onSelect: (shopId: string) => void;
}) {
  const { data: shopsData, isLoading } = useQuery({
    queryKey: queryKeys.shops.list(),
    queryFn: () => getShops({ limit: 100 }),
  });

  const shops = shopsData?.shops ?? [];

  return (
    <div className="flex items-center gap-2">
      <Store className="h-4 w-4 text-gray-400" />
      <select
        value={selectedShopId}
        onChange={(e) => onSelect(e.target.value)}
        disabled={isLoading}
        className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent min-w-[200px]"
      >
        <option value="SYSTEM">System (Global)</option>
        {shops.map((shop) => (
          <option key={shop.shopId} value={shop.shopId}>
            {shop.shopDomain.replace(".myshopify.com", "")}
          </option>
        ))}
      </select>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function PromptsPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [selectedShopId, setSelectedShopId] = useState(DEFAULT_SHOP_ID);

  // Fetch prompts for selected shop
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: queryKeys.prompts.list(selectedShopId),
    queryFn: () => getPrompts(selectedShopId),
  });

  const prompts = data?.prompts ?? [];

  // Filter prompts based on search and status filter
  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const nameMatch = p.name.toLowerCase().includes(searchLower);
        const descMatch = p.description?.toLowerCase().includes(searchLower);
        if (!nameMatch && !descMatch) return false;
      }

      // Status filter
      switch (filter) {
        case "active":
          return p.activeVersion && !p.isDisabled;
        case "draft":
          return p.draftVersion !== null;
        case "disabled":
          return p.isDisabled;
        default:
          return true;
      }
    });
  }, [prompts, search, filter]);

  const hasFilters = !!(search || filter !== "all");

  return (
    <Shell>
      <PageHeader
        title="Prompt Registry"
        description="Manage prompt definitions, versions, and deployments"
      >
        <button className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Prompt
        </button>
      </PageHeader>

      {/* Filters Bar */}
      <Card className="mb-6">
        <CardContent className="py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Shop Selector & Search */}
            <div className="flex items-center gap-4">
              <ShopSelector
                selectedShopId={selectedShopId}
                onSelect={setSelectedShopId}
              />

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search prompts..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-64 pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Right: Filter Tabs & Refresh */}
            <div className="flex items-center gap-4">
              {/* Filter Tabs */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                {[
                  { value: "all", label: "All" },
                  { value: "active", label: "Active" },
                  { value: "draft", label: "Has Draft" },
                  { value: "disabled", label: "Disabled" },
                ].map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setFilter(tab.value as FilterStatus)}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                      filter === tab.value
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Refresh */}
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw
                  className={cn("h-5 w-5 text-gray-500", isFetching && "animate-spin")}
                />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader
          title="Prompt Definitions"
          description={`${filteredPrompts.length} prompt${filteredPrompts.length !== 1 ? "s" : ""}${selectedShopId === "SYSTEM" ? " (system-wide)" : ""}`}
        />
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSkeleton />
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 text-red-500">
              <AlertCircle className="h-8 w-8 mb-2" />
              <p className="text-sm font-medium">Failed to load prompts</p>
              <p className="text-xs text-gray-500 mt-1">
                Make sure the API is running and the shop exists
              </p>
              <button
                onClick={() => refetch()}
                className="mt-4 px-4 py-2 text-sm font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200"
              >
                Retry
              </button>
            </div>
          ) : filteredPrompts.length === 0 ? (
            <EmptyState hasFilters={hasFilters} />
          ) : (
            <div>
              {/* Table Header */}
              <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">Name / Model / Last Changed</div>
                  <div className="w-24 text-center">Status</div>
                  <div className="flex items-center gap-4">
                    <div className="w-[60px] text-center">p50</div>
                    <div className="w-[60px] text-center">p95</div>
                    <div className="w-[60px] text-center">Success</div>
                    <div className="w-[60px] text-center">Avg Cost</div>
                  </div>
                  <div className="w-5" />
                </div>
              </div>

              {/* Rows */}
              {filteredPrompts.map((prompt) => (
                <PromptRow key={prompt.id} prompt={prompt} shopId={selectedShopId} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-end gap-6 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <CheckCircle className="h-3 w-3 text-emerald-500" />
          Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          Has Draft
        </span>
        <span className="flex items-center gap-1.5">
          <PowerOff className="h-3 w-3 text-gray-400" />
          Disabled
        </span>
        <span className="text-gray-400">|</span>
        <span>Metrics are for the last 24 hours</span>
      </div>
    </Shell>
  );
}
