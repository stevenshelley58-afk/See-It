# FIX PLAN

**Audit Date:** 2026-01-30  
**Based on:** CODEBASE_AUDIT.md and CONSISTENCY_MAPS.md

---

## Principles

1. **Canonical First:** All fixes import from or align with the canonical implementation
   - Canonical hashing: [`hashing.server.ts`](app/app/services/see-it-now/hashing.server.ts:1) with `canonicalize()`
   - Canonical DB URL: [`app/lib/db-url.js`](app/lib/db-url.js:1)
   - Canonical logging: [`telemetry/index.ts`](app/app/services/telemetry/index.ts:1)

2. **Deletion Over Abstraction:** Prefer removing duplicates to creating new abstractions

3. **Fail Fast:** Remove fallbacks that hide configuration errors

4. **Explicit Contracts:** Document any intentional behavior differences

5. **Smallest Patch:** Each fix should be the minimal change to resolve the issue

---

## Phase 1: P0 Correctness (Security & Data Integrity)

**Goal:** Fix critical security vulnerabilities and data corruption risks

### Task P0-1: Secure Diagnostic Endpoint
**Issue:** [`api.diagnose.jsx`](app/app/routes/api.diagnose.jsx:1) exposes all tenant data without auth

**Acceptance Criteria:**
- Endpoint requires valid Shopify session or admin API key
- Returns 401 for unauthenticated requests
- Optional: Add feature flag to completely disable in production

