# Database Schema & URL Resolution Audit

**Audit Date:** 2026-01-30  
**Scope:** DB URL Resolution and ORM/Schema Consistency between `app` and `see-it-monitor` packages

---

## Executive Summary

This audit compares the database schema and connection resolution logic between the main `app` package and the `see-it-monitor` package. Both packages share the same PostgreSQL database but maintain separate Prisma schemas, creating potential for drift and migration conflicts.

**Risk Level:** MEDIUM-HIGH - Schema drift exists and duplicate DB URL resolution logic creates maintenance burden.

---

## 1. DATABASE_URL Resolution

### 1.1 App Package (`app/lib/db-url.js`)

**Location:** [`app/lib/db-url.js`](app/lib/db-url.js:1)

**Resolution Logic:**
```javascript
Priority:
1. DATABASE_URL (if not Railway internal)
2. DATABASE_PUBLIC_URL (fallback)
```

**Key Functions:**
- [`resolveDatabaseUrl()`](app/lib/db-url.js:90) - Core resolution with validation
- [`getDatabaseUrlWithPooling()`](app/lib/db-url.js:187) - Adds pool settings
- [`isRailwayInternalHost()`](app/lib/db-url.js:39) - Detects `.railway.internal` hosts
- [`isRailwayTcpProxyHost()`](app/lib/db-url.js:49) - Detects `.proxy.rlwy.net` hosts

**Pool Settings Applied:**
- `connection_limit`: 10 (via `DB_POOL_SIZE` env var)
- `pool_timeout`: 20 (via `DB_POOL_TIMEOUT` env var)
- `pgbouncer`: true (if `DB_PGBOUNCER=true`)

**Used By:**
- [`app/app/db.server.js`](app/app/db.server.js:1) - Main Prisma client

### 1.2 Monitor Package (`see-it-monitor/lib/db.ts`)

**Location:** [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1)

**Resolution Logic:**
```typescript
Priority:
1. DATABASE_URL (if not Railway internal)
2. DATABASE_PUBLIC_URL (fallback)
```

**Key Functions:**
- [`getDatabaseUrl()`](see-it-monitor/lib/db.ts:30) - Inline resolution function
- [`isRailwayInternalHost()`](see-it-monitor/lib/db.ts:17) - Duplicated detection logic

**Pool Settings Applied:**
- `connection_limit`: 10 (via `DB_POOL_SIZE` env var)
- `pool_timeout`: 20 (via `DB_POOL_TIMEOUT` env var)

**Note:** No pgBouncer support in monitor package.

### 1.3 Comparison

| Feature | App Package | Monitor Package |
|---------|-------------|-----------------|
| Railway Internal Detection | ✅ | ✅ |
| Public URL Fallback | ✅ | ✅ |
| Pool Settings | ✅ | ✅ |
| pgBouncer Support | ✅ | ❌ |
| Password Validation | ✅ | ❌ |
| SSL Config Helper | ✅ | ❌ |
| Connection Info Logging | ✅ | ❌ |
| Source Tracking | ✅ | ❌ |

**Finding:** The monitor package has a **duplicated, simplified version** of the DB URL resolution logic. Changes to the app package's logic (e.g., new env vars, validation rules) will not propagate to the monitor.

---

## 2. Schema Comparison

### 2.1 Shared Models (Both Packages)

| Model | App Schema | Monitor Schema | Status |
|-------|------------|----------------|--------|
| `Session` | ✅ | ❌ | **DRIFT** - Monitor missing |
| `Shop` | ✅ | ✅ (minimal) | ⚠️ Partial - Monitor has subset |
| `PromptDefinition` | ✅ | ✅ | ✅ Consistent |
| `PromptVersion` | ✅ | ✅ | ✅ Consistent |
| `ShopRuntimeConfig` | ✅ | ✅ | ✅ Consistent |
| `LLMCall` | ✅ | ✅ | ✅ Consistent |
| `PromptTestRun` | ✅ | ✅ | ✅ Consistent |
| `PromptAuditLog` | ✅ | ✅ | ✅ Consistent |
| `MonitorEvent` | ✅ | ✅ | ✅ Consistent |
| `MonitorArtifact` | ✅ | ❌ | **DRIFT** - Monitor missing |

### 2.2 App-Only Models (Not in Monitor)

From [`app/prisma/schema.prisma`](app/prisma/schema.prisma:1):

