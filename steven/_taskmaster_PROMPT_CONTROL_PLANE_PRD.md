# Prompt Control Plane - Complete PRD
## Multi-Tenant SaaS Prompt Management System

---

# 1. Executive Summary

A production-grade prompt management system for AI rendering pipelines that enables:

- **DB-backed prompt registry** with versioning (draft → active → archived)
- **Multi-tenant architecture** (per-shop prompts and configs)
- **Runtime resolution** with per-run overrides and system fallbacks
- **Per-run config snapshots** for audit, replay, and debugging
- **One row per model call** (LLMCall table) with full instrumentation
- **UI to edit, test, activate, rollback** without deploys
- **Guardrails**: model allow-lists, output caps, budget caps, disabled prompts

---

# 2. Architecture Overview

## 2.1 Multi-Tenancy Model

- **Tenant = Shop** (`shopId` is the tenant identifier)
- Every prompt definition, version, config, and audit record is scoped to a shop
- **System tenant** (`SYSTEM_TENANT_ID = "SYSTEM"`) provides global fallback prompts
- Resolution order: Shop prompt → System prompt → Error

## 2.2 Prompt Structure

Prompts have **multiple message templates** (not a single role):
- `systemTemplate` - System instructions
- `developerTemplate` - Developer context (optional)
- `userTemplate` - User message with variables

The resolver builds a `messages[]` array with proper roles for the provider.

## 2.3 Hashing Strategy

| Hash | Purpose | Computed From |
|------|---------|---------------|
| `templateHash` | Version identity | Raw templates + model + params (stored on PromptVersion) |
| `resolutionHash` | Call identity | Rendered messages + resolved model + resolved params |
| `requestHash` | Deduplication | promptName + resolutionHash + sorted(imageRefs) |

**Critical**: `templateHash` is NEVER recomputed in the resolver. It's read from `PromptVersion.templateHash`.

## 2.4 Resolution Precedence

For each field (template, model, params):
1. Per-run override (if provided)
2. Active PromptVersion
3. PromptDefinition defaults
4. System tenant fallback (for missing shop prompts)

Runtime config caps are applied last (e.g., `max_tokens` capped to `maxTokensOutputCap`).

---

# 3. Database Schema

## 3.1 Enums

```prisma
enum PromptStatus {
  DRAFT      // Work in progress
  ACTIVE     // Currently deployed
  ARCHIVED   // Previous version, kept for audit
}

enum CallStatus {
  STARTED
  SUCCEEDED
  FAILED
  TIMEOUT
}

enum AuditAction {
  PROMPT_CREATE
  PROMPT_UPDATE_DRAFT
  PROMPT_ACTIVATE
  PROMPT_ARCHIVE
  PROMPT_ROLLBACK
  RUNTIME_UPDATE
  TEST_RUN
}
```

## 3.2 PromptDefinition

The prompt "type" - one per prompt name per shop.

```prisma
model PromptDefinition {
  id          String  @id @default(cuid())
  shopId      String  @map("shop_id")
  name        String  // e.g., "extractor", "prompt_builder", "global_render"
  description String?

  // Defaults (fallback if version doesn't specify)
  defaultModel  String @default("gemini-2.5-flash") @map("default_model")
  defaultParams Json?  @map("default_params")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  shop     Shop            @relation(fields: [shopId], references: [id], onDelete: Cascade)
  versions PromptVersion[]

  @@unique([shopId, name])
  @@index([shopId])
  @@map("prompt_definitions")
}
```

## 3.3 PromptVersion

The actual prompt content with versioning.

```prisma
model PromptVersion {
  id                 String       @id @default(cuid())
  promptDefinitionId String       @map("prompt_definition_id")
  version            Int          // Auto-incremented per definition (in transaction)
  status             PromptStatus @default(DRAFT)

  // Message templates (at least one required, validated in code)
  systemTemplate    String? @db.Text @map("system_template")
  developerTemplate String? @db.Text @map("developer_template")
  userTemplate      String? @db.Text @map("user_template")

  // Model config (overrides definition defaults)
  model  String?
  params Json?

  // Identity hash: SHA256 of templates + model + params
  // STORED ON CREATE, NOT RECOMPUTED
  templateHash String @map("template_hash")

  // Metadata
  changeNotes String? @map("change_notes")

  createdAt   DateTime  @default(now()) @map("created_at")
  createdBy   String    @map("created_by")
  activatedAt DateTime? @map("activated_at")
  activatedBy String?   @map("activated_by")

  promptDefinition PromptDefinition @relation(fields: [promptDefinitionId], references: [id], onDelete: Cascade)
  llmCalls         LLMCall[]

  @@unique([promptDefinitionId, version])
  @@index([promptDefinitionId, status])
  @@map("prompt_versions")
}
```

