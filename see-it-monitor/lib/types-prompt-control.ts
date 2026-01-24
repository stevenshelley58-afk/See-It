// =============================================================================
// PROMPT CONTROL PLANE - TypeScript Types
// Based on PRD Section 4 (types-prompt-control.ts)
// =============================================================================

// =============================================================================
// Enums (matching Prisma)
// =============================================================================

export type PromptStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type CallStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "TIMEOUT";

export type AuditAction =
  | "PROMPT_CREATE"
  | "PROMPT_UPDATE_DRAFT"
  | "PROMPT_ACTIVATE"
  | "PROMPT_ARCHIVE"
  | "PROMPT_ROLLBACK"
  | "RUNTIME_UPDATE"
  | "TEST_RUN";

// =============================================================================
// Message Structure
// =============================================================================

export interface PromptMessage {
  role: "system" | "developer" | "user";
  content: string;
}

// =============================================================================
// Override Shape (full template support)
// =============================================================================

export interface PromptOverride {
  systemTemplate?: string;
  developerTemplate?: string;
  userTemplate?: string;
  model?: string;
  params?: Record<string, unknown>;
}

export type RunPromptOverrides = Record<string, PromptOverride>;

// =============================================================================
// Resolved Prompt (output of resolver)
// =============================================================================

export interface ResolvedPrompt {
  promptDefinitionId: string;
  promptVersionId: string | null; // Always stored, even if overridden
  version: number | null;
  templateHash: string; // From PromptVersion, NOT recomputed
  model: string;
  params: Record<string, unknown>;
  messages: PromptMessage[];
  templates: {
    system: string | null;
    developer: string | null;
    user: string | null;
  };
  resolutionHash: string; // Hash of rendered messages + model + params
  source: "active" | "system-fallback" | "override";
  overridesApplied: string[];
}

// =============================================================================
// Runtime Config Snapshot
// =============================================================================

export interface RuntimeConfigSnapshot {
  maxConcurrency: number;
  forceFallbackModel: string | null;
  modelAllowList: string[];
  caps: {
    maxTokensOutput: number;
    maxImageBytes: number;
  };
  dailyCostCap: number;
  disabledPrompts: string[];
}

// =============================================================================
// Resolved Config Snapshot (stored per-run)
// =============================================================================

export interface ResolvedConfigSnapshot {
  resolvedAt: string;
  runtime: RuntimeConfigSnapshot;
  prompts: Record<string, ResolvedPrompt>;
  blockedPrompts: Record<string, string>; // promptName -> reason
}

// =============================================================================
// Waterfall Timing
// =============================================================================

export interface WaterfallMs {
  download_ms: number;
  prompt_build_ms: number;
  inference_ms: number;
  inference_p50_ms?: number;
  inference_p95_ms?: number;
  upload_ms: number;
  total_ms: number;
}

// =============================================================================
// Run Totals
// =============================================================================

export interface RunTotals {
  tokens_in: number;
  tokens_out: number;
  cost_estimate: number;
  calls_total: number;
  calls_succeeded: number;
  calls_failed: number;
  calls_timeout: number;
}

// =============================================================================
// API Types - Section 4.2
// =============================================================================

// -----------------------------------------------------------------------------
// GET /api/shops/:shopId/prompts
// -----------------------------------------------------------------------------

export interface PromptListResponse {
  prompts: PromptSummary[];
}

export interface PromptSummary {
  id: string;
  name: string;
  description: string | null;
  defaultModel: string;
  activeVersion: VersionSummary | null;
  draftVersion: VersionSummary | null;
  metrics: PromptMetrics;
  isDisabled: boolean;
}

export interface VersionSummary {
  id: string;
  version: number;
  model: string | null;
  templateHash: string;
  createdAt: string;
  activatedAt: string | null;
}

export interface PromptMetrics {
  calls24h: number;
  successRate24h: number;
  latencyP50: number | null;
  latencyP95: number | null;
  avgCost: number | null;
}

// -----------------------------------------------------------------------------
// GET /api/shops/:shopId/prompts/:name
// -----------------------------------------------------------------------------