1. **Session** (lines 38-54) - Shopify session storage
2. **ProductAsset** (lines 90-136) - Product image assets
3. **RoomSession** (lines 138-163) - Room image sessions
4. **RenderJob** (lines 165-195) - Render job queue
5. **UsageDaily** (lines 197-209) - Daily usage metrics
6. **SavedRoomOwner** (lines 211-223) - Saved room ownership
7. **SavedRoom** (lines 225-240) - Saved room images
8. **SeeItCapture** (lines 242-257) - User captures
9. **PrepEvent** (lines 259-277) - Asset preparation events
10. **CompositeRun** (lines 283-329) - Composite pipeline runs
11. **CompositeVariant** (lines 335-355) - Per-variant results
12. **MonitorArtifact** (lines 391-416) - GCS artifact tracking

### 2.3 Shop Model Differences

**App Package** ([`app/prisma/schema.prisma`](app/prisma/schema.prisma:56)):
```prisma
model Shop {
  // ... base fields ...
  
  // App-specific relations
  productAssets    ProductAsset[]
  roomSessions     RoomSession[]
  renderJobs       RenderJob[]
  usageDaily       UsageDaily[]
  savedRoomOwners  SavedRoomOwner[]
  savedRooms       SavedRoom[]
  seeItCaptures    SeeItCapture[]
  prepEvents       PrepEvent[]
  compositeRuns    CompositeRun[]
  monitorEvents    MonitorEvent[]
  monitorArtifacts MonitorArtifact[]

  // Prompt Control Plane relations
  promptDefinitions PromptDefinition[]
  runtimeConfig     ShopRuntimeConfig?
  llmCalls          LLMCall[]
  promptTestRuns    PromptTestRun[]
  promptAuditLog    PromptAuditLog[]
}
```

**Monitor Package** ([`see-it-monitor/prisma/schema.prisma`](see-it-monitor/prisma/schema.prisma:44)):
```prisma
model Shop {
  // ... base fields only ...
  
  // Prompt Control Plane relations ONLY
  promptDefinitions PromptDefinition[]
  runtimeConfig     ShopRuntimeConfig?
  llmCalls          LLMCall[]
  promptTestRuns    PromptTestRun[]
  promptAuditLog    PromptAuditLog[]
  monitorEvents     MonitorEvent[]
  
  // Missing: monitorArtifacts relation!
}
```

**Finding:** The monitor package's `Shop` model is missing the `monitorArtifacts` relation even though it uses the `MonitorEvent` model.

---

## 3. Schema Naming Consistency

### 3.1 Table Name Mappings (@@map)

Both schemas use consistent `@map` directives for snake_case table names:

| Model | Table Name | Consistent? |
|-------|------------|-------------|
| `Shop` | `shops` | ✅ |
| `PromptDefinition` | `prompt_definitions` | ✅ |
| `PromptVersion` | `prompt_control_versions` | ✅ |
| `ShopRuntimeConfig` | `shop_runtime_configs` | ✅ |
| `LLMCall` | `llm_calls` | ✅ |
| `PromptTestRun` | `prompt_test_runs` | ✅ |
| `PromptAuditLog` | `prompt_audit_log` | ✅ |
| `MonitorEvent` | `monitor_events` | ✅ |

### 3.2 Field Name Mappings (@map)

All shared models use consistent `@map` naming (snake_case). Examples:

```prisma
// Both schemas use:
shopId      String   @map("shop_id")
createdAt   DateTime @map("created_at")
updatedAt   DateTime @map("updated_at")
templateHash String  @map("template_hash")
```

**Finding:** ✅ **No naming inconsistencies** between schemas for shared models.

---

## 4. Migration Safety Issues

### 4.1 Risk: Schema Drift on Shared Tables

**Scenario:** Developer adds a field to `LLMCall` in the app schema but forgets to update the monitor schema.

**Impact:**
- Monitor queries may fail if they select the new field
- Prisma Client types will be inconsistent
- TypeScript compilation errors in monitor package

**Affected Tables:**
- `llm_calls`
- `prompt_control_versions`
- `prompt_definitions`
- `shop_runtime_configs`
- `prompt_test_runs`
- `prompt_audit_log`
- `monitor_events`

### 4.2 Risk: Monitor Missing Required Relations

The monitor schema's `Shop` model is missing relations that exist in the database:

```prisma
// Monitor is missing:
monitorArtifacts MonitorArtifact[]
```

