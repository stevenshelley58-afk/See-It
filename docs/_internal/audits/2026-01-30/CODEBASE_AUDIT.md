# CODEBASE AUDIT REPORT

**Audit Date:** 2026-01-30  
**Auditor:** Kilo Code  
**Scope:** Full codebase audit across `app/` and `see-it-monitor/` workspaces  

---

## Executive Summary

This comprehensive audit examined the entire codebase for inconsistencies, duplication, security gaps, and architectural drift across two workspaces (main app and monitor service). 

### Total Issues Found: 47

| Severity | Count | Description |
|----------|-------|-------------|
| **P0 (Critical)** | 4 | Data corruption risk, auth bypass, production outage risk |
| **P1 (High)** | 15 | Drift risk, duplicate logic, inconsistent contracts |
| **P2 (Medium)** | 28 | Readability, cleanup, documentation gaps |

### Top 10 Systemic Risks

1. **Unauthenticated diagnostic endpoint** exposes all tenant data (`api.diagnose.jsx`)
2. **External API lacks tenant authorization** - cross-tenant data access possible
3. **Duplicate DB URL resolution logic** with feature drift between app and monitor
4. **Non-deterministic hashing** in prompt-control plane (JSON.stringify without key sorting)
5. **Hardcoded fallback secret** in shopper token generation
6. **Rate limit bypass** when DB query fails (returns `{ allowed: true }`)
7. **Schema drift** between app and monitor (missing `previousActiveVersionId`)
8. **Inconsistent retry/backoff** - 4 different strategies across codebase
9. **Missing secret scrubbing** in telemetry/logging
10. **Implicit auth bypass** possible in monitor via env var

---

## Issue Table

