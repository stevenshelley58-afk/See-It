# CONSISTENCY MAPS

**Audit Date:** 2026-01-30  
**Purpose:** Document canonical implementations, duplicates, and drift across the codebase

---

## A) Env and Config Precedence Map

### Canonical Implementation
**Location:** Framework-level (Remix/Next.js runtime)  
**Justification:** Both workspaces rely on framework env loading rather than explicit `dotenv.config()` calls. The `migrate-statuses.js` script has custom loading that inverts precedence.

```
Standard Precedence (Development):
1. Framework-loaded .env.local (highest)
2. Framework-loaded .env
3. Shell environment variables
4. System environment (lowest)

Production (Railway/Vercel):
1. Platform-injected env vars (highest)
2. Build-time env vars
```

### Duplicates

| Location | Pattern | Drift |
|----------|---------|-------|
| [`app/scripts/migrate-statuses.js:417`](app/scripts/migrate-statuses.js:417) | Custom loader with `--prefer-dotenv` | Inverts precedence - env files override existing vars |

### All Consumers

| File | Env Vars Accessed | Notes |
|------|-------------------|-------|
| [`app/vite.config.js`](app/vite.config.js:1) | HOST, SHOPIFY_APP_URL | Mutates env at runtime |
| [`app/remix.config.js`](app/remix.config.js:1) | HOST, SHOPIFY_APP_URL | Mutates env at runtime |
| [`app/app/db.server.js`](app/app/db.server.js:1) | DATABASE_URL | Via db-url.js |
| [`app/lib/db-url.js`](app/lib/db-url.js:1) | DATABASE_URL, DATABASE_PUBLIC_URL, DB_POOL_SIZE, DB_POOL_TIMEOUT, DB_PGBOUNCER, PGSSLMODE | Full validation |
| [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1) | DATABASE_URL, DATABASE_PUBLIC_URL, DB_POOL_SIZE, DB_POOL_TIMEOUT | Simplified version |
| [`see-it-monitor/lib/auth.ts`](see-it-monitor/lib/auth.ts:1) | JWT_SECRET, MONITOR_API_TOKEN | Inconsistent fallback |
| [`see-it-monitor/middleware.ts`](see-it-monitor/middleware.ts:1) | JWT_SECRET, MONITOR_API_TOKEN, NODE_ENV, MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH | Auth bypass risk |

### Drift Differences

| Aspect | Main App | Monitor | Impact |
|--------|----------|---------|--------|
| JWT_SECRET fallback | Not used | Falls back to MONITOR_API_TOKEN | Inconsistent token validation |
| DB password validation | ✅ Yes | ❌ No | Monitor may accept invalid URLs |
| pgBouncer support | ✅ Yes | ❌ No | Connection pooling differs |
| SSL config helper | ✅ Yes | ❌ No | SSL mode not configurable |

---

## B) DB URL Resolution Map

### Canonical Implementation
**Location:** [`app/lib/db-url.js`](app/lib/db-url.js:1)  
**Justification:** Most comprehensive implementation with validation, logging, and SSL configuration.

**Priority Order:**
1. `DATABASE_URL` (if not Railway internal)
2. `DATABASE_PUBLIC_URL` (fallback for Railway internal)
3. `DATABASE_URL` (last resort, will warn)

**Features:**
- Railway internal host detection (`.railway.internal`)
- Password validation
- Pool configuration (`DB_POOL_SIZE`, `DB_POOL_TIMEOUT`)
- pgBouncer mode (`DB_PGBOUNCER`)
- SSL configuration (`PGSSLMODE`)
- Detailed logging

### Duplicates

| Location | Features Missing |
|----------|------------------|
| [`see-it-monitor/lib/db.ts:15`](see-it-monitor/lib/db.ts:15) | Password validation, pgBouncer support, SSL config, detailed logging |

### All Consumers

| File | Uses | Connection Pooling |
|------|------|-------------------|
| [`app/app/db.server.js`](app/app/db.server.js:1) | `getDatabaseUrl()` from db-url.js | Yes |
| [`app/scripts/migrate-statuses.js`](app/scripts/migrate-statuses.js:1) | Direct `process.env.DATABASE_URL` | No |
| [`app/scripts/backfill-product-type.js`](app/scripts/backfill-product-type.js:1) | `getDatabaseUrl()` from db-url.js | Yes |
| [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1) | Duplicated logic inline | Yes (simpler) |

### Drift Differences