**Version Number Assignment**: Handled in a `Serializable` transaction:
1. Read `MAX(version)` for the definition
2. Insert new version = max + 1
3. Transaction isolation prevents race conditions

**Active Version Uniqueness**: Enforced transactionally in `activateVersion()`:
1. Archive current active version
2. Set new version to ACTIVE
3. Both in same `Serializable` transaction

## 3.4 ShopRuntimeConfig

Per-tenant runtime configuration.

```prisma
model ShopRuntimeConfig {
  id     String @id @default(cuid())
  shopId String @unique @map("shop_id")

  // Concurrency
  maxConcurrency Int @default(5) @map("max_concurrency")

  // Model controls
  forceFallbackModel String?  @map("force_fallback_model")
  modelAllowList     String[] @default([]) @map("model_allow_list")

  // Caps
  maxTokensOutputCap Int @default(8192) @map("max_tokens_output_cap")
  maxImageBytesCap   Int @default(20000000) @map("max_image_bytes_cap")

  // Budget (daily)
  dailyCostCap Decimal @default(50.00) @db.Decimal(10, 2) @map("daily_cost_cap")

  // Disabled prompts (by name)
  disabledPromptNames String[] @default([]) @map("disabled_prompt_names")

  updatedAt DateTime @updatedAt @map("updated_at")
  updatedBy String   @map("updated_by")

  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)

  @@map("shop_runtime_configs")
}
```

## 3.5 LLMCall

One row per model call - the core instrumentation table.

```prisma
model LLMCall {
  id String @id @default(cuid())

  // Tenant context
  shopId String @map("shop_id")

  // Run context (nullable for test calls)
  renderRunId     String? @map("render_run_id")
  variantResultId String? @map("variant_result_id")
  testRunId       String? @map("test_run_id")

  // Prompt info
  promptName      String  @map("prompt_name")
  promptVersionId String? @map("prompt_version_id") // Always stored, even if overridden

  // Model info
  model String

  // Hashes for identity and deduplication
  resolutionHash String @map("resolution_hash") // Hash of rendered call
  requestHash    String @map("request_hash")    // Hash for deduplication (sorted imageRefs)

  // Timing
  status     CallStatus
  startedAt  DateTime   @map("started_at")
  finishedAt DateTime?  @map("finished_at")
  latencyMs  Int?       @map("latency_ms")

  // Token usage
  tokensIn     Int?     @map("tokens_in")
  tokensOut    Int?     @map("tokens_out")
  costEstimate Decimal? @db.Decimal(10, 6) @map("cost_estimate")

  // Error tracking
  errorType    String? @map("error_type")
  errorMessage String? @map("error_message")
  retryCount   Int     @default(0) @map("retry_count")

  // Provider metadata
  providerRequestId String? @map("provider_request_id")
  providerModel     String? @map("provider_model")

  // References (truncated for storage)
  inputRef  Json? @map("input_ref")  // { messageCount, imageCount, preview, resolutionHash }
  outputRef Json? @map("output_ref") // { preview, length }

  createdAt DateTime @default(now()) @map("created_at")

  // Relations
  shop          Shop           @relation(fields: [shopId], references: [id], onDelete: Cascade)
  promptVersion PromptVersion? @relation(fields: [promptVersionId], references: [id])
  renderRun     RenderRun?     @relation(fields: [renderRunId], references: [id], onDelete: Cascade)
  testRun       PromptTestRun? @relation(fields: [testRunId], references: [id], onDelete: Cascade)

  @@index([shopId, createdAt])
  @@index([renderRunId])
  @@index([testRunId])
  @@index([promptName, createdAt])
  @@index([status, createdAt])
  @@map("llm_calls")
}
```

## 3.6 PromptTestRun

For test panel calls (separate from production runs).

