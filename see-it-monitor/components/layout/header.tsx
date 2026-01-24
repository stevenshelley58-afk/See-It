"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
}

export function Header({ onRefresh, isRefreshing }: HeaderProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fetchingCount = useIsFetching();
  const [searchValue, setSearchValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    if (onRefresh) {
      return Promise.resolve(onRefresh());
    }
    return queryClient.invalidateQueries();
  }, [onRefresh, queryClient]);

  const refreshing = isRefreshing ?? fetchingCount > 0;

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchValue.trim();
    if (trimmed) {
      router.push(`/runs?q=${encodeURIComponent(trimmed)}`);
      setSearchValue("");
      inputRef.current?.blur();
    }
  }, [searchValue, router]);

  const clearSearch = useCallback(() => {
    setSearchValue("");
    inputRef.current?.focus();
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
      {/* Search */}
      <div className="flex-1 max-w-md">
        <form onSubmit={handleSearch} className="relative">
          <Search className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors",
            isFocused ? "text-blue-500" : "text-gray-400"
          )} />
          <input
            ref={inputRef}
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Search runs by shop, product, or ID..."
            className={cn(
              "w-full pl-10 pr-20 py-2 text-sm border rounded-md transition-colors",
              "bg-white text-gray-900 placeholder-gray-400",
              "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
              isFocused ? "border-blue-300" : "border-gray-200"
            )}
          />
          {searchValue && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-14 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium text-gray-400 bg-gray-100 rounded border border-gray-200">
            <span className="text-xs">⌘</span>K
          </kbd>
        </form>
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
