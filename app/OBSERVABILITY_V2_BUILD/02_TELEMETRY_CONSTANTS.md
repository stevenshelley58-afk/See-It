# Step 02: Telemetry Constants and Types

## Context

You are working on a Shopify Remix app. You just added observability tables to the database. Now create the telemetry module constants and types.

## Task

Create the constants and types files for the telemetry module.

## Instructions

1. Create directory `app/services/telemetry/`

2. Create `app/services/telemetry/constants.ts`:

```typescript
/**
 * Telemetry Constants
 * 
 * Event sources, types, severities, and artifact types.
 */

// Where the event originated
export const EventSource = {
  STOREFRONT: "storefront",
  APP_PROXY: "app_proxy", 
  ADMIN_APP: "admin_app",
  PREP: "prep",
  PROMPT_BUILDER: "prompt_builder",
  RENDERER: "renderer",
  PROVIDER: "provider",
  STORAGE: "storage",
} as const;

export type EventSource = (typeof EventSource)[keyof typeof EventSource];

// What happened
export const EventType = {
  // Storefront
  SF_SESSION_STARTED: "sf.session.started",
  SF_PHOTO_CAPTURED: "sf.photo.captured",
  SF_UPLOAD_STARTED: "sf.upload.started",
  SF_UPLOAD_COMPLETED: "sf.upload.completed",
  SF_RENDER_REQUESTED: "sf.render.requested",
  
  // Prep
  PREP_STARTED: "prep.started",
  PREP_STEP_COMPLETED: "prep.step.completed",
  PREP_COMPLETED: "prep.completed",
  PREP_FAILED: "prep.failed",
  
  // Prompt
  PROMPT_RESOLVER_STARTED: "prompt.resolver.started",
  PROMPT_RESOLVER_COMPLETED: "prompt.resolver.completed",
  PROMPT_BUILDER_STARTED: "prompt.builder.started",
  PROMPT_BUILDER_COMPLETED: "prompt.builder.completed",
  
  // Render
  RENDER_RUN_CREATED: "render.run.created",
  RENDER_VARIANT_STARTED: "render.variant.started",
  RENDER_PROVIDER_REQUESTED: "render.provider.requested",
  RENDER_PROVIDER_COMPLETED: "render.provider.completed",
  RENDER_VARIANT_COMPLETED: "render.variant.completed",
  RENDER_RUN_COMPLETED: "render.run.completed",
  
  // Storage
  STORAGE_UPLOAD_STARTED: "storage.upload.started",
  STORAGE_UPLOAD_COMPLETED: "storage.upload.completed",
  STORAGE_SIGNED_URL_ISSUED: "storage.signed_url.issued",
  
  // Error
  ERROR: "error",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

// Severity levels
export const Severity = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

// Artifact types
export const ArtifactType = {
  CUSTOMER_ROOM_IMAGE: "customer_room_image",
  PREPARED_ROOM_IMAGE: "prepared_room_image",
  PREPARED_PRODUCT_IMAGE: "prepared_product_image",
  PROVIDER_REQUEST: "provider_request",
  PROVIDER_RESPONSE: "provider_response",
  FINAL_PROMPT: "final_prompt",
  RESOLVED_FACTS: "resolved_facts",
  PROMPT_PACK: "prompt_pack",
  OUTPUT_IMAGE: "output_image",
  SESSION_LOG: "session_log",
  DEBUG_BUNDLE: "debug_bundle",
} as const;

export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];

// Retention classes
export const RetentionClass = {
  SHORT: "short",       // 7 days
  STANDARD: "standard", // 30 days  
  LONG: "long",         // 90 days
} as const;

export type RetentionClass = (typeof RetentionClass)[keyof typeof RetentionClass];

// Retention days mapping
export const RETENTION_DAYS: Record<RetentionClass, number> = {
  short: 7,
  standard: 30,
  long: 90,
};

// Max payload size before overflow to artifact
export const MAX_PAYLOAD_SIZE = 10000;

// Current schema version
export const SCHEMA_VERSION = 1;
```

3. Create `app/services/telemetry/types.ts`:

```typescript
/**
 * Telemetry Types
 * 
 * Input types for all telemetry functions.
 */

import type { EventSource, EventType, Severity, ArtifactType, RetentionClass } from "./constants";

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
```

## Verification

- Files exist at correct paths
- No TypeScript errors: `npx tsc --noEmit`
- Imports work: add temporary `import { EventSource } from "./constants"` in types.ts

## Do Not

- Do not create index.ts yet (that's step 06)
- Do not add any external dependencies