```prisma
model PromptTestRun {
  id     String @id @default(cuid())
  shopId String @map("shop_id")

  promptName      String  @map("prompt_name")
  promptVersionId String? @map("prompt_version_id")

  // Test inputs
  variables Json?
  imageRefs String[] @default([]) @map("image_refs")

  // Overrides (full shape)
  overrides Json? // { systemTemplate?, developerTemplate?, userTemplate?, model?, params? }

  // Results
  status String // "running" | "succeeded" | "failed"
  output Json?

  // Metrics
  latencyMs    Int?     @map("latency_ms")
  tokensIn     Int?     @map("tokens_in")
  tokensOut    Int?     @map("tokens_out")
  costEstimate Decimal? @db.Decimal(10, 6) @map("cost_estimate")

  createdAt DateTime @default(now()) @map("created_at")
  createdBy String   @map("created_by")

  shop     Shop      @relation(fields: [shopId], references: [id], onDelete: Cascade)
  llmCalls LLMCall[]

  @@index([shopId, promptName, createdAt])
  @@map("prompt_test_runs")
}
```

## 3.7 PromptAuditLog

Per-tenant audit trail for all changes.

```prisma
model PromptAuditLog {
  id     String @id @default(cuid())
  shopId String @map("shop_id")

  actor      String      // User email or "system"
  action     AuditAction
  targetType String      @map("target_type")
  targetId   String      @map("target_id")
  targetName String?     @map("target_name")

  before Json? // State before change
  after  Json? // State after change

  ipAddress String? @map("ip_address")
  userAgent String? @map("user_agent")

  createdAt DateTime @default(now()) @map("created_at")

  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)

  @@index([shopId, createdAt])
  @@index([shopId, targetType, targetId])
  @@index([shopId, action])
  @@map("prompt_audit_log")
}
```

## 3.8 RenderRun Additions

Add these fields to existing RenderRun model:

```prisma
model RenderRun {
  // ... existing fields ...

  // Per-run overrides (optional)
  promptOverrides Json? @map("prompt_overrides")
  // Shape: { [promptName]: PromptOverride }

  // Complete resolved config snapshot (mandatory for audit/replay)
  resolvedConfigSnapshot Json @map("resolved_config_snapshot")
  // Shape: ResolvedConfigSnapshot

  // Waterfall timing
  waterfallMs Json? @map("waterfall_ms")
  // Shape: { download_ms, prompt_build_ms, inference_ms, upload_ms, total_ms }

  // Aggregated totals
  runTotals Json? @map("run_totals")
  // Shape: { tokens_in, tokens_out, cost_estimate, calls_total, calls_failed }

  // Relation to LLMCalls
  llmCalls LLMCall[]
}
```

## 3.9 Shop Additions

Add these relations to existing Shop model:

```prisma
model Shop {
  // ... existing fields ...

  promptDefinitions  PromptDefinition[]
  runtimeConfig      ShopRuntimeConfig?
  llmCalls           LLMCall[]
  promptTestRuns     PromptTestRun[]
  promptAuditLog     PromptAuditLog[]
}
```

---

# 4. TypeScript Types

## 4.1 Core Types

```typescript
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
  promptVersionId: string | null;  // Always stored, even if overridden
  version: number | null;
  templateHash: string;            // From PromptVersion, NOT recomputed
  model: string;
  params: Record<string, unknown>;
  messages: PromptMessage[];
  templates: {
    system: string | null;
    developer: string | null;
    user: string | null;
  };
  resolutionHash: string;          // Hash of rendered messages + model + params
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
  blockedPrompts: Record<string, string>;  // promptName -> reason
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
```

## 4.2 API Types

```typescript
// =============================================================================
// GET /api/shops/:shopId/prompts
// =============================================================================

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

// =============================================================================
// GET /api/shops/:shopId/prompts/:name
// =============================================================================

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

// =============================================================================
// POST /api/shops/:shopId/prompts/:name/versions
// =============================================================================

export interface CreateVersionRequest {
  systemTemplate?: string;
  developerTemplate?: string;
  userTemplate?: string;
  model?: string;
  params?: Record<string, unknown>;
  changeNotes?: string;
}

// =============================================================================
// POST /api/shops/:shopId/prompts/:name/activate
// =============================================================================

export interface ActivateVersionRequest {
  versionId: string;
}

// =============================================================================
// POST /api/shops/:shopId/prompts/:name/test
// =============================================================================

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

// =============================================================================
// GET/PATCH /api/shops/:shopId/runtime-config
// =============================================================================

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
```

