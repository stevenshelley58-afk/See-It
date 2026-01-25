"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  Image as ImageIcon,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Zap,
  Settings,
  BarChart3,
  FileText,
  DollarSign,
} from "lucide-react";
import {
  Shell,
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  Badge,
  CopyButton,
  Modal,
  Toggle,
} from "@/components/layout/shell";
import {
  getRun,
  getRunEvents,
  getRunArtifacts,
  getRunLLMCalls,
  queryKeys,
} from "@/lib/api";
import type {
  VariantResult,
  RunEvent,
  RunArtifact,
  LLMCall,
  ResolvedConfigSnapshot,
  WaterfallMs,
  RunTotals,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// =============================================================================
// Utility Functions
// =============================================================================

function formatRelativeTime(dateString: string): string {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCost(cost: number | null): string {
  if (cost === null) return "-";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return "-";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}

function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

function getStatusBadgeVariant(
  status: string
): "default" | "success" | "warning" | "error" {
  switch (status.toLowerCase()) {
    case "completed":
    case "success":
    case "succeeded":
      return "success";
    case "partial":
    case "pending":
    case "processing":
    case "started":
      return "warning";
    case "failed":
    case "error":
    case "timeout":
      return "error";
    default:
      return "default";
  }
}

function getSeverityBadgeVariant(
  severity: string
): "default" | "success" | "warning" | "error" {
  switch (severity.toLowerCase()) {
    case "info":
      return "default";
    case "warn":
    case "warning":
      return "warning";
    case "error":
    case "critical":
      return "error";
    default:
      return "default";
  }
}

// =============================================================================
// Tabs Component
// =============================================================================

type TabId = "variants" | "timeline" | "artifacts" | "llm-calls" | "config";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  count?: number;
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
            {tab.count !== undefined && (
              <span
                className={cn(
                  "ml-1 px-2 py-0.5 rounded-full text-xs",
                  activeTab === tab.id
                    ? "bg-blue-100 text-blue-600"
                    : "bg-gray-100 text-gray-600"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

// =============================================================================
// Skeleton Components
// =============================================================================

function RunInfoSkeleton() {
  return (
    <Card>
      <CardContent>
        <div className="animate-pulse space-y-4">
          <div className="flex justify-between">
            <div className="h-6 bg-gray-200 rounded w-1/3" />
            <div className="h-6 bg-gray-200 rounded w-20" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-16" />
                <div className="h-5 bg-gray-200 rounded w-24" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VariantGridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(8)].map((_, i) => (
        <Card key={i}>
          <CardContent className="p-3">
            <div className="animate-pulse space-y-3">
              <div className="aspect-square bg-gray-200 rounded" />
              <div className="h-4 bg-gray-200 rounded w-20" />
              <div className="h-3 bg-gray-200 rounded w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <Card>
      <CardHeader title="Timeline" />
      <CardContent>
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 bg-gray-200 rounded w-16" />
              <div className="h-4 bg-gray-200 rounded w-20" />
              <div className="h-4 bg-gray-200 rounded flex-1" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ArtifactsSkeleton() {
  return (
    <Card>
      <CardHeader title="Artifacts" />
      <CardContent>
        <div className="animate-pulse space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-200 rounded" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LLMCallsSkeleton() {
  return (
    <Card>
      <CardHeader title="LLM Calls" />
      <CardContent className="p-0">
        <div className="animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-3 border-b border-gray-100 last:border-0">
              <div className="flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-24" />
                <div className="h-4 bg-gray-200 rounded w-20" />
                <div className="h-4 bg-gray-200 rounded w-16" />
                <div className="h-4 bg-gray-200 rounded w-12" />
                <div className="h-4 bg-gray-200 rounded flex-1" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
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
// Waterfall Component
// =============================================================================

interface WaterfallPanelProps {
  waterfallMs: WaterfallMs | null | undefined;
  runTotals: RunTotals | null | undefined;
}

function WaterfallPanel({ waterfallMs, runTotals }: WaterfallPanelProps) {
  if (!waterfallMs && !runTotals) {
    return null;
  }

  const phases = waterfallMs
    ? [
        { name: "Download", ms: waterfallMs.download_ms, color: "bg-blue-500" },
        { name: "Prompt Build", ms: waterfallMs.prompt_build_ms, color: "bg-purple-500" },
        { name: "Inference", ms: waterfallMs.inference_ms, color: "bg-green-500" },
        { name: "Upload", ms: waterfallMs.upload_ms, color: "bg-orange-500" },
      ]
    : [];

  const totalMs = waterfallMs?.total_ms || 0;

  return (
    <Card className="mb-6">
      <CardHeader title="Waterfall Timing" description="Phase breakdown" />
      <CardContent>
        <div className="space-y-4">
          {/* Waterfall bar */}
          {waterfallMs && totalMs > 0 && (
            <div className="space-y-2">
              <div className="flex h-6 rounded-lg overflow-hidden bg-gray-100">
                {phases.map((phase, i) => {
                  const widthPercent = (phase.ms / totalMs) * 100;
                  if (widthPercent < 1) return null;
                  return (
                    <div
                      key={i}
                      className={cn(phase.color, "flex items-center justify-center text-xs text-white font-medium")}
                      style={{ width: `${widthPercent}%` }}
                      title={`${phase.name}: ${formatDuration(phase.ms)}`}
                    >
                      {widthPercent > 10 && formatDuration(phase.ms)}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 text-xs">
                {phases.map((phase, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className={cn("w-2 h-2 rounded-full", phase.color)} />
                    <span className="text-gray-600">{phase.name}:</span>
                    <span className="font-medium">{formatDuration(phase.ms)}</span>
                  </div>
                ))}
              </div>
              {waterfallMs.inference_p50_ms !== undefined && (
                <div className="text-xs text-gray-500 mt-1">
                  Inference p50: {formatDuration(waterfallMs.inference_p50_ms)}{" "}
                  {waterfallMs.inference_p95_ms !== undefined && (
                    <>/ p95: {formatDuration(waterfallMs.inference_p95_ms)}</>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Run totals */}
          {runTotals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-500 uppercase">Total Tokens</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatTokens(runTotals.tokens_in + runTotals.tokens_out)}
                </p>
                <p className="text-xs text-gray-500">
                  In: {formatTokens(runTotals.tokens_in)} / Out: {formatTokens(runTotals.tokens_out)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Estimated Cost</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatCost(runTotals.cost_estimate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">LLM Calls</p>
                <p className="text-lg font-semibold text-gray-900">
                  {runTotals.calls_total}
                </p>
                <p className="text-xs text-gray-500">
                  <span className="text-green-600">{runTotals.calls_succeeded} ok</span>
                  {runTotals.calls_failed > 0 && (
                    <span className="text-red-600"> / {runTotals.calls_failed} failed</span>
                  )}
                  {runTotals.calls_timeout > 0 && (
                    <span className="text-orange-600"> / {runTotals.calls_timeout} timeout</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Total Time</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatDuration(totalMs)}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Variant Card Component
// =============================================================================

interface VariantCardProps {
  variant: VariantResult;
  index: number;
  onClick: () => void;
}

function VariantCard({ variant, index, onClick }: VariantCardProps) {
  const statusIcon =
    variant.status === "success" ? (
      <CheckCircle className="h-4 w-4 text-green-500" />
    ) : variant.status === "timeout" ? (
      <Clock className="h-4 w-4 text-yellow-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    );

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow">
      <CardContent className="p-3">
        <button onClick={onClick} className="w-full text-left">
          {/* Thumbnail */}
          <div className="aspect-square bg-gray-100 rounded mb-3 overflow-hidden flex items-center justify-center">
            {variant.imageUrl ? (
              <img
                src={variant.imageUrl}
                alt={`Variant ${index + 1}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <ImageIcon className="h-8 w-8 text-gray-300" />
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 mb-2">
            {statusIcon}
            <Badge variant={getStatusBadgeVariant(variant.status)}>
              {variant.status}
            </Badge>
          </div>

          {/* Variant ID */}
          <p className="text-xs text-gray-500 font-mono mb-2">
            {truncateId(variant.variantId)}
          </p>

          {/* Latency */}
          <div className="text-xs text-gray-500 space-y-1">
            <div className="flex justify-between">
              <span>Total:</span>
              <span className="font-medium">
                {formatDuration(variant.latencyMs)}
              </span>
            </div>
            {variant.providerMs !== null && (
              <div className="flex justify-between">
                <span>Provider:</span>
                <span>{formatDuration(variant.providerMs)}</span>
              </div>
            )}
          </div>

          {/* Error */}
          {variant.errorMessage && (
            <p className="mt-2 text-xs text-red-600 truncate">
              {variant.errorMessage}
            </p>
          )}
        </button>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Variant Modal Component
// =============================================================================

interface VariantModalProps {
  variant: VariantResult;
  index: number;
  onClose: () => void;
}

function VariantModal({ variant, index, onClose }: VariantModalProps) {
  return (
    <Modal open={true} onClose={onClose} title={`Variant ${index + 1}`}>
      <div className="space-y-4">
        {/* Large Image */}
        <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
          {variant.imageUrl ? (
            <img
              src={variant.imageUrl}
              alt={`Variant ${index + 1}`}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <div className="text-center text-gray-400">
              <ImageIcon className="h-16 w-16 mx-auto mb-2" />
              <p>No image available</p>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase">Status</p>
            <Badge variant={getStatusBadgeVariant(variant.status)}>
              {variant.status}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Variant ID</p>
            <div className="flex items-center gap-1">
              <span className="font-mono text-sm">
                {truncateId(variant.variantId, 16)}
              </span>
              <CopyButton value={variant.variantId} />
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Total Latency</p>
            <p className="font-medium">{formatDuration(variant.latencyMs)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Provider Latency</p>
            <p className="font-medium">{formatDuration(variant.providerMs)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Upload Time</p>
            <p className="font-medium">{formatDuration(variant.uploadMs)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Record ID</p>
            <div className="flex items-center gap-1">
              <span className="font-mono text-sm">
                {truncateId(variant.id, 16)}
              </span>
              <CopyButton value={variant.id} />
            </div>
          </div>
        </div>

        {/* Error Details */}
        {variant.errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-600 font-medium uppercase mb-1">
              Error
            </p>
            {variant.errorCode && (
              <p className="text-sm text-red-700 font-mono mb-1">
                {variant.errorCode}
              </p>
            )}
            <p className="text-sm text-red-800">{variant.errorMessage}</p>
          </div>
        )}

        {/* Image URL */}
        {variant.imageUrl && (
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Image URL</p>
            <div className="flex items-center gap-2">
              <a
                href={variant.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline truncate flex-1"
              >
                {variant.imageUrl}
              </a>
              <CopyButton value={variant.imageUrl} label="Copy" />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// =============================================================================
// Timeline Event Row Component
// =============================================================================

interface EventRowProps {
  event: RunEvent;
  runStartTime: Date;
}

function EventRow({ event, runStartTime }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const eventTime = new Date(event.ts);
  const offsetMs = eventTime.getTime() - runStartTime.getTime();

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-gray-50"
      >
        {event.payload ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
          )
        ) : (
          <span className="w-4" />
        )}

        <span className="text-xs text-gray-400 font-mono w-16 shrink-0">
          +{formatDuration(offsetMs)}
        </span>

        <Badge
          variant={getSeverityBadgeVariant(event.severity)}
          className="shrink-0"
        >
          {event.severity}
        </Badge>

        <span className="text-xs text-gray-500 shrink-0">{event.source}</span>

        <span className="text-sm font-medium text-gray-700 truncate flex-1">
          {event.type}
        </span>

        {event.variantId && (
          <span className="text-xs text-gray-400 font-mono shrink-0">
            {truncateId(event.variantId)}
          </span>
        )}
      </button>

      {expanded && event.payload && (
        <div className="px-3 pb-3 pl-10">
          <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-48">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Timeline Panel Component
// =============================================================================

interface TimelinePanelProps {
  events: RunEvent[];
  runStartTime: Date;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function TimelinePanel({
  events,
  runStartTime,
  isLoading,
  isError,
  onRetry,
}: TimelinePanelProps) {
  if (isLoading) return <TimelineSkeleton />;
  if (isError)
    return <ErrorPanel message="Failed to load events" onRetry={onRetry} />;

  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  return (
    <Card>
      <CardHeader
        title="Timeline"
        description={`${events.length} event${events.length !== 1 ? "s" : ""}`}
      />
      {events.length === 0 ? (
        <CardContent>
          <p className="text-sm text-gray-500 text-center py-4">
            No events recorded
          </p>
        </CardContent>
      ) : (
        <div className="divide-y divide-gray-100">
          {sortedEvents.map((event) => (
            <EventRow key={event.id} event={event} runStartTime={runStartTime} />
          ))}
        </div>
      )}
    </Card>
  );
}

// =============================================================================
// Artifacts Table Component
// =============================================================================

interface ArtifactsPanelProps {
  artifacts: RunArtifact[];
  reveal: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function ArtifactsPanel({
  artifacts,
  reveal,
  isLoading,
  isError,
  onRetry,
}: ArtifactsPanelProps) {
  if (isLoading) return <ArtifactsSkeleton />;
  if (isError)
    return <ErrorPanel message="Failed to load artifacts" onRetry={onRetry} />;

  return (
    <Card>
      <CardHeader
        title="Artifacts"
        description={`${artifacts.length} artifact${artifacts.length !== 1 ? "s" : ""}`}
      />
      {artifacts.length === 0 ? (
        <CardContent>
          <p className="text-sm text-gray-500 text-center py-4">
            No artifacts found
          </p>
        </CardContent>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Content Type
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Size
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Dimensions
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  SHA256
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {artifacts.map((artifact) => (
                <tr key={artifact.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-900">
                    {artifact.type}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500 font-mono">
                    {artifact.contentType}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {formatBytes(artifact.byteSize)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {artifact.dimensions
                      ? `${artifact.dimensions.width}x${artifact.dimensions.height}`
                      : "-"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500 font-mono">
                        {truncateId(artifact.sha256, 12)}
                      </span>
                      <CopyButton value={artifact.sha256} />
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {artifact.url ? (
                      <a
                        href={artifact.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {reveal ? "Not available" : "Hidden"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// =============================================================================
// LLM Call Row Component
// =============================================================================

interface LLMCallRowProps {
  call: LLMCall;
  runStartTime: Date;
}

function LLMCallRow({ call, runStartTime }: LLMCallRowProps) {
  const [expanded, setExpanded] = useState(false);
  const callTime = new Date(call.startedAt);
  const offsetMs = callTime.getTime() - runStartTime.getTime();

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
        )}

        <span className="text-xs text-gray-400 font-mono w-16 shrink-0">
          +{formatDuration(offsetMs)}
        </span>

        <span className="text-sm font-medium text-gray-900 w-32 shrink-0 truncate">
          {call.promptName}
        </span>

        <Badge className="shrink-0">{call.model}</Badge>

        <Badge variant={getStatusBadgeVariant(call.status)} className="shrink-0">
          {call.status}
        </Badge>

        <span className="text-xs text-gray-500 w-16 shrink-0 text-right">
          {formatDuration(call.latencyMs)}
        </span>

        <span className="text-xs text-gray-500 w-20 shrink-0 text-right">
          {formatTokens(call.tokensIn)} / {formatTokens(call.tokensOut)}
        </span>

        <span className="text-xs text-gray-500 w-16 shrink-0 text-right">
          {formatCost(call.costEstimate)}
        </span>

        {call.errorMessage && (
          <span className="text-xs text-red-600 truncate flex-1">
            {call.errorMessage}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pl-10 space-y-4">
          {/* Details Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-xs text-gray-500 uppercase">Provider Request ID</p>
              <p className="text-sm font-mono text-gray-700 truncate">
                {call.providerRequestId || "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Provider Model</p>
              <p className="text-sm font-mono text-gray-700">
                {call.providerModel || "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Prompt Version ID</p>
              <p className="text-sm font-mono text-gray-700 truncate">
                {call.promptVersionId || "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Retry Count</p>
              <p className="text-sm text-gray-700">{call.retryCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Resolution Hash</p>
              <p className="text-sm font-mono text-gray-700 truncate">
                {truncateId(call.resolutionHash, 16)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Request Hash</p>
              <p className="text-sm font-mono text-gray-700 truncate">
                {truncateId(call.requestHash, 16)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Started</p>
              <p className="text-sm text-gray-700">
                {new Date(call.startedAt).toLocaleTimeString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Finished</p>
              <p className="text-sm text-gray-700">
                {call.finishedAt
                  ? new Date(call.finishedAt).toLocaleTimeString()
                  : "-"}
              </p>
            </div>
          </div>

          {/* Input Reference */}
          {call.inputRef && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-2">Input Reference</p>
              <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-48">
                {JSON.stringify(call.inputRef, null, 2)}
              </pre>
            </div>
          )}

          {/* Full Input Payload (Reveal-gated) */}
          <div>
            <p className="text-xs text-gray-500 uppercase mb-2">Full Input Payload</p>
            {call.inputPayload ? (
              <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-96">
                {JSON.stringify(call.inputPayload, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-gray-400">
                {"Toggle Reveal to view full input payload (or this run predates full payload logging)."}
              </p>
            )}
          </div>

          {/* Output Reference */}
          {call.outputRef && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-2">Output Reference</p>
              <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-48">
                {JSON.stringify(call.outputRef, null, 2)}
              </pre>
            </div>
          )}

          {/* Error Details */}
          {call.errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs text-red-600 font-medium uppercase mb-1">
                Error Details
              </p>
              {call.errorType && (
                <p className="text-sm text-red-700 font-mono mb-1">
                  Type: {call.errorType}
                </p>
              )}
              <p className="text-sm text-red-800">{call.errorMessage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// LLM Calls Panel Component
// =============================================================================

interface LLMCallsPanelProps {
  calls: LLMCall[];
  runStartTime: Date;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function LLMCallsPanel({
  calls,
  runStartTime,
  isLoading,
  isError,
  onRetry,
}: LLMCallsPanelProps) {
  if (isLoading) return <LLMCallsSkeleton />;
  if (isError)
    return <ErrorPanel message="Failed to load LLM calls" onRetry={onRetry} />;

  const sortedCalls = [...calls].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );

  // Summary stats
  const totalCalls = calls.length;
  const succeededCalls = calls.filter((c) => c.status === "SUCCEEDED").length;
  const failedCalls = calls.filter((c) => c.status === "FAILED").length;
  const timeoutCalls = calls.filter((c) => c.status === "TIMEOUT").length;
  const totalTokensIn = calls.reduce((sum, c) => sum + (c.tokensIn || 0), 0);
  const totalTokensOut = calls.reduce((sum, c) => sum + (c.tokensOut || 0), 0);
  const totalCost = calls.reduce((sum, c) => sum + (c.costEstimate || 0), 0);

  return (
    <Card>
      <CardHeader
        title="LLM Calls"
        description={`${totalCalls} call${totalCalls !== 1 ? "s" : ""}`}
      />

      {/* Summary Bar */}
      {totalCalls > 0 && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            <span className="text-gray-600">Succeeded:</span>
            <span className="font-medium text-green-600">{succeededCalls}</span>
          </div>
          {failedCalls > 0 && (
            <div className="flex items-center gap-1">
              <XCircle className="h-3 w-3 text-red-500" />
              <span className="text-gray-600">Failed:</span>
              <span className="font-medium text-red-600">{failedCalls}</span>
            </div>
          )}
          {timeoutCalls > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-orange-500" />
              <span className="text-gray-600">Timeout:</span>
              <span className="font-medium text-orange-600">{timeoutCalls}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-blue-500" />
            <span className="text-gray-600">Tokens:</span>
            <span className="font-medium">{formatTokens(totalTokensIn + totalTokensOut)}</span>
          </div>
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3 text-green-500" />
            <span className="text-gray-600">Cost:</span>
            <span className="font-medium">{formatCost(totalCost)}</span>
          </div>
        </div>
      )}

      {/* Table Header */}
      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-3 text-xs font-medium text-gray-500 uppercase">
        <span className="w-4" />
        <span className="w-16">Time</span>
        <span className="w-32">Prompt</span>
        <span className="w-24">Model</span>
        <span className="w-20">Status</span>
        <span className="w-16 text-right">Latency</span>
        <span className="w-20 text-right">Tokens</span>
        <span className="w-16 text-right">Cost</span>
        <span className="flex-1">Error</span>
      </div>

      {calls.length === 0 ? (
        <CardContent>
          <p className="text-sm text-gray-500 text-center py-4">
            No LLM calls recorded for this run
          </p>
        </CardContent>
      ) : (
        <div className="divide-y divide-gray-100">
          {sortedCalls.map((call) => (
            <LLMCallRow key={call.id} call={call} runStartTime={runStartTime} />
          ))}
        </div>
      )}
    </Card>
  );
}

// =============================================================================
// Config Snapshot Panel Component
// =============================================================================

interface ConfigSnapshotPanelProps {
  snapshot: ResolvedConfigSnapshot | null | undefined;
}

function ConfigSnapshotPanel({ snapshot }: ConfigSnapshotPanelProps) {
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());

  if (!snapshot) {
    return (
      <Card>
        <CardHeader title="Config Snapshot" />
        <CardContent>
          <p className="text-sm text-gray-500 text-center py-4">
            No config snapshot available for this run
          </p>
        </CardContent>
      </Card>
    );
  }

  const promptNames = Object.keys(snapshot.prompts);
  const blockedNames = Object.keys(snapshot.blockedPrompts || {});

  const togglePrompt = (name: string) => {
    setExpandedPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Runtime Config */}
      <Card>
        <CardHeader
          title="Runtime Configuration"
          description={`Resolved at ${new Date(snapshot.resolvedAt).toLocaleString()}`}
        />
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase">Max Concurrency</p>
              <p className="text-sm font-medium">{snapshot.runtime.maxConcurrency}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Force Fallback Model</p>
              <p className="text-sm font-medium">
                {snapshot.runtime.forceFallbackModel || "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Daily Cost Cap</p>
              <p className="text-sm font-medium">${snapshot.runtime.dailyCostCap}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Max Output Tokens</p>
              <p className="text-sm font-medium">
                {snapshot.runtime.caps.maxTokensOutput.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Max Image Bytes</p>
              <p className="text-sm font-medium">
                {formatBytes(snapshot.runtime.caps.maxImageBytes)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Model Allow List</p>
              <p className="text-sm font-medium">
                {snapshot.runtime.modelAllowList.length > 0
                  ? snapshot.runtime.modelAllowList.join(", ")
                  : "Any"}
              </p>
            </div>
          </div>
          {snapshot.runtime.disabledPrompts.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 uppercase mb-2">Disabled Prompts</p>
              <div className="flex flex-wrap gap-2">
                {snapshot.runtime.disabledPrompts.map((name) => (
                  <Badge key={name} variant="warning">
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Blocked Prompts */}
      {blockedNames.length > 0 && (
        <Card>
          <CardHeader
            title="Blocked Prompts"
            description={`${blockedNames.length} prompt${blockedNames.length !== 1 ? "s" : ""} blocked`}
          />
          <CardContent>
            <div className="space-y-2">
              {blockedNames.map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between p-3 bg-red-50 rounded-lg"
                >
                  <span className="font-medium text-red-800">{name}</span>
                  <span className="text-sm text-red-600">
                    {snapshot.blockedPrompts[name]}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resolved Prompts */}
      <Card>
        <CardHeader
          title="Resolved Prompts"
          description={`${promptNames.length} prompt${promptNames.length !== 1 ? "s" : ""} resolved`}
        />
        <div className="divide-y divide-gray-100">
          {promptNames.map((name) => {
            const prompt = snapshot.prompts[name];
            const isExpanded = expandedPrompts.has(name);

            return (
              <div key={name}>
                <button
                  onClick={() => togglePrompt(name)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                  )}
                  <span className="font-medium text-gray-900">{name}</span>
                  <Badge>{prompt.model}</Badge>
                  <Badge
                    variant={
                      prompt.source === "override"
                        ? "warning"
                        : prompt.source === "system-fallback"
                        ? "default"
                        : "success"
                    }
                  >
                    {prompt.source}
                  </Badge>
                  {prompt.version && (
                    <span className="text-xs text-gray-500">v{prompt.version}</span>
                  )}
                  <span className="text-xs text-gray-400 font-mono ml-auto">
                    {truncateId(prompt.templateHash, 8)}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pl-10 space-y-4">
                    {/* Prompt Details */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Definition ID</p>
                        <p className="text-xs font-mono text-gray-700 truncate">
                          {prompt.promptDefinitionId}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Version ID</p>
                        <p className="text-xs font-mono text-gray-700 truncate">
                          {prompt.promptVersionId || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Resolution Hash</p>
                        <p className="text-xs font-mono text-gray-700 truncate">
                          {prompt.resolutionHash}
                        </p>
                      </div>
                    </div>

                    {/* Overrides Applied */}
                    {prompt.overridesApplied.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase mb-2">
                          Overrides Applied
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {prompt.overridesApplied.map((override) => (
                            <Badge key={override} variant="warning">
                              {override}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Parameters */}
                    {Object.keys(prompt.params).length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase mb-2">Parameters</p>
                        <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto">
                          {JSON.stringify(prompt.params, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Templates */}
                    {prompt.templates.system && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase mb-2">
                          System Template
                        </p>
                        <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap">
                          {prompt.templates.system}
                        </pre>
                      </div>
                    )}
                    {prompt.templates.developer && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase mb-2">
                          Developer Template
                        </p>
                        <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap">
                          {prompt.templates.developer}
                        </pre>
                      </div>
                    )}
                    {prompt.templates.user && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase mb-2">
                          User Template
                        </p>
                        <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap">
                          {prompt.templates.user}
                        </pre>
                      </div>
                    )}

                    {/* Messages */}
                    {prompt.messages.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase mb-2">
                          Rendered Messages ({prompt.messages.length})
                        </p>
                        <div className="space-y-2">
                          {prompt.messages.map((msg, i) => (
                            <div key={i} className="p-2 bg-gray-50 rounded">
                              <Badge
                                variant={
                                  msg.role === "system"
                                    ? "default"
                                    : msg.role === "developer"
                                    ? "warning"
                                    : "success"
                                }
                                className="mb-1"
                              >
                                {msg.role}
                              </Badge>
                              <pre className="text-xs text-gray-700 whitespace-pre-wrap mt-1">
                                {msg.content.length > 500
                                  ? `${msg.content.slice(0, 500)}...`
                                  : msg.content}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function RunPlaybackPage() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();

  const [reveal, setReveal] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("variants");
  const [selectedVariant, setSelectedVariant] = useState<{
    variant: VariantResult;
    index: number;
  } | null>(null);

  // Run detail query
  const runQuery = useQuery({
    queryKey: [...queryKeys.runs.detail(id), reveal],
    queryFn: () => getRun(id, reveal),
  });

  // Events query (enabled after run loads)
  const eventsQuery = useQuery({
    queryKey: [...queryKeys.runs.events(id), reveal],
    queryFn: () => getRunEvents(id, reveal),
    enabled: runQuery.isSuccess,
  });

  // Artifacts query (enabled after run loads)
  const artifactsQuery = useQuery({
    queryKey: [...queryKeys.runs.artifacts(id), reveal],
    queryFn: () => getRunArtifacts(id, reveal),
    enabled: runQuery.isSuccess,
  });

  // LLM Calls query (enabled after run loads)
  const llmCallsQuery = useQuery({
    queryKey: [...queryKeys.runs.llmCalls(id), reveal],
    queryFn: () => getRunLLMCalls(id, { reveal }),
    enabled: runQuery.isSuccess,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.runs.detail(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.runs.events(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.runs.artifacts(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.runs.llmCalls(id) });
  };

  const run = runQuery.data;
  const isRefreshing =
    runQuery.isFetching ||
    eventsQuery.isFetching ||
    artifactsQuery.isFetching ||
    llmCallsQuery.isFetching;

  // Build tabs with counts
  const tabs: Tab[] = [
    {
      id: "variants",
      label: "Variants",
      icon: <ImageIcon className="h-4 w-4" />,
      count: run?.variants.length,
    },
    {
      id: "llm-calls",
      label: "LLM Calls",
      icon: <Zap className="h-4 w-4" />,
      count: llmCallsQuery.data?.count,
    },
    {
      id: "config",
      label: "Config Snapshot",
      icon: <Settings className="h-4 w-4" />,
    },
    {
      id: "timeline",
      label: "Timeline",
      icon: <BarChart3 className="h-4 w-4" />,
      count: eventsQuery.data?.events.length,
    },
    {
      id: "artifacts",
      label: "Artifacts",
      icon: <FileText className="h-4 w-4" />,
      count: artifactsQuery.data?.artifacts.length,
    },
  ];

  return (
    <Shell>
      {/* Back Link */}
      <div className="mb-4">
        <Link
          href="/runs"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Runs
        </Link>
      </div>

      {/* Header */}
      <PageHeader
        title={run ? `Run ${truncateId(run.id)}` : "Run Details"}
        description={
          run ? `${run.productTitle || "Unknown product"}` : "Loading..."
        }
      >
        <div className="flex items-center gap-4">
          <Toggle
            checked={reveal}
            onChange={setReveal}
            label="Reveal"
            disabled={isRefreshing}
          />
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md",
              "text-gray-700 bg-white border border-gray-300",
              "hover:bg-gray-50 disabled:opacity-50"
            )}
          >
            <RefreshCw
              className={cn("h-4 w-4", isRefreshing && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </PageHeader>

      {/* Run Info Card */}
      {runQuery.isLoading ? (
        <RunInfoSkeleton />
      ) : runQuery.isError ? (
        <ErrorPanel
          message="Failed to load run details"
          onRetry={() => runQuery.refetch()}
        />
      ) : run ? (
        <Card className="mb-6">
          <CardContent>
            {/* Top row: ID and Status */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900 font-mono">
                  {truncateId(run.id, 16)}
                </h2>
                <CopyButton value={run.id} label="Copy ID" />
              </div>
              <Badge variant={getStatusBadgeVariant(run.status)}>
                {run.status}
              </Badge>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-500 uppercase">Shop</p>
                <Link
                  href={`/shops/${run.shopId}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {run.shopDomain}
                </Link>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Product</p>
                <p className="text-sm text-gray-900 truncate">
                  {run.productTitle || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Created</p>
                <p
                  className="text-sm text-gray-900"
                  title={new Date(run.createdAt).toLocaleString()}
                >
                  {formatRelativeTime(run.createdAt)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Duration</p>
                <p className="text-sm text-gray-900">
                  {formatDuration(run.totalDurationMs)}
                </p>
              </div>
            </div>

            {/* IDs Row */}
            <div className="flex flex-wrap gap-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Run ID:</span>
                <span className="text-xs font-mono text-gray-700">
                  {truncateId(run.id, 12)}
                </span>
                <CopyButton value={run.id} />
              </div>
              {run.traceId && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Trace ID:</span>
                  <span className="text-xs font-mono text-gray-700">
                    {truncateId(run.traceId, 12)}
                  </span>
                  <CopyButton value={run.traceId} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Request ID:</span>
                <span className="text-xs font-mono text-gray-700">
                  {truncateId(run.requestId, 12)}
                </span>
                <CopyButton value={run.requestId} />
              </div>
            </div>

            {/* Model/Version Info */}
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Model:</span>
                <Badge>{run.model}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Prompt Pack:</span>
                <Badge>v{run.promptPackVersion}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Variants:</span>
                <span className="text-sm text-gray-700">
                  {run.successCount} / {run.variants.length} success
                </span>
              </div>
              {run.telemetryDropped && (
                <Badge variant="warning">Telemetry Dropped</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Waterfall Panel - Enhanced */}
      {run && (run.waterfallMs || run.runTotals) && (
        <WaterfallPanel waterfallMs={run.waterfallMs} runTotals={run.runTotals} />
      )}

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Content */}
      {activeTab === "variants" && (
        <div>
          {runQuery.isLoading ? (
            <VariantGridSkeleton />
          ) : runQuery.isError ? (
            <ErrorPanel
              message="Failed to load variants"
              onRetry={() => runQuery.refetch()}
            />
          ) : run && run.variants.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {run.variants.map((variant, index) => (
                <VariantCard
                  key={variant.id}
                  variant={variant}
                  index={index}
                  onClick={() => setSelectedVariant({ variant, index })}
                />
              ))}
            </div>
          ) : run ? (
            <Card>
              <CardContent>
                <p className="text-sm text-gray-500 text-center py-4">
                  No variants found
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {activeTab === "llm-calls" && (
        <LLMCallsPanel
          calls={llmCallsQuery.data?.llmCalls || []}
          runStartTime={run ? new Date(run.createdAt) : new Date()}
          isLoading={llmCallsQuery.isLoading}
          isError={llmCallsQuery.isError}
          onRetry={() => llmCallsQuery.refetch()}
        />
      )}

      {activeTab === "config" && (
        <ConfigSnapshotPanel snapshot={run?.resolvedConfigSnapshot} />
      )}

      {activeTab === "timeline" && (
        <TimelinePanel
          events={eventsQuery.data?.events || []}
          runStartTime={run ? new Date(run.createdAt) : new Date()}
          isLoading={eventsQuery.isLoading}
          isError={eventsQuery.isError}
          onRetry={() => eventsQuery.refetch()}
        />
      )}

      {activeTab === "artifacts" && (
        <ArtifactsPanel
          artifacts={artifactsQuery.data?.artifacts || []}
          reveal={reveal}
          isLoading={artifactsQuery.isLoading}
          isError={artifactsQuery.isError}
          onRetry={() => artifactsQuery.refetch()}
        />
      )}

      {/* Variant Modal */}
      {selectedVariant && (
        <VariantModal
          variant={selectedVariant.variant}
          index={selectedVariant.index}
          onClose={() => setSelectedVariant(null)}
        />
      )}
    </Shell>
  );
}
