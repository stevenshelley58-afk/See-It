/**
 * Telemetry Module - Public API
 *
 * This is the ONLY interface the rest of the app should use for observability.
 *
 * Usage:
 *   import { startRun, emit, storeArtifact } from "~/services/telemetry";
 */

// =============================================================================
// Event Emission
// =============================================================================

export { emit, emitAsync, emitError } from "./emitter.server";

// =============================================================================
// Rollup Writes (RenderRun / VariantResult)
// =============================================================================

export {
  startRun,
  recordVariantStart,
  recordVariantResult,
  completeRun,
} from "./rollups.server";

// =============================================================================
// Artifact Management
// =============================================================================

export {
  storeArtifact,
  getArtifactUrl,
  getSignedUrl,
  indexExistingArtifact,
} from "./artifacts.server";

// =============================================================================
// Constants
// =============================================================================

export {
  EventSource,
  EventType,
  Severity,
  ArtifactType,
  RetentionClass,
  RETENTION_DAYS,
  MAX_PAYLOAD_SIZE,
  SCHEMA_VERSION,
} from "./constants";

// =============================================================================
// Types
// =============================================================================

export type {
  TelemetryEventInput,
  ArtifactInput,
  StartRunInput,
  RecordVariantStartInput,
  RecordVariantResultInput,
  CompleteRunInput,
  TraceContext,
} from "./types";