---

# 5. Core Services

## 5.1 Prompt Resolver

**File**: `app/services/prompt-control/prompt-resolver.server.ts`

### Key Functions

```typescript
// Load runtime config ONCE (not per prompt)
export async function loadRuntimeConfig(shopId: string): Promise<RuntimeConfigSnapshot>

// Resolve a single prompt
export async function resolvePrompt(input: ResolvePromptInput): Promise<ResolvePromptResult>

// Build complete snapshot for a run
export async function buildResolvedConfigSnapshot(input: BuildSnapshotInput): Promise<ResolvedConfigSnapshot>

// Compute request hash (with sorted imageRefs)
export function computeRequestHash(promptName: string, resolutionHash: string, imageRefs: string[]): string
```

### Resolution Logic

```typescript
async function resolvePrompt(input) {
  // 1. Check if disabled
  if (runtimeConfig.disabledPrompts.includes(promptName)) {
    return { blocked: true, blockReason: "..." };
  }

  // 2. Load definition - shop first, then system fallback
  let definition = await findForShop(shopId, promptName);
  if (!definition) {
    definition = await findForShop(SYSTEM_TENANT_ID, promptName);
    isSystemFallback = true;
  }

  // 3. Resolve templates (override > version)
  const systemTemplate = override?.systemTemplate ?? activeVersion?.systemTemplate;
  // ... same for developer and user

  // 4. Resolve model (override > version > default > force fallback)
  let model = override?.model ?? activeVersion?.model ?? definition.defaultModel;
  if (runtimeConfig.forceFallbackModel) model = runtimeConfig.forceFallbackModel;

  // 5. Check model allow list
  if (allowList.length && !allowList.includes(model)) {
    return { blocked: true, blockReason: "Model not in allow list" };
  }

  // 6. Merge params (definition < version < override) and apply caps
  const params = { ...definition.defaultParams, ...activeVersion?.params, ...override?.params };
  if (params.max_tokens > caps.maxTokensOutput) params.max_tokens = caps.maxTokensOutput;

  // 7. Render templates with variables (supports dot paths)
  const messages = renderTemplates(templates, variables);

  // 8. Get templateHash from version (NOT recomputed)
  const templateHash = activeVersion?.templateHash ?? sha256("no-version");

  // 9. Compute resolutionHash (this IS computed)
  const resolutionHash = sha256(JSON.stringify({ messages, model, params }));

  return { resolved: { ... }, blocked: false };
}
```

### Template Rendering

Supports both simple and dot-path variables:

```typescript
// Matches {{word}} or {{word.word.word}}
template.replace(/\{\{([\w.]+)\}\}/g, (match, path) => {
  return resolveDotPath(variables, path) ?? match;
});

// Example:
// Template: "Product: {{product.title}}"
// Variables: { "product.title": "Teak Chair" }
// Result: "Product: Teak Chair"
```

## 5.2 Version Manager

**File**: `app/services/prompt-control/prompt-version-manager.server.ts`

### Key Functions

```typescript
// Create definition
export async function createPromptDefinition(input): Promise<PromptDefinition>

// Create version (race-safe)
export async function createVersion(input): Promise<PromptVersion>

// Activate version (race-safe)
export async function activateVersion(input): Promise<{ version, previousActiveId }>

// Rollback to previous
export async function rollbackToPreviousVersion(input): Promise<{ previousActiveId, newActiveId }>

// Archive version
export async function archiveVersion(input): Promise<PromptVersion>

// Queries
export async function getPromptWithVersions(shopId, promptName)
export async function listPromptsForShop(shopId)
```

### Race-Safe Version Creation

```typescript
const version = await prisma.$transaction(async (tx) => {
  // 1. Find definition
  const definition = await tx.promptDefinition.findUnique(...);

  // 2. Get max version (atomic read)
  const maxResult = await tx.promptVersion.aggregate({
    where: { promptDefinitionId: definition.id },
    _max: { version: true },
  });

  // 3. Insert with incremented version
  return tx.promptVersion.create({
    data: { version: (maxResult._max.version ?? 0) + 1, ... },
  });
}, {
  isolationLevel: "Serializable",  // Prevents race conditions
  timeout: 10000,
});
```

