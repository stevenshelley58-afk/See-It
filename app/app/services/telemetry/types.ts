/**
 * Telemetry Types
 *
 * Input types for all telemetry functions.
 */

import type {
  EventSource,
  EventType,
  Severity,
  ArtifactType,
  RetentionClass,
} from "./constants";

// =============================================================================
// Event Input
// =============================================================================

export interface TelemetryEventInput {
  // Required correlation
  shopId: string;
  requestId: string;

  // Optional correlation
  runId?: string;
  variantId?: string;

  // Trace context
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;

  // Event classification
  source: EventSource;
  type: EventType | string; // Allow string for custom types
  severity?: Severity;

  // Payload
  payload?: Record<string, unknown>;
}

// =============================================================================
// Artifact Input
// =============================================================================

export interface ArtifactInput {
  shopId: string;
  requestId: string;
  runId?: string;
  variantId?: string;

  type: ArtifactType | string;

  // Provide buffer for new upload, or existingGcsKey to index existing file
  buffer?: Buffer;
  existingGcsKey?: string;

  contentType: string;
  retentionClass?: RetentionClass;

  // Image metadata
  width?: number;
  height?: number;

  // Additional metadata
  meta?: Record<string, unknown>;
}

// =============================================================================
// Rollup Inputs
// =============================================================================

export interface StartRunInput {
  runId: string;
  shopId: string;
  requestId: string;
  productAssetId: string;
  roomSessionId: string | null;
  promptPackVersion: number;
  model: string;
  traceId?: string;

  // Image info
  productImageHash: string;
  productImageMeta: ImageMeta;
  roomImageHash: string;
  roomImageMeta: ImageMeta;

  // Snapshots
  resolvedFactsHash: string;
  resolvedFactsJson: Record<string, unknown>;
  promptPackHash: string;
  promptPackJson: Record<string, unknown>;
}

export interface RecordVariantStartInput {
  runId: string;
  variantId: string;
  requestId: string;
  shopId: string;
}

export interface RecordVariantResultInput {
  renderRunId: string;
  variantId: string;
  finalPromptHash: string;
  requestId: string;
  shopId: string;

  status: "success" | "failed" | "timeout";

  // Timing
  startedAt?: Date;
  completedAt?: Date;
  latencyMs?: number;
  providerMs?: number;
  uploadMs?: number;

  // Output
  outputImageKey?: string;
  outputImageHash?: string;
  outputArtifactId?: string;

  // Error
  errorCode?: string;
  errorMessage?: string;
}

export interface CompleteRunInput {
  runId: string;
  requestId: string;
  shopId: string;
  status: "complete" | "partial" | "failed";
  totalDurationMs: number;
  successCount: number;
  failCount: number;
  timeoutCount: number;
}

// =============================================================================
// Supporting Types
// =============================================================================

export interface ImageMeta {
  width: number;
  height: number;
  bytes: number;
  format: string;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}