This could cause issues if:
- Monitor tries to query artifacts through the Shop relation
- Cascading deletes are expected but not modeled

### 4.3 Risk: Divergent Enums

**PromptStatus Enum:**
```prisma
// Both schemas - IDENTICAL
enum PromptStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}
```

**AuditAction Enum:**
```prisma
// Both schemas - IDENTICAL
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

**Finding:** ✅ Enums are currently consistent, but must be kept in sync manually.

---

## 5. Detailed Schema Drift Analysis

### 5.1 PromptVersion Model Comparison

| Aspect | App | Monitor | Match? |
|--------|-----|---------|--------|
| `systemTemplate` | `@db.Text` | `@db.Text` | ✅ |
| `developerTemplate` | `@db.Text` | `@db.Text` | ✅ |
| `userTemplate` | `@db.Text` | `@db.Text` | ✅ |
| `previousActiveVersionId` | ✅ Present | ❌ Missing | **DRIFT** |

**Finding:** The `PromptVersion` model in the monitor schema is missing the `previousActiveVersionId` field (added for rollback chain support).

### 5.2 LLMCall Model Comparison

| Aspect | App | Monitor | Match? |
|--------|-----|---------|--------|
| All fields | ✅ | ✅ | ✅ |
| Indexes | ✅ | ✅ | ✅ |

**Finding:** ✅ LLMCall is currently consistent.

### 5.3 ShopRuntimeConfig Model Comparison

| Aspect | App | Monitor | Match? |
|--------|-----|---------|--------|
| `skipGcsDownloadWhenGeminiUriValid` | ✅ | ✅ | ✅ |
| All other fields | ✅ | ✅ | ✅ |

**Finding:** ✅ ShopRuntimeConfig is consistent.

---

## 6. Recommendations

### 6.1 High Priority

1. **Extract Shared Schema to Package**
   ```
   Create: packages/prisma-schema/
   Move shared models to a single source of truth
   Both app and monitor extend from base schema
   ```

2. **Fix PromptVersion Drift**
   - Add `previousActiveVersionId` field to monitor schema
   - Or remove from app schema if not needed

3. **Fix Shop Model Relations**
   - Add `monitorArtifacts` relation to monitor's Shop model

### 6.2 Medium Priority

4. **Unify DB URL Resolution**
   - Extract [`app/lib/db-url.js`](app/lib/db-url.js:1) to shared package
   - Have monitor import from shared location
   - Ensures consistent pool settings and validation

5. **Add Schema Sync CI Check**
   ```yaml
   # GitHub Action to compare schemas
   - name: Check Schema Drift
     run: |
       npx prisma migrate diff \
         --from-schema app/prisma/schema.prisma \
         --to-schema see-it-monitor/prisma/schema.prisma
   ```

### 6.3 Low Priority

6. **Document Schema Boundaries**
   - Add comments to each model indicating which packages use it
   - Create architecture diagram showing schema dependencies

7. **Consider Schema Federation**
   - If monitor grows, consider separate database
   - Use event streaming for cross-service communication

---

## 7. Appendix: File References

### App Package
- [`app/prisma/schema.prisma`](app/prisma/schema.prisma:1) - Full schema (654 lines)
- [`app/lib/db-url.js`](app/lib/db-url.js:1) - URL resolution utilities
- [`app/app/db.server.js`](app/app/db.server.js:1) - Prisma client instantiation

### Monitor Package
- [`see-it-monitor/prisma/schema.prisma`](see-it-monitor/prisma/schema.prisma:1) - Subset schema (311 lines)
- [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1) - URL resolution + client

---

## 8. Summary Table

| Issue | Severity | Location | Action Required |
|-------|----------|----------|-----------------|
| Duplicate DB URL logic | MEDIUM | `see-it-monitor/lib/db.ts` | Extract to shared package |
| Missing `previousActiveVersionId` | HIGH | `see-it-monitor/prisma/schema.prisma` | Add field or remove from app |
| Missing `monitorArtifacts` relation | MEDIUM | `see-it-monitor/prisma/schema.prisma` | Add relation to Shop |
| Missing `Session` model | LOW | `see-it-monitor/prisma/schema.prisma` | Expected (app-only) |
| Missing `MonitorArtifact` model | MEDIUM | `see-it-monitor/prisma/schema.prisma` | Add if monitor needs artifacts |
| No pgBouncer support in monitor | LOW | `see-it-monitor/lib/db.ts` | Add if needed |

---

*End of Audit Report*
