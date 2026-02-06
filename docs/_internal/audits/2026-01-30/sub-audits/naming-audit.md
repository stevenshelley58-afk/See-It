# Naming, Mapping, and Schema Integrity Audit

**Date:** 2026-01-30  
**Auditor:** Kilo Code  
**Scope:** Prisma schemas, ORM mappings, naming conventions across `app` and `see-it-monitor`

---

## Executive Summary

This audit examines naming conventions, ORM mappings (`@@map`, `@map`), schema integrity, and potential naming inconsistencies across the codebase. The analysis focuses on identifying partial renames, near-duplicate names encoding the same concept, pluralization drift, and incorrect mapping claims.

**Overall Assessment:** The codebase shows generally consistent naming with a few notable inconsistencies and potential areas for cleanup.

---

## 1. ORM Mapping Analysis

### 1.1 Model-to-Table Mappings (`@@map`)

| Model | Table Name | Assessment |
|-------|------------|------------|
| `Session` | *(none - uses default)* | Uses Prisma default (`Session`) |
| `Shop` | `shops` | Consistent plural convention |
| `ProductAsset` | `product_assets` | Consistent snake_case plural |
| `RoomSession` | `room_sessions` | Consistent snake_case plural |
| `RenderJob` | `render_jobs` | Consistent snake_case plural |
| `UsageDaily` | `usage_daily` | Consistent snake_case |
| `SavedRoomOwner` | `saved_room_owners` | Consistent snake_case plural |
| `SavedRoom` | `saved_rooms` | Consistent snake_case plural |
| `SeeItCapture` | `see_it_captures` | Consistent snake_case plural |
| `PrepEvent` | `prep_events` | Consistent snake_case plural |
| `CompositeRun` | `composite_runs` | Consistent snake_case plural |
| `CompositeVariant` | `composite_variants` | Consistent snake_case plural |
| `MonitorEvent` | `monitor_events` | Consistent snake_case plural |
| `MonitorArtifact` | `monitor_artifacts` | Consistent snake_case plural |
| `PromptDefinition` | `prompt_definitions` | Consistent snake_case plural |
| `PromptVersion` | `prompt_control_versions` | **INCONSISTENT** - "prompt_control" prefix added |
| `ShopRuntimeConfig` | `shop_runtime_configs` | Consistent snake_case plural |
| `LLMCall` | `llm_calls` | Consistent snake_case plural |
| `PromptTestRun` | `prompt_test_runs` | Consistent snake_case plural |
| `PromptAuditLog` | `prompt_audit_log` | **INCONSISTENT** - missing plural 's' |

### 1.2 Inconsistent Table Mappings

#### Issue: `PromptVersion` → `prompt_control_versions`
- **Location:** [`app/prisma/schema.prisma:485`](app/prisma/schema.prisma:485), [`see-it-monitor/prisma/schema.prisma:123`](see-it-monitor/prisma/schema.prisma:123)
- **Problem:** The table name includes a `prompt_control_` prefix that doesn't match the model name
- **Impact:** Creates confusion when writing raw SQL or debugging database issues
- **Recommendation:** Consider renaming table to `prompt_versions` for consistency, or document the rationale

#### Issue: `PromptAuditLog` → `prompt_audit_log`
- **Location:** [`app/prisma/schema.prisma:653`](app/prisma/schema.prisma:653), [`see-it-monitor/prisma/schema.prisma:310`](see-it-monitor/prisma/schema.prisma:310)
- **Problem:** Missing plural 's' - should be `prompt_audit_logs` to match convention
- **Impact:** Minor inconsistency in naming convention
- **Recommendation:** Add 's' to match plural convention: `prompt_audit_logs`

---

## 2. Field Naming Conventions (`@map`)

### 2.1 Consistent Patterns (Good)

All fields using camelCase in Prisma map consistently to snake_case in database:
- `shopDomain` → `shop_domain`
- `createdAt` → `created_at`
- `productAssetId` → `product_asset_id`
- `promptVersionId` → `prompt_version_id`

### 2.2 Special Cases

| Field | Maps To | Notes |
|-------|---------|-------|
| `id` | *(none)* | Standard primary key, no mapping needed |
| `plan` | *(none)* | Simple field, no mapping needed |
| `status` | *(none)* | Simple field, no mapping needed |
| `email` | *(none)* | Simple field, no mapping needed |

---

## 3. Cross-Schema Consistency (App vs Monitor)

### 3.1 Shared Models Comparison

Both schemas define overlapping models for the Prompt Control Plane and Observability features:

