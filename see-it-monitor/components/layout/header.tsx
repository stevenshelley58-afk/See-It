"use client";

import { useState, useEffect } from "react";
import { Search, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function Header({ onRefresh, isRefreshing }: HeaderProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Auto-refresh indicator
  useEffect(() => {
    if (!autoRefresh || !onRefresh) return;

    const interval = setInterval(() => {
      onRefresh();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, onRefresh]);

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
        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors",
            autoRefresh
              ? "bg-primary-100 text-primary-700"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          <RefreshCw
            className={cn("h-4 w-4", isRefreshing && "animate-spin")}
          />
          {autoRefresh ? "Auto-refresh on" : "Auto-refresh off"}
        </button>

        {/* Manual refresh */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50"
          title="Refresh now"
        >
          <RefreshCw
            className={cn("h-5 w-5 text-gray-600", isRefreshing && "animate-spin")}
          />
        </button>
      </div>
    </header>
  );
}