### Race-Safe Activation

```typescript
const result = await prisma.$transaction(async (tx) => {
  // 1. Find current active
  const currentActive = await tx.promptVersion.findFirst({
    where: { promptDefinitionId, status: "ACTIVE" },
  });

  // 2. Archive current (if exists)
  if (currentActive) {
    await tx.promptVersion.update({
      where: { id: currentActive.id },
      data: { status: "ARCHIVED" },
    });
  }

  // 3. Activate new
  return tx.promptVersion.update({
    where: { id: versionId },
    data: { status: "ACTIVE", activatedAt: new Date(), activatedBy },
  });
}, {
  isolationLevel: "Serializable",
});
```

## 5.3 LLM Call Tracker

**File**: `app/services/prompt-control/llm-call-tracker.server.ts`

### Key Functions

```typescript
// Low-level tracking
export async function startLLMCall(input): Promise<string>  // Returns callId
export async function completeLLMCall(input): Promise<void>

// High-level wrapper
export async function trackedLLMCall<T>(input, executor): Promise<T>

// Queries
export async function getCallsForRun(renderRunId)
export async function getCallsForTestRun(testRunId)
export async function getPromptCallStats(shopId, promptName, since)
export async function getDailyCostForShop(shopId): Promise<number>
```

### Tracked Call Wrapper

```typescript
export async function trackedLLMCall<T>(input, executor) {
  const callId = await startLLMCall(input);

  try {
    const { result, usage, providerRequestId, providerModel, outputPreview } = await executor();

    await completeLLMCall({
      callId,
      status: "SUCCEEDED",
      tokensIn: usage?.tokensIn,
      tokensOut: usage?.tokensOut,
      costEstimate: usage?.cost,
      providerRequestId,
      providerModel,
      outputPreview,
    });

    return result;
  } catch (error) {
    const isTimeout = error.message.includes("timeout") || error.name === "AbortError";

    await completeLLMCall({
      callId,
      status: isTimeout ? "TIMEOUT" : "FAILED",
      errorType: error.name,
      errorMessage: error.message,
    });

    throw error;
  }
}
```

### Request Hash (Stable Ordering)

```typescript
function computeRequestHash(promptName, resolutionHash, imageRefs) {
  // CRITICAL: Sort imageRefs for stable hashing
  const sortedImageRefs = [...imageRefs].sort();
  return sha256(JSON.stringify({ promptName, resolutionHash, imageRefs: sortedImageRefs }));
}
```

---

# 6. API Endpoints

## 6.1 Route Structure

```
/api/shops/[shopId]/
├── prompts/
│   ├── route.ts                    # GET list, POST create definition
│   └── [name]/
│       ├── route.ts                # GET detail
│       ├── versions/
│       │   └── route.ts            # POST create version
│       ├── activate/
│       │   └── route.ts            # POST activate version
│       ├── rollback/
│       │   └── route.ts            # POST rollback
│       └── test/
│           └── route.ts            # POST run test
├── runtime-config/
│   └── route.ts                    # GET / PATCH
└── audit-log/
    └── route.ts                    # GET
```

## 6.2 Endpoint Specifications

### GET /api/shops/:shopId/prompts

Returns all prompt definitions for shop with active/draft versions and metrics.

**Response**: `PromptListResponse`

### GET /api/shops/:shopId/prompts/:name

Returns prompt definition, all versions, active version, draft version, and metrics.

**Response**: `PromptDetailResponse`

### POST /api/shops/:shopId/prompts/:name/versions

Creates a new DRAFT version with auto-incremented version number.

**Request**: `CreateVersionRequest`
**Response**: `VersionDetail`

### POST /api/shops/:shopId/prompts/:name/activate

Activates a version (archives current active).

**Request**: `ActivateVersionRequest`
**Response**: `{ success: boolean, previousActiveId: string | null, newActiveId: string }`

### POST /api/shops/:shopId/prompts/:name/rollback

Rolls back to the most recent archived version.

**Response**: `{ previousActiveVersion: number, newActiveVersion: number }`

