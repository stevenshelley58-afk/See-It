"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Play, AlertCircle, RefreshCw, X } from "lucide-react";
import { Shell, PageHeader, Card, CardHeader, CardContent, Badge } from "@/components/layout/shell";
import { getRuns, queryKeys } from "@/lib/api";
import { cn, formatRelativeTime, formatDuration, getRunStatusVariant } from "@/lib/utils";
import type { RunListItem, RunsParams, ApiError } from "@/lib/types";

// =============================================================================
// Constants
// =============================================================================

const TIME_WINDOWS = [
  { label: "15m", value: "15m", ms: 15 * 60 * 1000 },
  { label: "1h", value: "1h", ms: 60 * 60 * 1000 },
  { label: "24h", value: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d", value: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "30d", value: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Complete", value: "complete" },
  { label: "Partial", value: "partial" },
  { label: "Failed", value: "failed" },
  { label: "In Flight", value: "in_flight" },
] as const;

const PAGE_SIZE = 50;

// =============================================================================
// Hooks
// =============================================================================

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// =============================================================================
// Inline Components
// =============================================================================

interface RunRowProps {
  run: RunListItem;
}

function RunRow({ run }: RunRowProps) {
  const statusVariant = getRunStatusVariant(run.status);
  const variantInfo = `${run.successCount}/${run.variantCount}`;
  const shopDisplay = run.shopDomain.replace(".myshopify.com", "");

  return (
    <Link
      href={`/runs/${run.id}`}
      className="grid grid-cols-[1fr_1fr_1.5fr_1fr_0.75fr] gap-4 px-4 py-3 items-center hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
    >
      <div
        className="text-sm text-gray-900"
        title={new Date(run.createdAt).toISOString()}
      >
        {formatRelativeTime(run.createdAt)}
      </div>
      <div className="text-sm text-gray-900 truncate" title={run.shopDomain}>
        {shopDisplay}
      </div>
      <div className="text-sm text-gray-900 truncate">
        {run.productTitle || "-"}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant}>{run.status}</Badge>
        <span className="text-xs text-gray-500">{variantInfo}</span>
      </div>
      <div className="text-sm text-gray-500 text-right">
        {run.totalDurationMs != null ? formatDuration(run.totalDurationMs) : "-"}
      </div>
    </Link>
  );
}

function RunRowSkeleton() {
  return (
    <div className="grid grid-cols-[1fr_1fr_1.5fr_1fr_0.75fr] gap-4 px-4 py-3 items-center border-b border-gray-100 last:border-b-0">
      <div className="h-4 bg-gray-200 rounded animate-pulse w-16" />
      <div className="h-4 bg-gray-200 rounded animate-pulse w-24" />
      <div className="h-4 bg-gray-200 rounded animate-pulse w-32" />
      <div className="h-5 bg-gray-200 rounded-full animate-pulse w-20" />
      <div className="h-4 bg-gray-200 rounded animate-pulse w-12 ml-auto" />
    </div>
  );
}

interface EmptyStateProps {
  hasFilters: boolean;
}

function EmptyState({ hasFilters }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <Play className="h-12 w-12 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 mb-1">No runs found</h3>
      <p className="text-sm text-gray-500">
        {hasFilters
          ? "Try adjusting your filters to see more results"
          : "Runs will appear here once they start"}
      </p>
    </div>
  );
}

interface ErrorPanelProps {
  error: ApiError;
  onRetry: () => void;
}

function ErrorPanel({ error, onRetry }: ErrorPanelProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <AlertCircle className="h-12 w-12 mb-4 text-red-400" />
      <h3 className="text-lg font-medium text-gray-900 mb-1">Failed to load runs</h3>
      <p className="text-sm text-gray-500 mb-4">{error.message}</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
      >
        <RefreshCw className="h-4 w-4" />
        Retry
      </button>
    </div>
  );
}

// =============================================================================
// Loading Fallback
// =============================================================================

function RunsPageLoading() {
  return (
    <Shell>
      <PageHeader
        title="Runs"
        description="View and manage render runs"
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="h-8 w-40 bg-gray-200 rounded animate-pulse" />
        <div className="h-8 w-24 bg-gray-200 rounded animate-pulse" />
      </div>

      <Card>
        <CardHeader title="Runs" />
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_1fr_1.5fr_1fr_0.75fr] gap-4 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div>Time</div>
            <div>Shop</div>
            <div>Product</div>
            <div>Status</div>
            <div className="text-right">Duration</div>
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <RunRowSkeleton key={i} />
          ))}
        </CardContent>
      </Card>
    </Shell>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function RunsPage() {
  return (
    <Suspense fallback={<RunsPageLoading />}>
      <RunsPageContent />
    </Suspense>
  );
}

function RunsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL-driven state
  const status = searchParams.get("status") || "";
  const window = searchParams.get("window") || "24h";
  const shopIdParam = searchParams.get("shopId") || "";
  const ppvParam = searchParams.get("ppv") || "";
  const searchQuery = searchParams.get("q") || "";

  // Local state for inputs (before debouncing)
  const [shopIdInput, setShopIdInput] = useState(shopIdParam);
  const [ppvInput, setPpvInput] = useState(ppvParam);
  const [searchInput, setSearchInput] = useState(searchQuery);

  // Sync local state when URL changes externally
  useEffect(() => {
    setShopIdInput(shopIdParam);
  }, [shopIdParam]);

  useEffect(() => {
    setPpvInput(ppvParam);
  }, [ppvParam]);

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // Debounced values
  const debouncedShopId = useDebounce(shopIdInput, 300);
  const debouncedSearch = useDebounce(searchInput, 300);

  // Update URL helper
  const updateUrl = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`/runs?${params.toString()}`, { scroll: false });
  };

  // Sync debounced shopId to URL
  useEffect(() => {
    if (debouncedShopId !== shopIdParam) {
      updateUrl("shopId", debouncedShopId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedShopId]);

  // Sync debounced search to URL
  useEffect(() => {
    if (debouncedSearch !== searchQuery) {
      updateUrl("q", debouncedSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Build API params (only API-supported filters)
  const apiParams: RunsParams = useMemo(() => {
    const params: RunsParams = { limit: PAGE_SIZE };
    if (status) params.status = status;
    if (debouncedShopId) params.shopId = debouncedShopId;
    return params;
  }, [status, debouncedShopId]);

  // Infinite query
  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: queryKeys.runs.list(apiParams),
    queryFn: ({ pageParam }) =>
      getRuns({ ...apiParams, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  // Deduplicate runs across pages
  const allRuns = useMemo(() => {
    const runMap = new Map<string, RunListItem>();
    for (const page of data?.pages ?? []) {
      for (const run of page.runs) {
        runMap.set(run.id, run);
      }
    }
    return Array.from(runMap.values());
  }, [data?.pages]);

  // Client-side filtering (time window, PPV, and search)
  const filteredRuns = useMemo(() => {
    const windowConfig = TIME_WINDOWS.find((w) => w.value === window);
    const windowMs = windowConfig?.ms ?? TIME_WINDOWS[2].ms; // Default 24h
    const now = Date.now();
    const ppvNumber = ppvParam ? parseInt(ppvParam, 10) : null;
    const searchLower = debouncedSearch.toLowerCase().trim();

    return allRuns.filter((run) => {
      // Time window filter
      const runTime = new Date(run.createdAt).getTime();
      if (now - runTime > windowMs) return false;

      // PPV filter
      if (ppvNumber !== null && !isNaN(ppvNumber)) {
        if (run.promptPackVersion !== ppvNumber) return false;
      }

      // Search filter (matches shop domain, product title, or run ID)
      if (searchLower) {
        const shopMatch = run.shopDomain.toLowerCase().includes(searchLower);
        const productMatch = run.productTitle?.toLowerCase().includes(searchLower);
        const idMatch = run.id.toLowerCase().includes(searchLower);
        if (!shopMatch && !productMatch && !idMatch) return false;
      }

      return true;
    });
  }, [allRuns, window, ppvParam, debouncedSearch]);

  // Check if any filters are active
  const hasFilters = !!(status || shopIdParam || ppvParam || searchQuery || window !== "24h");

  // Clear all filters
  const clearFilters = () => {
    setShopIdInput("");
    setPpvInput("");
    setSearchInput("");
    router.replace("/runs", { scroll: false });
  };

  // Handle PPV input change
  const handlePpvChange = (value: string) => {
    setPpvInput(value);
    updateUrl("ppv", value);
  };

  return (
    <Shell>
      <PageHeader
        title="Runs"
        description="View and manage render runs"
      />

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search Input */}
        <input
          type="text"
          placeholder="Search shop, product, ID..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-52"
        />

        {/* Time Window Buttons */}
        <div className="inline-flex rounded-md shadow-sm">
          {TIME_WINDOWS.map((tw) => (
            <button
              key={tw.value}
              onClick={() => updateUrl("window", tw.value === "24h" ? "" : tw.value)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium border",
                "first:rounded-l-md last:rounded-r-md",
                "-ml-px first:ml-0",
                window === tw.value || (tw.value === "24h" && !searchParams.get("window"))
                  ? "bg-blue-50 text-blue-700 border-blue-300 z-10"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              )}
            >
              {tw.label}
            </button>
          ))}
        </div>

        {/* Status Select */}
        <select
          value={status}
          onChange={(e) => updateUrl("status", e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Shop ID Input */}
        <input
          type="text"
          placeholder="Shop ID..."
          value={shopIdInput}
          onChange={(e) => setShopIdInput(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-40"
        />

        {/* PPV Input */}
        <input
          type="number"
          placeholder="PPV..."
          value={ppvInput}
          onChange={(e) => handlePpvChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-24"
        />

        {/* Clear Filters Button */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
            Clear
          </button>
        )}
      </div>

      <Card>
        <CardHeader
          title={`Runs${!isLoading ? ` (${filteredRuns.length})` : ""}`}
          description={hasFilters ? "Filtered results" : undefined}
        />
        <CardContent className="p-0">
          {/* Table Header */}
          <div className="grid grid-cols-[1fr_1fr_1.5fr_1fr_0.75fr] gap-4 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div>Time</div>
            <div>Shop</div>
            <div>Product</div>
            <div>Status</div>
            <div className="text-right">Duration</div>
          </div>

          {/* Loading State */}
          {isLoading && (
            <>
              {Array.from({ length: 10 }).map((_, i) => (
                <RunRowSkeleton key={i} />
              ))}
            </>
          )}

          {/* Error State */}
          {isError && error && (
            <ErrorPanel
              error={error as unknown as ApiError}
              onRetry={() => refetch()}
            />
          )}

          {/* Empty State */}
          {!isLoading && !isError && filteredRuns.length === 0 && (
            <EmptyState hasFilters={hasFilters} />
          )}

          {/* Data Rows */}
          {!isLoading && !isError && filteredRuns.length > 0 && (
            <>
              {filteredRuns.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}

              {/* Load More Button */}
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
            </>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