| Feature | app/lib/db-url.js | see-it-monitor/lib/db.ts |
|---------|-------------------|--------------------------|
| Railway internal detection | ✅ | ✅ |
| URL validation | ✅ | ✅ |
| Password validation | ✅ | ❌ |
| Pool size config | ✅ | ✅ |
| Pool timeout config | ✅ | ✅ |
| pgBouncer support | ✅ | ❌ |
| SSL mode config | ✅ | ❌ |
| Warning logs | Detailed | Minimal |

---

## C) Schema/Model/Table Naming Map

### ORM Mapping Patterns

**Canonical Convention:** camelCase (TypeScript) → snake_case (PostgreSQL)

| Model | Table (@@map) | Status |
|-------|---------------|--------|
| `Shop` | `shops` | ✅ Consistent |
| `Session` | (implicit) | ⚠️ Missing @@map |
| `ProductAsset` | `product_assets` | ✅ Consistent |
| `PromptDefinition` | `prompt_definitions` | ✅ Consistent |
| `PromptVersion` | `prompt_control_versions` | ⚠️ Inconsistent prefix |
| `PromptAuditLog` | `prompt_audit_log` | ⚠️ Not pluralized |
| `LLMCall` | `llm_calls` | ✅ Consistent |

### Duplicates (Cross-Workspace)

8 models duplicated between [`app/prisma/schema.prisma`](app/prisma/schema.prisma:1) and [`see-it-monitor/prisma/schema.prisma`](see-it-monitor/prisma/schema.prisma:1):

| Model | App | Monitor | Drift |
|-------|-----|---------|-------|
| `Shop` | ✅ Full | ⚠️ Subset | Monitor missing relations |
| `PromptDefinition` | ✅ | ✅ | Consistent |
| `PromptVersion` | ✅ | ⚠️ | Monitor missing `previousActiveVersionId` |
| `ShopRuntimeConfig` | ✅ | ✅ | Consistent |
| `LLMCall` | ✅ | ✅ | Consistent |
| `PromptTestRun` | ✅ | ✅ | Consistent |
| `PromptAuditLog` | ✅ | ✅ | Consistent |
| `MonitorEvent` | ✅ | ✅ | Consistent |

### Schema Drift Details

**Critical:** `PromptVersion` in monitor lacks `previousActiveVersionId` field
- **App:** Full rollback chain support
- **Monitor:** Rollback chain broken

**Shop Model Subset:**
- **App:** Full model with all relations
- **Monitor:** Only `promptControlPlane` and `monitorObservability` relations

---

## D) Hashing and Identity Map

### Canonical Implementation
**Location:** [`app/app/services/see-it-now/hashing.server.ts`](app/app/services/see-it-now/hashing.server.ts:1)  
**Justification:** Only implementation with deterministic serialization via recursive key sorting.

**Features:**
- `canonicalize()` - recursive key sorting
- `computeTemplateHash()` - SHA-256, 16-char truncation
- `computeRequestHash()` - SHA-256, 16-char truncation
- `computeStableId()` - SHA-256, 64-char full

### Duplicates (Non-Deterministic)

| Location | Method | Problem |
|----------|--------|---------|
| [`prompt-resolver.server.ts:97`](app/app/services/prompt-control/prompt-resolver.server.ts:97) | `JSON.stringify(params)` | No key sorting - hash varies by key order |
| [`prompt-version-manager.server.ts:46`](app/app/services/prompt-control/prompt-version-manager.server.ts:46) | `JSON.stringify(template)` | No key sorting - hash varies by key order |
| [`seed-prompts.ts:35`](app/prisma/seed-prompts.ts:35) | `JSON.stringify(content)` | No key sorting |

### All Consumers

| File | Hash Type | Truncation | Deterministic |
|------|-----------|------------|---------------|
| [`hashing.server.ts`](app/app/services/see-it-now/hashing.server.ts:1) | SHA-256 | 16-64 chars | ✅ Yes (sorted keys) |
| [`prompt-resolver.server.ts`](app/app/services/prompt-control/prompt-resolver.server.ts:1) | SHA-256 | 16 chars | ❌ No |
| [`prompt-version-manager.server.ts`](app/app/services/prompt-control/prompt-version-manager.server.ts:1) | SHA-256 | 16 chars | ❌ No |
| [`prepare-processor.server.ts`](app/app/services/prepare-processor.server.ts:1) | djb2 variant | 8 chars | ❌ Not cryptographic |

### Drift Differences