### POST /api/shops/:shopId/prompts/:name/test

Runs a test call without affecting production.

**Request**: `TestPromptRequest`
**Response**: `TestPromptResponse`

### GET /api/shops/:shopId/runtime-config

Returns current runtime config and status (concurrency, daily cost).

**Response**: `RuntimeConfigResponse`

### PATCH /api/shops/:shopId/runtime-config

Updates runtime config fields.

**Request**: `UpdateRuntimeConfigRequest`
**Response**: `RuntimeConfigResponse`

### GET /api/shops/:shopId/audit-log

Returns audit log entries with pagination.

**Query params**: `?limit=50&cursor=...&action=...&targetType=...`

---

# 7. UI Specification

## 7.1 Prompts List Page (`/prompts`)

### Table Columns

| Column | Description |
|--------|-------------|
| Name | Prompt name (link to detail) |
| Active Version | v{N} or "No active" |
| Model | Current active model |
| Last Changed | When active version was activated |
| p50 Latency | 50th percentile latency (24h) |
| p95 Latency | 95th percentile latency (24h) |
| Success Rate | Succeeded / Total calls (24h) |
| Avg Cost | Average cost per call (24h) |
| Status | Active / Has Draft / Disabled |

### Actions

- View detail
- Create draft
- Disable (adds to `disabledPromptNames`)

### Filters

- All / Active / Has Draft / Disabled
- Search by name

## 7.2 Prompt Detail Page (`/prompts/[name]`)

### Sections

1. **Header**
   - Name, description
   - Default model
   - Status badge (Active v{N} / No active / Disabled)

2. **Active Version** (read-only card)
   - Template preview (collapsible)
   - Model and params
   - Activated date and by whom
   - templateHash

3. **Draft Editor** (if draft exists, or create new)
   - Tabs: System / Developer / User templates
   - Syntax highlighting for templates
   - Variable detection and preview
   - Model dropdown (filtered by allow-list)
   - Params JSON editor
   - Diff view vs active version
   - Save Draft / Discard / Activate Draft buttons

4. **Versions Timeline**
   - All versions in descending order
   - Status badge (Active / Draft / Archived)
   - Click to view details
   - "Activate" button for archived versions (rollback)

5. **Live Test Panel**
   - Variables JSON input
   - Image refs inputs
   - Override toggles (template, model, params)
   - Run Test button
   - Results:
     - Rendered messages preview
     - Raw output
     - Latency, tokens, cost
     - Provider request ID
   - "Promote to Draft" button

### Metrics Sidebar

- Calls (24h)
- Success rate (24h)
- p50 / p95 latency
- Average cost
- Error breakdown

## 7.3 Runtime Controls Page (`/controls`)

### Sections

1. **Concurrency**
   - Max concurrency slider
   - Current concurrency indicator

2. **Model Controls**
   - Force fallback model dropdown
   - Model allow-list editor (add/remove tags)

3. **Caps**
   - Max output tokens slider
   - Max image bytes slider

4. **Budget**
   - Daily cost cap input
   - Current daily cost indicator
   - Progress bar

5. **Disabled Prompts**
   - List of disabled prompt names
   - Add/remove functionality

### Save Button

- Shows unsaved changes indicator
- Writes to PromptAuditLog

## 7.4 Run Detail Enhancements

### New Tabs

1. **LLM Calls** tab
   - Table of all LLMCall rows for this run
   - Columns: Prompt, Model, Status, Latency, Tokens In/Out, Cost, Error
   - Click to expand with full details

2. **Config Snapshot** tab
   - JSON viewer for `resolvedConfigSnapshot`
   - Diff view vs current active prompts
   - Shows which prompts were blocked and why

### Waterfall Enhancement

- Show prompt_build_ms phase
- Show inference_ms breakdown per variant

---

# 8. Usage Examples

## 8.1 Build Snapshot at Run Start

