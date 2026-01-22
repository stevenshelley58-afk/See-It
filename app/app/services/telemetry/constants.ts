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
  SHORT: "short", // 7 days
  STANDARD: "standard", // 30 days
  LONG: "long", // 90 days
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