| Aspect | Canonical (hashing.server.ts) | Prompt-Control |
|--------|------------------------------|----------------|
| Serialization | `canonicalize()` (sorted) | `JSON.stringify()` (unsorted) |
| Key ordering | Deterministic | Non-deterministic |
| Collision risk | Low | Medium (key order changes) |
| Use case | Template/request hashing | Prompt versioning |

---

## E) Logging and Telemetry Map

### Canonical Implementation
**Location:** [`app/app/services/telemetry/index.ts`](app/app/services/telemetry/index.ts:1)  
**Justification:** Structured logging with consistent context fields.

**Log Shape (Structured):**
```typescript
{
  flow: string,      // Required
  requestId: string, // Required
  stage: string,     // Required
  shopId?: string,
  error?: Error,
  // ...additional context
}
```

### Duplicates/Inconsistencies

| Location | Pattern | Issue |
|----------|---------|-------|
| Various routes | `console.log()` | Unstructured, no correlation IDs |
| Various routes | `console.error()` | Missing context fields |

### All Producers

| File | Log Type | Correlation ID |
|------|----------|----------------|
| [`telemetry/index.ts`](app/app/services/telemetry/index.ts:1) | Structured | `requestId` |
| [`telemetry/emitter.server.ts`](app/app/services/telemetry/emitter.server.ts:1) | Events | `traceId` (from OTEL), `runId` |
| [`session-logger.server.ts`](app/app/services/session-logger.server.ts:1) | Session logs | Session ID |
| [`otel.server.ts`](app/app/otel.server.ts:1) | Traces | `traceId` (OTEL native) |

### Correlation ID Mapping

| ID Type | Source | Used In | Consistency |
|---------|--------|---------|-------------|
| `requestId` | Generated per request | Logger, telemetry | ✅ Consistent |
| `traceId` | OpenTelemetry | OTEL spans, emitter | ⚠️ Not always propagated to logs |
| `runId` | Render run ID | See It Now pipeline | ✅ Scoped to run |
| `sessionId` | Shopify session | Session logger | ✅ Consistent |

### Drift Differences

| Aspect | Structured Logger | Console.* |
|--------|-------------------|-----------|
| Context fields | ✅ Required | ❌ Optional |
| Correlation ID | ✅ Always | ❌ Rarely |
| Searchability | ✅ High | ❌ Low |
| Secret scrubbing | ❌ Missing | ❌ Missing |

---

## F) Script/CLI Runtime Contract Map

### Scripts Inventory

| Script | Location | Type | Env Loading | Dry Run | Idempotent |
|--------|----------|------|-------------|---------|------------|
| `migrate-statuses.js` | `app/scripts/` | Backfill | Custom (`--prefer-dotenv`) | ✅ Yes | ✅ Yes |
| `backfill-product-type.js` | `app/scripts/` | Backfill | `getDatabaseUrl()` | ❌ No | ✅ Yes |
| `sync-live-tags.js` | `app/scripts/` | Sync | `getDatabaseUrl()` | ❌ No | ✅ Yes |
| `set-unlimited-credits.js` | `app/scripts/` | One-off | Direct env | ❌ No | ⚠️ Partial |
| `inject-version.js` | `app/scripts/` | Build | None | N/A | N/A |
| `railway-migrate.mjs` | `app/scripts/` | Migration | Prisma default | N/A | ✅ Yes |
| `check-schema-sync.ts` | `app/scripts/` | CI Check | None | N/A | N/A |
| `check-deprecations.ts` | `app/scripts/` | CI Check | None | N/A | N/A |
| `seed-prompts.ts` | `app/prisma/` | Seed | Prisma default | N/A | ✅ Yes |
| `prisma-generate.mjs` | `see-it-monitor/scripts/` | Build | None | N/A | N/A |

### Runtime Contract Issues

| Issue | Scripts Affected | Risk |
|-------|-----------------|------|
| No dry-run mode | `set-unlimited-credits.js`, `backfill-product-type.js`, `sync-live-tags.js` | Accidental modifications |
| Custom env precedence | `migrate-statuses.js` | Different behavior than runtime |
| No confirmation prompt | `set-unlimited-credits.js` | Accidental credit changes |
| Missing row count logging | `sync-live-tags.js` | Incomplete audit trail |

### Contract Recommendations

All data-modifying scripts should implement:
1. `--dry-run` flag (log actions without executing)
2. `--confirm` flag or interactive confirmation
3. Row count logging to stdout
4. Exit code 0 on success, non-zero on failure
5. Idempotent operations (safe to run multiple times)

---

*End of CONSISTENCY_MAPS.md*