```typescript
import { buildResolvedConfigSnapshot } from "~/services/prompt-control";

const snapshot = await buildResolvedConfigSnapshot({
  shopId: "shop_123",
  promptNames: ["extractor", "prompt_builder", "global_render"],
  variables: {
    title: "Reclaimed Teak Coffee Table",
    description: "Handcrafted from reclaimed teak...",
    "product.title": "Reclaimed Teak Coffee Table",
    "product.type": "Coffee Table",
  },
});

// Store on RenderRun
await prisma.renderRun.update({
  where: { id: runId },
  data: { resolvedConfigSnapshot: snapshot },
});

// Check blocked prompts
if (Object.keys(snapshot.blockedPrompts).length > 0) {
  console.warn("Blocked prompts:", snapshot.blockedPrompts);
}
```

## 8.2 Execute Tracked LLM Call

```typescript
import { trackedLLMCall } from "~/services/prompt-control";

const extractorPrompt = snapshot.prompts["extractor"];

const result = await trackedLLMCall(
  {
    shopId: "shop_123",
    renderRunId: runId,
    promptName: "extractor",
    promptVersionId: extractorPrompt.promptVersionId,
    model: extractorPrompt.model,
    messages: extractorPrompt.messages,
    params: extractorPrompt.params,
    imageRefs: ["gs://bucket/product.png"],
    resolutionHash: extractorPrompt.resolutionHash,
  },
  async () => {
    const response = await gemini.generateContent({
      model: extractorPrompt.model,
      contents: extractorPrompt.messages.map(m => ({
        role: m.role === "system" ? "user" : m.role,
        parts: [{ text: m.content }],
      })),
      generationConfig: extractorPrompt.params,
    });

    return {
      result: response.response.text(),
      usage: {
        tokensIn: response.response.usageMetadata?.promptTokenCount,
        tokensOut: response.response.usageMetadata?.candidatesTokenCount,
        cost: calculateCost(response),
      },
      providerRequestId: response.response.candidates?.[0]?.contentFilter?.reason,
      providerModel: response.response.modelVersion,
      outputPreview: response.response.text()?.slice(0, 500),
    };
  }
);
```

## 8.3 Create and Activate New Version

```typescript
import { createVersion, activateVersion } from "~/services/prompt-control";

// Create draft
const newVersion = await createVersion({
  shopId: "shop_123",
  promptName: "extractor",
  systemTemplate: `Updated system prompt...`,
  userTemplate: `Updated user template with {{product.title}}...`,
  model: "gemini-2.5-flash",
  params: { temperature: 0.4, max_tokens: 4096 },
  changeNotes: "Improved extraction accuracy for furniture",
  createdBy: "steven@labcast.com.au",
});

// Test it first (optional)
const testResult = await runTest({
  shopId: "shop_123",
  promptName: "extractor",
  versionId: newVersion.id,
  variables: { ... },
});

// Activate
await activateVersion({
  shopId: "shop_123",
  promptName: "extractor",
  versionId: newVersion.id,
  activatedBy: "steven@labcast.com.au",
});
```

## 8.4 Rollback

```typescript
import { rollbackToPreviousVersion } from "~/services/prompt-control";

const result = await rollbackToPreviousVersion({
  shopId: "shop_123",
  promptName: "extractor",
  rolledBackBy: "steven@labcast.com.au",
});

console.log(`Rolled back from v${result.previousActiveVersion} to v${result.newActiveVersion}`);
```

---

# 9. Migration Plan

## Phase 1: Schema (Days 1-2)

1. Add enums and new tables to `schema.prisma`
2. Add fields to existing `RenderRun` model
3. Add relations to existing `Shop` model
4. Run `npx prisma migrate dev --name add_prompt_control`

## Phase 2: Seed Data (Day 3)

1. Run seed script to create system prompts:
   - `extractor` from `extractor.prompt.ts`
   - `prompt_builder` from `prompt-builder.prompt.ts`
   - `global_render` from `global-render.prompt.ts`
2. Create default `ShopRuntimeConfig` for all existing shops
3. Verify with `prisma studio`

## Phase 3: Integrate Services (Days 4-5)

1. Replace hardcoded prompt loading with `resolvePrompt()`
2. Wrap all LLM calls with `trackedLLMCall()`
3. Store `resolvedConfigSnapshot` on each `RenderRun`
4. Verify `LLMCall` rows are being written

## Phase 4: API Routes (Days 6-7)

1. Implement prompt CRUD routes
2. Implement runtime config routes
3. Implement test endpoint
4. Add authentication/authorization

## Phase 5: UI (Days 8-10)

