import { clsx, type ClassValue } from "clsx";

/**
 * Merge class names with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Normalize error message for grouping (removes variable parts)
 */
export function normalizeErrorMessage(message: string | null | undefined): string {
  if (!message) return "unknown_error";
  return message
    .toLowerCase()
    .trim()
    .replace(/\d+/g, "#") // Replace digits with #
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{uuid}") // Replace UUIDs
    .replace(/\s+/g, " ") // Collapse whitespace
    .slice(0, 80); // Limit length
}

/**
 * Format a date string for display
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a date string with time for display
 */
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format a relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return "just now";
  } else if (diffMin < 60) {
    return `${diffMin}m ago`;
  } else if (diffHour < 24) {
    return `${diffHour}h ago`;
  } else if (diffDay < 7) {
    return `${diffDay}d ago`;
  } else {
    return formatDate(dateString);
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Format a percentage value
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format latency in milliseconds
 */
export function formatLatency(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

/**
 * Get status color class based on health status
 */
export function getStatusColor(
  status: "healthy" | "degraded" | "unhealthy"
): string {
  switch (status) {
    case "healthy":
      return "text-green-600 bg-green-100";
    case "degraded":
      return "text-yellow-600 bg-yellow-100";
    case "unhealthy":
      return "text-red-600 bg-red-100";
    default:
      return "text-gray-600 bg-gray-100";
  }
}

/**
 * Get run status color class
 */
export function getRunStatusColor(status: string): string {
  switch (status) {
    case "pending":
    case "queued":
      return "text-gray-600 bg-gray-100";
    case "running":
    case "in_progress":
      return "text-blue-600 bg-blue-100";
    case "complete":
    case "completed":
    case "success":
      return "text-green-600 bg-green-100";
    case "failed":
    case "error":
      return "text-red-600 bg-red-100";
    case "partial":
      return "text-yellow-600 bg-yellow-100";
    case "cancelled":
    case "timeout":
      return "text-orange-600 bg-orange-100";
    default:
      return "text-gray-600 bg-gray-100";
  }
}

/**
 * Get run status badge variant
 */
export function getRunStatusVariant(
  status: string
): "default" | "success" | "warning" | "error" {
  switch (status) {
    case "complete":
    case "completed":
    case "success":
      return "success";
    case "failed":
    case "error":
      return "error";
    case "partial":
    case "timeout":
      return "warning";
    default:
      return "default";
  }
}
