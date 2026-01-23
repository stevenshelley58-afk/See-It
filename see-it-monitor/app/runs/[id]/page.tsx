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
  queryKeys,
} from "@/lib/api";
import type { VariantResult, RunEvent, RunArtifact } from "@/lib/types";
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
      return "success";
    case "partial":
    case "pending":
    case "processing":
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
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
    >
      <CardContent className="p-3">
        <button
          onClick={onClick}
          className="w-full text-left"
        >
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
              <span className="font-mono text-sm">{truncateId(variant.variantId, 16)}</span>
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
              <span className="font-mono text-sm">{truncateId(variant.id, 16)}</span>
              <CopyButton value={variant.id} />
            </div>
          </div>
        </div>

        {/* Error Details */}
        {variant.errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-600 font-medium uppercase mb-1">Error</p>
            {variant.errorCode && (
              <p className="text-sm text-red-700 font-mono mb-1">{variant.errorCode}</p>
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
  if (isError) return <ErrorPanel message="Failed to load events" onRetry={onRetry} />;

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
          <p className="text-sm text-gray-500 text-center py-4">No events recorded</p>
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
  if (isError) return <ErrorPanel message="Failed to load artifacts" onRetry={onRetry} />;

  return (
    <Card>
      <CardHeader
        title="Artifacts"
        description={`${artifacts.length} artifact${artifacts.length !== 1 ? "s" : ""}`}
      />
      {artifacts.length === 0 ? (
        <CardContent>
          <p className="text-sm text-gray-500 text-center py-4">No artifacts found</p>
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
// Main Page Component
// =============================================================================

export default function RunPlaybackPage() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();

  const [reveal, setReveal] = useState(false);
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

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.runs.detail(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.runs.events(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.runs.artifacts(id) });
  };

  const run = runQuery.data;
  const isRefreshing =
    runQuery.isFetching || eventsQuery.isFetching || artifactsQuery.isFetching;

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
        description={run ? `${run.productTitle || "Unknown product"}` : "Loading..."}
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

      {/* Variant Grid */}
      <div className="mb-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Variants</h3>
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

      {/* Timeline Panel */}
      <div className="mb-6">
        <TimelinePanel
          events={eventsQuery.data?.events || []}
          runStartTime={run ? new Date(run.createdAt) : new Date()}
          isLoading={eventsQuery.isLoading}
          isError={eventsQuery.isError}
          onRetry={() => eventsQuery.refetch()}
        />
      </div>

      {/* Artifacts Panel */}
      <ArtifactsPanel
        artifacts={artifactsQuery.data?.artifacts || []}
        reveal={reveal}
        isLoading={artifactsQuery.isLoading}
        isError={artifactsQuery.isError}
        onRetry={() => artifactsQuery.refetch()}
      />

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