1. Build Prompts list page
2. Build Prompt detail page with editor
3. Build Runtime Controls page
4. Add LLM Calls tab to Run detail

## Phase 6: Polish (Days 11-12)

1. Audit log viewer
2. Diff viewer for versions
3. Error handling and edge cases
4. Documentation

---

# 10. Acceptance Tests

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | Create draft, edit, activate | Next run for that shop uses new prompt |
| 2 | Each shop has independent prompts | Shop A's changes don't affect Shop B |
| 3 | Shop without custom prompt | Falls back to system tenant prompt |
| 4 | Rollback to previous version | Next run uses old prompt |
| 5 | View run's resolved config | See exact messages sent to provider |
| 6 | View run's LLM calls | See all calls with timing and status |
| 7 | Disable prompt via runtime config | Calls blocked, appears in `blockedPrompts` |
| 8 | Force fallback model | Next run uses that model |
| 9 | Model not in allow list | Call blocked with clear error |
| 10 | All changes in audit log | Before/after state recorded |
| 11 | Test panel runs prompt | Creates `PromptTestRun`, doesn't affect production |
| 12 | Concurrent version creation | No duplicate version numbers |
| 13 | Concurrent activation | Only one ACTIVE version |
| 14 | Same images, different order | Same `requestHash` (deduplication works) |
| 15 | Template with dot path | `{{product.title}}` renders correctly |

---

# 11. File Structure

```
app/
├── services/
│   └── prompt-control/
│       ├── index.ts                       # Main exports
│       ├── prompt-resolver.server.ts      # Resolution logic
│       ├── prompt-version-manager.server.ts # CRUD with transactions
│       └── llm-call-tracker.server.ts     # Call instrumentation
├── config/
│   └── prompts/
│       ├── extractor.prompt.ts            # Existing (will become seed source)
│       ├── prompt-builder.prompt.ts       # Existing (will become seed source)
│       └── global-render.prompt.ts        # Existing (will become seed source)

prisma/
├── schema.prisma                          # Add new tables/fields
├── schema-prompt-control-v2.prisma        # Reference schema additions
└── seed-prompts.ts                        # Backfill script

see-it-monitor/
├── app/
│   ├── prompts/
│   │   ├── page.tsx                       # Prompts list
│   │   └── [name]/
│   │       └── page.tsx                   # Prompt detail
│   ├── controls/
│   │   └── page.tsx                       # Runtime controls
│   └── runs/
│       └── [id]/
│           └── page.tsx                   # Run detail (enhanced)
├── components/
│   └── prompts/
│       ├── prompt-list.tsx
│       ├── prompt-detail.tsx
│       ├── version-timeline.tsx
│       ├── draft-editor.tsx
│       ├── test-panel.tsx
│       └── diff-viewer.tsx
└── lib/
    └── types-prompt-control.ts            # TypeScript types
```

---

# 12. Glossary

| Term | Definition |
|------|------------|
| **PromptDefinition** | A prompt "type" (e.g., "extractor"). One per name per shop. |
| **PromptVersion** | A specific version of a prompt's content. Has status: DRAFT/ACTIVE/ARCHIVED. |
| **templateHash** | SHA256 hash of raw templates + model + params. Stored on PromptVersion, never recomputed. |
| **resolutionHash** | SHA256 hash of rendered messages + resolved model + params. Computed at resolve time. |
| **requestHash** | SHA256 hash for deduplication (promptName + resolutionHash + sorted imageRefs). |
| **ResolvedPrompt** | Output of resolver: ready-to-use messages, model, params, and metadata. |
| **ResolvedConfigSnapshot** | Complete snapshot of all resolved prompts and runtime config for a run. |
| **LLMCall** | One row per model call. Tracks timing, tokens, cost, errors. |
| **System Tenant** | Special tenant (`SYSTEM_TENANT_ID`) that provides fallback prompts for all shops. |
| **Runtime Config** | Per-shop settings: concurrency, model controls, caps, budget, disabled prompts. |

---

# 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-01-23 | Initial spec (had bugs) |
| v2 | 2026-01-23 | Added multi-tenancy, fixed role model, fixed JSON defaults |
| v3 | 2026-01-24 | Fixed all 7 bugs: templateHash, version increment, activation, requestHash ordering, dot paths, system fallback, config loading |