export interface PromptDetailResponse {
  definition: {
    id: string;
    name: string;
    description: string | null;
    defaultModel: string;
    defaultParams: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  activeVersion: VersionDetail | null;
  draftVersion: VersionDetail | null;
  versions: VersionSummary[];
  metrics: PromptMetrics;
}

export interface VersionDetail {
  id: string;
  version: number;
  status: PromptStatus;
  systemTemplate: string | null;
  developerTemplate: string | null;
  userTemplate: string | null;
  model: string | null;
  params: Record<string, unknown> | null;
  templateHash: string;
  changeNotes: string | null;
  createdAt: string;
  createdBy: string;
  activatedAt: string | null;
  activatedBy: string | null;
}

// -----------------------------------------------------------------------------
// POST /api/shops/:shopId/prompts/:name/versions
// -----------------------------------------------------------------------------

export interface CreateVersionRequest {
  systemTemplate?: string;
  developerTemplate?: string;
  userTemplate?: string;
  model?: string;
  params?: Record<string, unknown>;
  changeNotes?: string;
}

// -----------------------------------------------------------------------------
// POST /api/shops/:shopId/prompts/:name/activate
// -----------------------------------------------------------------------------

export interface ActivateVersionRequest {
  versionId: string;
}

// -----------------------------------------------------------------------------
// POST /api/shops/:shopId/prompts/:name/test
// -----------------------------------------------------------------------------

export interface TestPromptRequest {
  variables?: Record<string, string>;
  imageRefs?: string[];
  overrides?: PromptOverride;
  versionId?: string;
}

export interface TestPromptResponse {
  testRunId: string;
  status: "succeeded" | "failed";
  output: unknown;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costEstimate: number;
  providerRequestId: string | null;
  providerModel: string;
  messages: PromptMessage[];
  resolutionHash: string;
}

// -----------------------------------------------------------------------------
// GET/PATCH /api/shops/:shopId/runtime-config
// -----------------------------------------------------------------------------

export interface RuntimeConfigResponse {
  config: {
    id: string;
    maxConcurrency: number;
    forceFallbackModel: string | null;
    modelAllowList: string[];
    maxTokensOutputCap: number;
    maxImageBytesCap: number;
    dailyCostCap: number;
    disabledPromptNames: string[];
    updatedAt: string;
    updatedBy: string;
  };
  status: {
    currentConcurrency: number;
    dailyCostUsed: number;
  };
}

export interface UpdateRuntimeConfigRequest {
  maxConcurrency?: number;
  forceFallbackModel?: string | null;
  modelAllowList?: string[];
  maxTokensOutputCap?: number;
  maxImageBytesCap?: number;
  dailyCostCap?: number;
  disabledPromptNames?: string[];
}

// =============================================================================
// Additional API Types (for UI completeness)
// =============================================================================

// -----------------------------------------------------------------------------
// LLM Call Detail (for Run detail page)
// -----------------------------------------------------------------------------

export interface LLMCallDetail {
  id: string;
  promptName: string;
  promptVersionId: string | null;
  model: string;
  status: CallStatus;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costEstimate: number | null;
  errorType: string | null;
  errorMessage: string | null;
  providerRequestId: string | null;
  providerModel: string | null;
  resolutionHash: string;
  requestHash: string;
}

// -----------------------------------------------------------------------------
// Audit Log Types
// -----------------------------------------------------------------------------

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  cursor: string | null;
  total: number;
}

export interface AuditLogEntry {
  id: string;
  shopId: string;
  actor: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  targetName: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Model Definitions (for UI dropdowns)
// -----------------------------------------------------------------------------

export interface ModelDefinition {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "google" | "custom";
  contextWindow: number;
  maxOutputTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  supportsVision: boolean;
  supportsImageOutput: boolean;
}

export const KNOWN_MODELS: ModelDefinition[] = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    costPer1kInput: 0.000075,
    costPer1kOutput: 0.0003,
    supportsVision: true,
    supportsImageOutput: true,
  },
  {
    id: "gemini-2.5-flash-image",
    name: "Gemini 2.5 Flash (Image)",
    provider: "google",
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    costPer1kInput: 0.000075,
    costPer1kOutput: 0.0003,
    supportsVision: true,
    supportsImageOutput: true,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
    supportsVision: true,
    supportsImageOutput: false,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    supportsVision: true,
    supportsImageOutput: false,
  },
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    supportsVision: true,
    supportsImageOutput: false,
  },
];

// -----------------------------------------------------------------------------
// Utility Types
// -----------------------------------------------------------------------------

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  total?: number;
  hasMore: boolean;
}

// -----------------------------------------------------------------------------
// Config Diff Types (for comparing run config vs current)
// -----------------------------------------------------------------------------

export interface ConfigDiff {
  prompts: Record<string, PromptDiff>;
  runtime: RuntimeDiff | null;
}

export interface PromptDiff {
  promptName: string;
  hasChanges: boolean;
  changes: {
    field: string;
    runValue: unknown;
    currentValue: unknown;
  }[];
}

export interface RuntimeDiff {
  hasChanges: boolean;
  changes: {
    field: string;
    runValue: unknown;
    currentValue: unknown;
  }[];
}
