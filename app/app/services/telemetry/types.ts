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
  productAssetId: string;
  roomSessionId: string | null;
  traceId: string;

  // Image references
  preparedProductImageRef: string;
  preparedProductImageHash?: string;
  roomImageRef: string;
  roomImageHash?: string;

  // Snapshots (canonical schema)
  resolvedFactsSnapshot: Record<string, unknown>;
  placementSetSnapshot: Record<string, unknown>;
  pipelineConfigSnapshot: Record<string, unknown>;
  pipelineConfigHash: string;
}

export interface RecordVariantStartInput {
  runId: string;
  variantId: string;
  shopId: string;
  traceId: string;
}

export interface RecordVariantResultInput {
  runId: string;
  variantId: string;
  shopId: string;
  traceId: string;

  status: "SUCCESS" | "FAILED" | "TIMEOUT";

  // Timing
  latencyMs?: number;

  // Output
  imageRef?: string;
  imageHash?: string;

  // Error
  errorCode?: string;
  errorMessage?: string;
}

export interface CompleteRunInput {
  runId: string;
  shopId: string;
  traceId: string;
  status: "COMPLETE" | "PARTIAL" | "FAILED";
  totalDurationMs: number;
  successCount: number;
  failCount: number;
  timeoutCount: number;
}

// =============================================================================
// Supporting Types
// =============================================================================

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}