| Model | App Schema | Monitor Schema | Consistent? |
|-------|------------|----------------|-------------|
| `Shop` | Full model | Subset (minimal) | Partial - monitor lacks relations |
| `PromptDefinition` | Identical | Identical | Yes |
| `PromptVersion` | Identical | Identical | Yes |
| `ShopRuntimeConfig` | Identical | Identical | Yes |
| `MonitorEvent` | Identical | Identical | Yes |
| `LLMCall` | Identical | Identical | Yes |
| `PromptTestRun` | Identical | Identical | Yes |
| `PromptAuditLog` | Identical | Identical | Yes |

### 3.2 Schema Drift Risk

**CRITICAL:** The `Shop` model in `see-it-monitor` is a **minimal subset** of the main app schema:

**App Schema Relations (missing in monitor):**
- `productAssets`
- `roomSessions`
- `renderJobs`
- `usageDaily`
- `savedRoomOwners`
- `savedRooms`
- `seeItCaptures`
- `prepEvents`
- `compositeRuns`
- `monitorArtifacts`

**Risk:** If the monitor service attempts to query these relations, it will fail at runtime. The comment at [`see-it-monitor/prisma/schema.prisma:41-42`](see-it-monitor/prisma/schema.prisma:41-42) states this is intentional ("minimal - only fields needed for relations"), but this creates a maintenance burden.

---

## 4. Naming Inconsistencies in Code

### 4.1 Variant ID Naming

Multiple conventions found for variant identifiers:

| Convention | Location | Example |
|------------|----------|---------|
| `variantId` | TypeScript types | [`app/app/services/see-it-now/types.ts:214`](app/app/services/see-it-now/types.ts:214) |
| `variant_id` | API payloads | [`app/app/routes/app-proxy.see-it-now.select.ts:181`](app/app/routes/app-proxy.see-it-now.select.ts:181) |
| `variant.id` | Internal objects | [`app/app/services/see-it-now/composite-runner.server.ts:101`](app/app/services/see-it-now/composite-runner.server.ts:101) |

**Assessment:** This is intentional - camelCase for TypeScript, snake_case for JSON/API. Not a bug, but worth noting.

### 4.2 Request ID / Trace ID Confusion

| Name | Usage | Context |
|------|-------|---------|
| `requestId` | HTTP request tracking | General logging |
| `traceId` | OpenTelemetry tracing | [`app/app/services/see-it-now/types.ts:196`](app/app/services/see-it-now/types.ts:196) |

**Note:** The comment at [`app/app/services/see-it-now/types.ts:196`](app/app/services/see-it-now/types.ts:196) states: `traceId: string;  // Renamed from requestId`

This indicates a conscious rename, but both terms still appear in the codebase. The `traceId` is used specifically in the See It Now pipeline context.

### 4.3 Run ID Naming

| Convention | Location |
|------------|----------|
| `runId` | TypeScript code, Prisma schema |
| `run_id` | JSON payloads, API responses |
| `runID` | Not found (good - no Go-style naming) |

**Assessment:** Consistent separation between code (camelCase) and API (snake_case).

---

## 5. Near-Duplicate Names

### 5.1 Image Reference Fields

Multiple fields with similar purposes but different naming:

| Field | Model | Purpose |
|-------|-------|---------|
| `preparedImageUrl` | `ProductAsset` | Cached signed URL (legacy) |
| `preparedImageKey` | `ProductAsset` | Permanent GCS path (canonical) |
| `sourceImageUrl` | `ProductAsset` | Original source URL |
| `sourceImageId` | `ProductAsset` | Shopify image ID |
| `imageUrl` | `RenderJob` | Result image URL |
| `imageKey` | `RenderJob` | Result GCS key |

**Assessment:** These are semantically distinct and appropriately named. The `*Url` vs `*Key` distinction correctly identifies signed URLs vs GCS paths.

### 5.2 Room Image Fields

| Field | Model | Purpose |
|-------|-------|---------|
| `originalRoomImageUrl` | `RoomSession` | Legacy signed URL |
| `cleanedRoomImageUrl` | `RoomSession` | Legacy signed URL |
| `originalRoomImageKey` | `RoomSession` | Stable GCS key |
| `cleanedRoomImageKey` | `RoomSession` | Stable GCS key |
| `canonicalRoomImageKey` | `RoomSession` | Authoritative image key |

**Assessment:** Clear progression from legacy (Url) to stable (Key) to canonical (Key). Well documented in comments.

---

## 6. Partial Renames Detected

### 6.1 Session Model