| ID | Severity | Category | Evidence (file:line) | What is Wrong | Impact | Smallest Fix | Verification |
|----|----------|----------|---------------------|---------------|--------|--------------|--------------|
| P0-1 | P0 | Multi-tenant scoping gap | [`app/routes/api.diagnose.jsx:1`](app/app/routes/api.diagnose.jsx:1) | Endpoint returns ALL shop data without authentication | Tenant enumeration, data breach | Add `requireShopAuth()` or remove endpoint | `curl http://localhost:3000/api/diagnose` should return 401 |
| P0-2 | P0 | Multi-tenant scoping gap | [`external.v1.runs.$id.tsx:30`](app/app/routes/external.v1.runs.$id.tsx:30) | Validates API key but NOT resource ownership | Cross-tenant data access via ID enumeration | Add `AND shopId` to Prisma query | Attempt to access another tenant's run_id |
| P0-3 | P0 | Security - hardcoded secret | [`app/utils/shopper-token.server.ts:10`](app/app/utils/shopper-token.server.ts:10) | Falls back to `"fallback-secret-change-in-production"` | Predictable token signing | Remove fallback, fail fast | Verify server fails to start without env var |
| P0-4 | P0 | Security - auth bypass | [`rate-limit.server.ts:45`](app/app/rate-limit.server.ts:45) | Returns `{ allowed: true }` when DB query fails | Rate limiting bypassed on DB errors | Return `{ allowed: false }` or throw | Simulate DB failure, verify request blocked |
| P1-1 | P1 | Duplicate logic | [`app/lib/db-url.js:1`](app/lib/db-url.js:1) vs [`see-it-monitor/lib/db.ts:1`](see-it-monitor/lib/db.ts:1) | Duplicate DB URL resolution logic with drift | Monitor lacks password validation, pgBouncer support | Extract to shared package | Compare feature parity between implementations |
| P1-2 | P1 | Non-deterministic hashing | [`prompt-resolver.server.ts:97`](app/app/services/prompt-control/prompt-resolver.server.ts:97) | Uses `JSON.stringify()` without key sorting | Same params produce different hashes | Import `canonicalize()` from hashing.server.ts | Verify hash stability with reordered keys |
| P1-3 | P1 | Non-deterministic hashing | [`prompt-version-manager.server.ts:46`](app/app/services/prompt-control/prompt-version-manager.server.ts:46) | Uses `JSON.stringify()` without key sorting | Template hashes vary by key order | Import `canonicalize()` from hashing.server.ts | Verify hash stability with reordered keys |
| P1-4 | P1 | Schema drift | [`see-it-monitor/prisma/schema.prisma:45`](see-it-monitor/prisma/schema.prisma:45) | Missing `previousActiveVersionId` field | Rollback chain broken in monitor | Add field to monitor schema | Compare schemas with `diff` |
| P1-5 | P1 | Inconsistent fallback chain | [`see-it-monitor/lib/auth.ts:15`](see-it-monitor/lib/auth.ts:15) | `JWT_SECRET || MONITOR_API_TOKEN` | Inconsistent auth token resolution | Standardize on single env var | Verify token validation consistency |
| P1-6 | P1 | Implicit auth bypass | [`see-it-monitor/middleware.ts:77`](see-it-monitor/middleware.ts:77) | `MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH` allows bypass | Production auth can be disabled | Remove env var, always require auth | Verify auth enforced in production |
| P1-7 | P1 | Script/runtime divergence | [`scripts/migrate-statuses.js:417`](app/scripts/migrate-statuses.js:417) | Custom env loading with `--prefer-dotenv` | Inverts standard precedence | Document contract or remove flag | Run with/without flag, verify precedence |
| P1-8 | P1 | Inconsistent retry logic | [`shopify-api.server.ts:45`](app/app/services/shopify-api.server.ts:45), [`photoroom.server.ts:88`](app/app/services/photoroom.server.ts:88) | 4 different backoff strategies | Thundering herd risk, uneven load | Create unified retry utility | Verify consistent retry behavior |
| P1-9 | P1 | Correlation ID inconsistency | [`emitter.server.ts:112`](app/app/services/telemetry/emitter.server.ts:112) | Multiple ID types (requestId, traceId, runId) | Broken distributed tracing | Unify on single correlation ID | Verify trace continuity across services |
| P1-10 | P1 | Missing secret scrubbing | [`emitter.server.ts:156`](app/app/services/telemetry/emitter.server.ts:156) | No filtering of apiKey, token, password | Secrets logged to telemetry | Add scrubber for sensitive keys | Trigger error with secret, verify redaction |
| P1-11 | P1 | Missing @@map | [`prisma/schema.prisma:15`](app/prisma/schema.prisma:15) | `Session` model lacks explicit table mapping | Implicit table naming | Add `@@map("sessions")` | Verify table name consistency |
| P1-12 | P1 | Inconsistent table naming | [`prisma/schema.prisma:312`](app/prisma/schema.prisma:312) | `prompt_audit_log` should be plural | Naming convention drift | Rename to `prompt_audit_logs` | Verify naming consistency |
| P1-13 | P1 | Unsafe script defaults | [`set-unlimited-credits.js:1`](app/scripts/set-unlimited-credits.js:1) | No confirmation prompt, no dry-run | Accidental credit modification | Add `--dry-run` and confirmation | Run without flags, verify no changes |
| P1-14 | P1 | Stale lock recovery | [`prepare-processor.server.ts:956`](app/app/services/prepare-processor.server.ts:956) | Infinite reset possible for failing items | Resource exhaustion | Add reset attempt counter | Verify counter prevents infinite loop |
| P1-15 | P1 | Incomplete TODO | [`emitter.server.ts:74`](app/app/services/telemetry/emitter.server.ts:74) | Large payload storage not implemented | Data loss on large events | Implement GCS overflow storage | Trigger large payload, verify storage |
| P2-1 | P2 | HOST mutation | [`vite.config.js:11`](app/vite.config.js:11) | Mutates `process.env` at runtime | Confusing debugging | Use const instead | Verify env not mutated |
| P2-2 | P2 | Missing env example | [`app/.env.example`] | No .env.example in app directory | Developer confusion | Add or document | Verify env examples complete |
| P2-3 | P2 | Mixed logging patterns | Various | Some code uses `console.*`, some uses structured logger | Inconsistent log shapes | Standardize on structured logger | Audit log output format |
| P2-4 | P2 | Comment/code mismatch | [`db-url.js:156`](app/lib/db-url.js:156) | Comment claims ordering that doesn't exist | Misleading documentation | Fix or remove comment | Verify comment accuracy |
| P2-5 | P2 | Dead code | [`ManualSegmentModal.deprecated.jsx`](app/app/components/ManualSegmentModal.deprecated.jsx:1) | File marked deprecated but still present | Build bloat | Remove or archive | Verify no imports of deprecated file |

