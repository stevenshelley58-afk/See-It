# Step 06: Telemetry Index (Public API)

## Context

You are working on a Shopify Remix app. You have created all telemetry module files. Now create the barrel export that defines the public API.

## Task

Create the index.ts that exports only the public API.

## Instructions

1. Create `app/services/telemetry/index.ts`:

```typescript
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
  ImageMeta,
  TraceContext,
} from "./types";
```

## Verification

Run this test to verify the module works:

```typescript
// In a temporary test file or the Remix shell:
import {
  startRun,
  emit,
  EventSource,
  EventType,
} from "~/services/telemetry";

// These should all resolve without errors
console.log("EventSource.RENDERER:", EventSource.RENDERER);
console.log("EventType.RENDER_RUN_CREATED:", EventType.RENDER_RUN_CREATED);
console.log("emit function exists:", typeof emit === "function");
console.log("startRun function exists:", typeof startRun === "function");
```

Also verify with TypeScript:
```bash
npx tsc --noEmit
```

## Do Not

- Do not export internal implementation details
- Do not export prisma directly
- Do not add any logic to index.ts (it's just re-exports)