The `Session` model at [`app/prisma/schema.prisma:38`](app/prisma/schema.prisma:38) has **no `@@map` attribute**, meaning it uses the default table name `Session` (PascalCase). This is inconsistent with all other models that explicitly map to snake_case plurals.

**Recommendation:** Add `@@map("sessions")` for consistency.

### 6.2 Prompt Control Plane Naming

The table `prompt_control_versions` suggests a broader "prompt control" namespace that isn't reflected in other table names:
- `prompt_definitions` (not `prompt_control_definitions`)
- `shop_runtime_configs` (not `prompt_control_runtime_configs`)
- `prompt_test_runs` (not `prompt_control_test_runs`)

**Assessment:** The `prompt_control_` prefix on `prompt_control_versions` appears to be legacy or an attempt at namespacing that wasn't applied consistently.

---

## 7. Schema Integrity Issues

### 7.1 Missing Indexes

The `Session` model lacks indexes on commonly queried fields:
- `shop` - likely queried frequently
- `expires` - likely used for cleanup queries

**Recommendation:** Add indexes if these fields are queried in production.

### 7.2 Enum Values

Enum `AuditAction` values use consistent `SCREAMING_SNAKE_CASE`:
- `PROMPT_CREATE`
- `PROMPT_UPDATE_DRAFT`
- `PROMPT_ACTIVATE`
- `PROMPT_ARCHIVE`
- `PROMPT_ROLLBACK`
- `RUNTIME_UPDATE`
- `TEST_RUN`

**Assessment:** Consistent and clear.

---

## 8. Comment Claims Verification

### 8.1 Verified Claims

| Claim | Location | Status |
|-------|----------|--------|
| "PromptVersion table is `prompt_control_versions`" | schema files | Verified correct |
| "Shop model in monitor is minimal" | see-it-monitor/schema.prisma:41 | Verified correct |
| "preparedImageUrl is legacy/fallback" | app/schema.prisma:99 | Verified - comment matches usage |

### 8.2 Potential Misleading Comments

None found. Comments accurately describe the schema and mappings.

---

## 9. Recommendations

### High Priority
1. **Fix `PromptAuditLog` table name** - Add 's' to become `prompt_audit_logs` for consistency

### Medium Priority
2. **Document `prompt_control_versions` naming** - Add comment explaining why this table has a different prefix, or rename to `prompt_versions`
3. **Add `@@map("sessions")` to Session model** - For consistency with other models

### Low Priority
4. **Consider adding indexes to Session** - If `shop` and `expires` are queried frequently
5. **Audit `see-it-monitor` Shop model** - Document which relations are intentionally omitted

---

## 10. Summary Table

| Category | Count | Notes |
|----------|-------|-------|
| Total Models | 20 | Across both schemas |
| Consistent Mappings | 17 | Following snake_case plural convention |
| Inconsistent Mappings | 2 | `prompt_control_versions`, `prompt_audit_log` |
| Missing Mappings | 1 | `Session` model |
| Cross-Schema Duplication | 8 | Shared between app and monitor |
| Partial Renames | 1 | `Session` model |

---

## Appendix: Full Mapping Reference

### App Schema (`app/prisma/schema.prisma`)

```
Session                    → Session (default - no @@map)
Shop                       → shops
ProductAsset               → product_assets
RoomSession                → room_sessions
RenderJob                  → render_jobs
UsageDaily                 → usage_daily
SavedRoomOwner             → saved_room_owners
SavedRoom                  → saved_rooms
SeeItCapture               → see_it_captures
PrepEvent                  → prep_events
CompositeRun               → composite_runs
CompositeVariant           → composite_variants
MonitorEvent               → monitor_events
MonitorArtifact            → monitor_artifacts
PromptDefinition           → prompt_definitions
PromptVersion              → prompt_control_versions  ⚠️
ShopRuntimeConfig          → shop_runtime_configs
LLMCall                    → llm_calls
PromptTestRun              → prompt_test_runs
PromptAuditLog             → prompt_audit_log         ⚠️
```

### Monitor Schema (`see-it-monitor/prisma/schema.prisma`)

```
Shop                       → shops (subset)
PromptDefinition           → prompt_definitions
PromptVersion              → prompt_control_versions  ⚠️
ShopRuntimeConfig          → shop_runtime_configs
MonitorEvent               → monitor_events
LLMCall                    → llm_calls
PromptTestRun              → prompt_test_runs
PromptAuditLog             → prompt_audit_log         ⚠️
```

---

*End of Naming, Mapping, and Schema Integrity Audit*
