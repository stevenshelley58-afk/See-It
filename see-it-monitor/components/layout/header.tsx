"use client";

import { useCallback } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
}

export function Header({ onRefresh, isRefreshing }: HeaderProps) {
  const queryClient = useQueryClient();
  const fetchingCount = useIsFetching();

  const refresh = useCallback(() => {
    if (onRefresh) {
      return Promise.resolve(onRefresh());
    }
    return queryClient.invalidateQueries();
  }, [onRefresh, queryClient]);

  const refreshing = isRefreshing ?? fetchingCount > 0;

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
      {/* Search (placeholder) */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            disabled
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-md bg-gray-50 text-gray-400 cursor-not-allowed"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        {/* Manual refresh */}
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="p-2 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50"
          title="Refresh now"
        >
          <RefreshCw
            className={cn("h-5 w-5 text-gray-600", refreshing && "animate-spin")}
          />
        </button>
      </div>
    </header>
  );
}
