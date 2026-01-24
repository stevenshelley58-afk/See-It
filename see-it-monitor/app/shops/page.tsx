"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Store, AlertCircle, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { Shell, PageHeader, Card, CardHeader, CardContent, Badge } from "@/components/layout/shell";
import { getShops, queryKeys } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ShopListItem, ApiError } from "@/lib/types";

// =============================================================================
// Constants
// =============================================================================

const PAGE_SIZE = 50;

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

function getSuccessRateVariant(rate: number): "success" | "warning" | "error" {
  if (rate >= 95) return "success";
  if (rate >= 80) return "warning";
  return "error";
}

// =============================================================================
// Components
// =============================================================================

interface ShopRowProps {
  shop: ShopListItem;
}

function ShopRow({ shop }: ShopRowProps) {
  const shopDisplay = shop.shopDomain.replace(".myshopify.com", "");
  const successVariant = getSuccessRateVariant(shop.successRateInWindow);
  const isHealthy = shop.successRateInWindow >= 95;

  return (
    <Link
      href={`/shops/${shop.shopId}`}
      className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-4 py-3 items-center hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-2 h-2 rounded-full",
          isHealthy ? "bg-green-500" : "bg-red-500"
        )} />
        <div>
          <p className="text-sm font-medium text-gray-900">{shopDisplay}</p>
          <p className="text-xs text-gray-500 font-mono">{shop.shopId}</p>
        </div>
      </div>
      <div className="text-sm text-gray-900">
        {shop.runsInWindow.toLocaleString()} runs
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={successVariant}>
          {shop.successRateInWindow.toFixed(1)}%
        </Badge>
        {shop.successRateInWindow >= 95 ? (
          <TrendingUp className="h-4 w-4 text-green-500" />
        ) : (
          <TrendingDown className="h-4 w-4 text-red-500" />
        )}
      </div>
      <div className="text-sm text-gray-500 text-right">
        {formatRelativeTime(shop.lastRunAt)}
      </div>
    </Link>
  );
}

function ShopRowSkeleton() {
  return (
    <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-4 py-3 items-center border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-gray-200 animate-pulse" />
        <div className="space-y-1">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-32" />
          <div className="h-3 bg-gray-200 rounded animate-pulse w-24" />
        </div>
      </div>
      <div className="h-4 bg-gray-200 rounded animate-pulse w-16" />
      <div className="h-5 bg-gray-200 rounded-full animate-pulse w-16" />
      <div className="h-4 bg-gray-200 rounded animate-pulse w-20 ml-auto" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <Store className="h-12 w-12 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 mb-1">No shops found</h3>
      <p className="text-sm text-gray-500">
        Shops will appear here once they connect
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
      <h3 className="text-lg font-medium text-gray-900 mb-1">Failed to load shops</h3>
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

function ShopsPageLoading() {
  return (
    <Shell>
      <PageHeader
        title="Shops"
        description="View and manage connected shops"
      />

      <Card>
        <CardHeader title="Connected Shops" />
        <CardContent className="p-0">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div>Shop</div>
            <div>Runs (24h)</div>
            <div>Success Rate</div>
            <div className="text-right">Last Run</div>
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <ShopRowSkeleton key={i} />
          ))}
        </CardContent>
      </Card>
    </Shell>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function ShopsPage() {
  return (
    <Suspense fallback={<ShopsPageLoading />}>
      <ShopsPageContent />
    </Suspense>
  );
}

function ShopsPageContent() {
  // Infinite query for shops
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
    queryKey: queryKeys.shops.list({ windowDays: 1 }),
    queryFn: ({ pageParam }) =>
      getShops({ limit: PAGE_SIZE, cursor: pageParam, windowDays: 1 }),
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  // Deduplicate shops across pages
  const allShops = useMemo(() => {
    const shopMap = new Map<string, ShopListItem>();
    for (const page of data?.pages ?? []) {
      for (const shop of page.shops) {
        shopMap.set(shop.shopId, shop);
      }
    }
    return Array.from(shopMap.values());
  }, [data?.pages]);

  // Sort by success rate (worst first) for visibility
  const sortedShops = useMemo(() => {
    return [...allShops].sort((a, b) => {
      // Sort by success rate ascending (worst first), then by runs descending
      if (a.successRateInWindow !== b.successRateInWindow) {
        return a.successRateInWindow - b.successRateInWindow;
      }
      return b.runsInWindow - a.runsInWindow;
    });
  }, [allShops]);

  // Summary stats
  const totalShops = sortedShops.length;
  const healthyShops = sortedShops.filter(s => s.successRateInWindow >= 95).length;
  const unhealthyShops = totalShops - healthyShops;

  return (
    <Shell>
      <PageHeader
        title="Shops"
        description="View and manage connected shops"
      />

      {/* Summary Stats */}
      {!isLoading && !isError && totalShops > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-gray-500 uppercase">Total Shops</p>
              <p className="text-2xl font-bold text-gray-900">{totalShops}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-gray-500 uppercase">Healthy</p>
              <p className="text-2xl font-bold text-green-600">{healthyShops}</p>
              <p className="text-xs text-gray-500">{">"}95% success rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-gray-500 uppercase">Needs Attention</p>
              <p className="text-2xl font-bold text-red-600">{unhealthyShops}</p>
              <p className="text-xs text-gray-500">{"<"}95% success rate</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader
          title={`Connected Shops${!isLoading ? ` (${sortedShops.length})` : ""}`}
          description="Sorted by success rate (worst first)"
        />
        <CardContent className="p-0">
          {/* Table Header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div>Shop</div>
            <div>Runs (24h)</div>
            <div>Success Rate</div>
            <div className="text-right">Last Run</div>
          </div>

          {/* Loading State */}
          {isLoading && (
            <>
              {Array.from({ length: 10 }).map((_, i) => (
                <ShopRowSkeleton key={i} />
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
          {!isLoading && !isError && sortedShops.length === 0 && (
            <EmptyState />
          )}

          {/* Data Rows */}
          {!isLoading && !isError && sortedShops.length > 0 && (
            <>
              {sortedShops.map((shop) => (
                <ShopRow key={shop.shopId} shop={shop} />
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