**Verification:**
```bash
# Should return 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/diagnose

# Should return 200 with valid auth
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/diagnose \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

---

### Task P0-2: Add Tenant Authorization to External API
**Issue:** [`external.v1.runs.$id.tsx`](app/app/routes/external.v1.runs.$id.tsx:30) validates API key but not resource ownership

**Acceptance Criteria:**
- All `/external/v1/*` routes verify `shopId` matches authenticated tenant
- Returns 404 (not 403) for cross-tenant access attempts (prevents ID enumeration)
- Same fix applied to `external.v1.runs.$id.events.tsx` and `external.v1.runs.$id.artifacts.tsx`

**Verification:**
```bash
# Create test runs for different shops
# Attempt to access shop A's run using shop B's API key
# Should return 404
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/external/v1/runs/$SHOP_A_RUN_ID \
  -H "Authorization: Bearer $SHOP_B_API_TOKEN"
```

---

### Task P0-3: Remove Hardcoded Fallback Secret
**Issue:** [`shopper-token.server.ts:10`](app/app/utils/shopper-token.server.ts:10) falls back to hardcoded string

**Acceptance Criteria:**
- Remove `"fallback-secret-change-in-production"` fallback
- Server fails to start if `SHOPPER_TOKEN_SECRET` not set
- Clear error message indicating missing env var

**Verification:**
```bash
# With env var set - should start
SHOPPER_TOKEN_SECRET=test npm run start

# Without env var - should fail with clear error
unset SHOPPER_TOKEN_SECRET
npm run start 2>&1 | grep -q "SHOPPER_TOKEN_SECRET is required"
```

---

### Task P0-4: Fix Rate Limit Bypass
**Issue:** [`rate-limit.server.ts:45`](app/app/rate-limit.server.ts:45) returns `{ allowed: true }` on DB failure

**Acceptance Criteria:**
- DB errors result in `{ allowed: false }` (fail closed)
- OR: Throw error that triggers 500 response
- Log the DB error for investigation

**Verification:**
```bash
# Simulate DB failure (block port or corrupt connection string)
# Make rate-limited request
# Should be blocked (not allowed through)
curl -s http://localhost:3000/api/products | jq '.rateLimit.allowed'  # Should be false
```

---

## Phase 2: P1 Drift Removal (Unification)

**Goal:** Eliminate duplicate logic and inconsistent contracts

### Task P1-1: Unify DB URL Resolution
**Issue:** Duplicate logic in [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1)

**Acceptance Criteria:**
- Monitor imports `getDatabaseUrl()` from shared location OR
- Monitor implementation updated to match app feature parity:
  - Password validation
  - pgBouncer support
  - SSL configuration
  - Detailed logging

**Verification:**
```bash
# Compare feature parity
diff -u <(grep -E "(password|pgbouncer|ssl|log)" app/lib/db-url.js) \
        <(grep -E "(password|pgbouncer|ssl|log)" see-it-monitor/lib/db.ts)
# Should show no missing features
```

---

### Task P1-2: Fix Non-Deterministic Hashing in Prompt-Control
**Issue:** [`prompt-resolver.server.ts:97`](app/app/services/prompt-control/prompt-resolver.server.ts:97) uses unsorted JSON.stringify

**Acceptance Criteria:**
- Import `canonicalize()` from [`hashing.server.ts`](app/app/services/see-it-now/hashing.server.ts:1)
- Use `canonicalize(params)` before hashing
- Same fix for [`prompt-version-manager.server.ts:46`](app/app/services/prompt-control/prompt-version-manager.server.ts:46)

**Verification:**
```bash
# Create test with reordered keys
node -e "
const { canonicalize } = require('./app/app/services/see-it-now/hashing.server.ts');
const obj1 = { a: 1, b: 2 };
const obj2 = { b: 2, a: 1 };
console.assert(canonicalize(obj1) === canonicalize(obj2), 'Hashes should match');
console.log('PASS: Deterministic hashing');
"
```

---

### Task P1-3: Fix Schema Drift (PromptVersion)
**Issue:** Monitor schema missing `previousActiveVersionId`

**Acceptance Criteria:**
- Add `previousActiveVersionId` field to [`see-it-monitor/prisma/schema.prisma`](see-it-monitor/prisma/schema.prisma:45)
- Generate and apply migration
- Verify rollback chain works in monitor

**Verification:**
```bash
cd see-it-monitor
npx prisma migrate dev --name add_previous_active_version_id
npx prisma generate
# Verify field exists in generated client
grep -q "previousActiveVersionId" node_modules/.prisma/client/index.d.ts && echo "PASS"
```

---

### Task P1-4: Standardize JWT Secret Handling
**Issue:** Inconsistent fallback chains between services

**Acceptance Criteria:**
- Remove `JWT_SECRET || MONITOR_API_TOKEN` fallback
- Use `MONITOR_API_TOKEN` exclusively for monitor auth
- Document the single source of truth

**Verification:**
```bash
# Verify no fallback in auth code
grep -r "JWT_SECRET.*||" see-it-monitor/lib/ || echo "PASS: No fallback found"
```

---

### Task P1-5: Remove Implicit Auth Bypass
**Issue:** [`middleware.ts:77`](see-it-monitor/middleware.ts:77) allows disabling auth via env var

**Acceptance Criteria:**
- Remove `MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH` env var check
- Always require authentication in production
- Keep bypass ONLY for explicit test environment

**Verification:**
```bash
# Verify env var no longer referenced
grep -q "MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH" see-it-monitor/middleware.ts \
  && echo "FAIL: Still present" || echo "PASS: Removed"
```

---

### Task P1-6: Add Dry-Run to Scripts
**Issue:** Scripts lack dry-run capability

**Acceptance Criteria:**
- Add `--dry-run` to `set-unlimited-credits.js`
- Add `--dry-run` to `backfill-product-type.js`
- Add `--dry-run` to `sync-live-tags.js`
- Scripts log planned actions without executing when flag is set

**Verification:**
```bash
# Test dry-run mode
node scripts/set-unlimited-credits.js --dry-run --shop myshop.myshopify.com
# Should log "Would set unlimited credits for shop: myshop.myshopify.com" without modifying DB
```

---

### Task P1-7: Unify Correlation IDs
**Issue:** Multiple ID types (requestId, traceId, runId) used inconsistently

**Acceptance Criteria:**
- All logs include `traceId` from OTEL when available
- `requestId` falls back to `traceId` if not set
- Document ID propagation in README

**Verification:**
```bash
# Make request, verify correlation in logs
curl http://localhost:3000/api/products -H "X-Request-ID: test-123"
# Check logs contain traceId that matches request
```

---

### Task P1-8: Add Secret Scrubbing
**Issue:** Telemetry may log secrets

**Acceptance Criteria:**
- Add scrubber function that redacts: `apiKey`, `token`, `password`, `secret`, `authorization`
- Apply to all telemetry payloads before emission
- Test with synthetic secret data

**Verification:**
```bash
# Trigger error with synthetic secret
# Verify log contains "[REDACTED]" instead of actual secret
grep "REDACTED" app.log || echo "FAIL: Secrets not scrubbed"
```

---

## Phase 3: P2 Cleanup (Readability & Consistency)

**Goal:** Improve code health and maintainability

### Task P2-1: Add Missing @@map to Session Model
**Issue:** [`prisma/schema.prisma:15`](app/prisma/schema.prisma:15) lacks explicit table mapping

**Acceptance Criteria:**
- Add `@@map("sessions")` to Session model
- Generate migration (if needed)
- Verify no breaking changes

**Verification:**
```bash
npx prisma migrate dev --name add_session_map
grep -A1 "model Session" prisma/schema.prisma | grep "@@map"
```

---

### Task P2-2: Fix Table Naming (Pluralization)
**Issue:** `prompt_audit_log` should be `prompt_audit_logs`

**Acceptance Criteria:**
- Update `@@map` in both schemas
- Create migration to rename table
- Update any raw SQL references

**Verification:**
```bash
npx prisma migrate dev --name rename_prompt_audit_log
grep "prompt_audit_logs" prisma/schema.prisma
```

---

### Task P2-3: Remove Runtime Env Mutation
**Issue:** [`vite.config.js:11`](app/vite.config.js:11) and [`remix.config.js:4`](app/remix.config.js:4) mutate `process.env`

**Acceptance Criteria:**
- Use local constants instead of mutating `process.env`
- Ensure `SHOPIFY_APP_URL` is set correctly without mutation
- No functional change to behavior

**Verification:**
```bash
# Verify env not mutated at runtime
grep -n "process.env.HOST" app/vite.config.js app/remix.config.js
# Should show assignment to local const, not process.env
```

---

### Task P2-4: Remove Dead Code
**Issue:** [`ManualSegmentModal.deprecated.jsx`](app/app/components/ManualSegmentModal.deprecated.jsx:1) is unused

**Acceptance Criteria:**
- Verify no imports of deprecated component
- Remove file
- Update any documentation references

**Verification:**
```bash
# Verify no imports
grep -r "ManualSegmentModal" app/ --include="*.jsx" --include="*.tsx" \
  | grep -v "deprecated" && echo "FAIL: Still imported" || echo "PASS: Safe to delete"

# Delete file
rm app/app/components/ManualSegmentModal.deprecated.jsx
```

---

### Task P2-5: Standardize on Structured Logger
**Issue:** Mixed `console.*` and structured logger usage

**Acceptance Criteria:**
- Replace all `console.log/error/warn` in server code with structured logger
- Add lint rule to prevent future `console.*` in server files
- Exclusions allowed for: build scripts, emergency debugging

**Verification:**
```bash
# Find remaining console usage (should only be in scripts/ and browser code)
grep -r "console\." app/app/ --include="*.ts" --include="*.tsx" \
  | grep -v "app/scripts/" \
  | grep -v ".server.ts" && echo "FAIL: Found console usage" || echo "PASS"
```

---

### Task P2-6: Document Retry Strategy
**Issue:** 4 different backoff strategies without documentation

**Acceptance Criteria:**
- Create ADR documenting retry strategy decisions
- Document when to use each retry pattern
- Consider creating unified retry utility (future P1)

**Verification:**
```bash
ls docs/adr/ | grep -i retry || echo "Create ADR"
```

---

## Do Not Do List

These refactors are explicitly out of scope:

1. **Major architectural changes** - No new microservices, no service mesh
2. **New package structure** - Don't create `packages/` directory or shared modules yet
3. **Framework migrations** - Don't migrate from Remix or Next.js
4. **Database migrations** - No schema rewrites, only additive changes
5. **Feature additions** - Only fixes, no new capabilities
6. **Test rewrites** - Don't add comprehensive test coverage (fix bugs only)
7. **Performance optimizations** - Unless fixing a P0 outage risk
8. **Code style refactors** - No purely cosmetic changes
9. **Dependency updates** - No version bumps unless security-related
10. **Documentation rewrites** - Only add missing contract docs

---

## Verification Commands Summary

### Pre-Deployment Checklist (Using Existing Scripts)

```bash
# 1. Type check both workspaces
cd app && npm run typecheck
cd see-it-monitor && npm run typecheck

# 2. Lint check
cd app && npm run lint

# 3. Run tests
cd app && npm run test
cd app && npm run test:integration

# 4. Verify schema sync
cd app && npx prisma validate
cd see-it-monitor && npx prisma validate

# 5. Build verification
cd app && npm run build
cd see-it-monitor && npm run build
```

### Post-Deployment Verification (Manual)

```bash
# Verify auth on diagnostic endpoint (should return 401)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/diagnose

# Verify rate limiting returns proper response
curl -s http://localhost:3000/api/products | jq '.rateLimit'

# Verify tenant isolation on external API (should return 404)
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/external/v1/runs/TEST_RUN_ID \
  -H "Authorization: Bearer TEST_TOKEN"
```

### Note on Missing Scripts

The following verification scripts do NOT exist and should NOT be created during P0/P1 fixes:
- `npm run test:security`
- `npm run test:hashing`

Use existing scripts (`test`, `typecheck`, `lint`) plus manual verification via curl commands.

---

*End of FIX_PLAN.md*