---

## What I Read

### Environment & Configuration
- [`app/app/db.server.js`](app/app/db.server.js:1)
- [`app/lib/db-url.js`](app/lib/db-url.js:1)
- [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1)
- [`see-it-monitor/lib/auth.ts`](see-it-monitor/lib/auth.ts:1)
- [`see-it-monitor/middleware.ts`](see-it-monitor/middleware.ts:1)
- [`app/scripts/migrate-statuses.js`](app/scripts/migrate-statuses.js:1)
- [`/.env.example`](.env.example:1)
- [`/see-it-monitor/.env.example`](see-it-monitor/.env.example:1)

### Database & Schema
- [`app/prisma/schema.prisma`](app/prisma/schema.prisma:1) (full schema)
- [`see-it-monitor/prisma/schema.prisma`](see-it-monitor/prisma/schema.prisma:1) (full schema)
- All migration files in [`app/prisma/migrations/`](app/prisma/migrations/)

### Hashing & Identity
- [`app/app/services/see-it-now/hashing.server.ts`](app/app/services/see-it-now/hashing.server.ts:1)
- [`app/app/services/prompt-control/prompt-resolver.server.ts`](app/app/services/prompt-control/prompt-resolver.server.ts:1)
- [`app/app/services/prompt-control/prompt-version-manager.server.ts`](app/app/services/prompt-control/prompt-version-manager.server.ts:1)
- [`app/prisma/seed-prompts.ts`](app/prisma/seed-prompts.ts:1)

### Scripts & CLI
- [`app/scripts/`](app/scripts/) (all 11 files)
- [`see-it-monitor/scripts/prisma-generate.mjs`](see-it-monitor/scripts/prisma-generate.mjs:1)
- [`app/prisma/seed-prompts.ts`](app/prisma/seed-prompts.ts:1)

### Telemetry & Logging
- [`app/app/otel.server.ts`](app/app/otel.server.ts:1)
- [`app/app/services/telemetry/`](app/app/services/telemetry/) (all files)
- [`app/app/services/session-logger.server.ts`](app/app/services/session-logger.server.ts:1)

### Multi-Tenant & Auth
- [`app/app/routes/api.diagnose.jsx`](app/app/routes/api.diagnose.jsx:1)
- [`app/app/routes/external.v1.runs.$id.tsx`](app/app/routes/external.v1.runs.$id.tsx:1)
- [`app/app/services/external-auth/index.ts`](app/app/services/external-auth/index.ts:1)
- [`see-it-monitor/lib/api-utils.ts`](see-it-monitor/lib/api-utils.ts:1)
- [`app/app/rate-limit.server.ts`](app/app/rate-limit.server.ts:1)

### Error Handling & Retry
- [`app/app/services/shopify-api.server.ts`](app/app/services/shopify-api.server.ts:1)
- [`app/app/services/photoroom.server.ts`](app/app/services/photoroom.server.ts:1)
- [`app/app/services/prepare-processor.server.ts`](app/app/services/prepare-processor.server.ts:1)
- [`app/app/services/see-it-now/extractor.server.ts`](app/app/services/see-it-now/extractor.server.ts:1)

---

## Detailed Sub-Audit Reports

All detailed findings are available in the `audit/` directory:

1. [`audit/env-config-audit.md`](audit/env-config-audit.md) - Environment loading, DB URL resolution
2. [`audit/db-schema-audit.md`](audit/db-schema-audit.md) - Schema drift between workspaces
3. [`audit/hashing-audit.md`](audit/hashing-audit.md) - Hashing implementations and determinism
4. [`audit/scripts-audit.md`](audit/scripts-audit.md) - CLI tools and migrations
5. [`audit/telemetry-audit.md`](audit/telemetry-audit.md) - Logging and observability
6. [`audit/naming-audit.md`](audit/naming-audit.md) - ORM mappings and naming
7. [`audit/multi-tenant-audit.md`](audit/multi-tenant-audit.md) - Auth and tenant scoping
8. [`audit/error-handling-audit.md`](audit/error-handling-audit.md) - Retry and error patterns

---

*End of CODEBASE_AUDIT.md*
