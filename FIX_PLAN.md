# See-It App - Fix Plan & Quote

**Version:** 1.0
**Date:** December 8, 2025
**Based on:** AUDIT_REPORT.md v1.0

---

## Work Package Structure

Issues are grouped into 4 work packages by priority:

1. **Package A: Foundation & Must-Fix** - Blockers for core functionality
2. **Package B: Security & Compliance** - Critical security issues
3. **Package C: Stability & Resilience** - Reliability improvements
4. **Package D: UX & Polish** - Minor improvements

---

## Package A: Foundation & Must-Fix to Function

**Goal:** App can be installed, built, and core flows work

### Included Issues

| ID | Issue | Est. Hours |
|----|-------|------------|
| ENV-001 | onnxruntime-node build failure | 8 |
| ENV-002 | Missing package-lock.json | 0.5 |
| ENV-003 | Database provider mismatch (.env.example) | 0.5 |
| ENV-004 | Missing GEMINI_API_KEY validation | 2 |
| ENV-005 | Deprecated dependencies (9 packages) | 4 |
| CODE-010 | Hardcoded billing test mode | 1 |
| TEST-001 | Tests cannot run | 4 |
| TEST-002 | No test runner configured | 2 |

### Work Items

#### A1: Fix Build Pipeline (12 hours)

1. **Resolve onnxruntime-node issue** (8h)
   - Option A: Switch to `@xenova/transformers` for background removal
   - Option B: Move background removal to external image service
   - Option C: Pre-build and cache onnxruntime binaries
   - Recommendation: Option B (image service already exists per spec)

2. **Generate package-lock.json** (0.5h)
   - `npm install` on working machine
   - Commit `package-lock.json`
   - Update Dockerfile to use `npm ci`

3. **Fix .env.example** (0.5h)
   ```
   DATABASE_URL="postgresql://user:password@localhost:5432/seeit_dev"
   ```

4. **Add all required env vars to .env.example** (1h)
   - GEMINI_API_KEY
   - GOOGLE_CREDENTIALS_JSON
   - GCS_BUCKET
   - DISABLE_PREPARE_PROCESSOR
   - BUILD_TIMESTAMP

#### A2: Fix Core Configuration (4 hours)

1. **Add GEMINI_API_KEY startup validation** (2h)
   - Fail fast if required and missing
   - Or disable prepare UI when missing

2. **Fix billing test mode** (1h)
   ```javascript
   isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false'
   ```

3. **Document required vs optional env vars** (1h)

#### A3: Update Dependencies (4 hours)

1. **Update deprecated packages** (4h)
   - `npm update` for minor versions
   - Manual updates for major versions
   - Test after each update

#### A4: Configure Testing (6 hours)

1. **Add vitest to devDependencies** (1h)
2. **Add test script to package.json** (0.5h)
3. **Create test fixtures** (1h)
4. **Fix existing test harnesses** (2h)
5. **Add basic smoke tests** (1.5h)

### Package A Summary

| Category | Hours |
|----------|-------|
| Implementation | 22 |
| Testing | 4 |
| Buffer (20%) | 5.2 |
| **Total** | **31.2 hours** |

---

## Package B: Security & Compliance

**Goal:** All security vulnerabilities addressed, credentials rotated

### Included Issues

| ID | Issue | Est. Hours |
|----|-------|------------|
| SEC-001 | CRITICAL - Exposed production credentials | 8 |
| SEC-002 | Overly permissive CORS | 3 |
| SEC-003 | Missing request size limits | 2 |
| SEC-004 | Session data in logs | 2 |
| CODE-004 | Memory leak in rate limiter | 3 |
| CODE-006 | Missing input validation | 2 |

### Work Items

#### B1: Credential Rotation (8 hours)

1. **Rotate ALL credentials immediately** (2h)
   - Google Cloud service account key
   - PostgreSQL password
   - Shopify API key/secret
   - IMAGE_SERVICE_TOKEN

2. **Remove secrets from git history** (2h)
   ```bash
   git filter-branch --force --index-filter \
     'git rm --cached --ignore-unmatch gcs-credentials-base64.txt env.txt postgres_vars.txt postgres_vars_kv.txt' \
     --prune-empty --tag-name-filter cat -- --all
   ```

3. **Update .gitignore** (0.5h)
   ```gitignore
   # Secrets - NEVER commit
   *.credentials*.txt
   env.txt
   postgres_vars*.txt
   **/gcs-key.json
   **/*service-account*.json
   ```

4. **Audit access logs** (1.5h)
   - Check who accessed the repository
   - Check for unauthorized API usage

5. **Update all environment configurations** (2h)
   - Railway env vars
   - Local dev documentation

#### B2: Fix CORS (3 hours)

1. **Implement origin validation** (2h)
   ```typescript
   function getCorsHeaders(request: Request, session: { shop: string }) {
     const origin = request.headers.get("Origin") || "";
     const allowedOrigin = `https://${session.shop}`;

     if (origin.startsWith(allowedOrigin)) {
       return { "Access-Control-Allow-Origin": origin };
     }
     return { "Access-Control-Allow-Origin": allowedOrigin };
   }
   ```

2. **Update all app-proxy routes** (1h)

#### B3: Add Request Limits (4 hours)

1. **Add body size limit middleware** (2h)
2. **Validate mask_data_url size** (1h)
3. **Fix rate limiter memory leak** (3h)
   - Add LRU cache with max size
   - Implement TTL cleanup

### Package B Summary

| Category | Hours |
|----------|-------|
| Implementation | 18 |
| Security testing | 2 |
| Buffer (25%) | 5 |
| **Total** | **25 hours** |

---

## Package C: Stability & Resilience

**Goal:** App handles failures gracefully, data is consistent

### Included Issues

| ID | Issue | Est. Hours |
|----|-------|------------|
| CODE-001 | In-memory settings storage | 3 |
| CODE-002 | Duplicate GCS initialization | 2 |
| CODE-003 | Duplicate shop creation logic | 2 |
| CODE-005 | Signed URL TTL inconsistencies | 4 |
| CODE-007 | Quota race condition | 3 |
| CODE-014 | Webhook uninstall may throw | 1 |
| CODE-015 | AI model names may be outdated | 2 |
| SCHEMA-002 | Missing migrations in git | 1 |
| DEPLOY-003 | Missing health check for Gemini | 2 |

### Work Items

#### C1: Fix Data Persistence (6 hours)

1. **Persist settings to database** (3h)
   - Add Settings model or use Shop.settingsJson
   - Update api.settings.jsx

2. **Fix quota race condition** (3h)
   - Use `prisma.$transaction` for atomic operations
   ```javascript
   await prisma.$transaction(async (tx) => {
     const usage = await tx.usageDaily.findFirst({...});
     if (usage.prepRenders + count > quota) throw new QuotaError();
     await tx.usageDaily.update({...});
   });
   ```

#### C2: Code Consolidation (6 hours)

1. **Centralize GCS client** (2h)
   - Create `utils/gcs-client.server.ts`
   - Export singleton instance
   - Update all consumers

2. **Centralize shop creation** (2h)
   - Add `ensureShop()` to `shopify.server.js`
   - Update all routes to use it

3. **Fix webhook error handling** (1h)
   - Use findFirst + conditional update

4. **Verify AI model names** (1h)
   - Check Gemini API documentation
   - Update config if needed

#### C3: URL & Cache Management (4 hours)

1. **Standardize signed URL TTLs** (2h)
   - Define TTL constants in config
   - Use consistent values everywhere

2. **Add URL refresh mechanism** (2h)
   - Generate fresh URLs from keys
   - Update RoomSession URL fields

#### C4: Infrastructure Improvements (3 hours)

1. **Add Gemini health check** (2h)
   - Add API connectivity test to healthz
   - Return warning (not error) if down

2. **Commit Prisma migrations** (1h)
   - Remove from .gitignore
   - Commit existing migrations

### Package C Summary

| Category | Hours |
|----------|-------|
| Implementation | 19 |
| Testing | 3 |
| Buffer (20%) | 4.4 |
| **Total** | **26.4 hours** |

---

## Package D: UX & Polish

**Goal:** Consistent API responses, clean code, documentation

### Included Issues

| ID | Issue | Est. Hours |
|----|-------|------------|
| CODE-008 | Inconsistent API response format | 4 |
| CODE-009 | Hardcoded version in extension | 1 |
| CODE-011 | Missing CSS module file | 0.5 |
| CODE-012 | Console.log in production | 3 |
| CODE-013 | Missing TypeScript strict mode | 8 |
| SCHEMA-001 | Schema vs spec drift | 2 |
| DEPLOY-004 | No bundle size optimization | 4 |
| TOOL-001 | ESLint configuration outdated | 2 |
| TOOL-002 | No type checking script | 0.5 |
| TEST-003 | No fixture files | 1 |
| TEST-004 | Missing webhook tests | 4 |
| TEST-005 | Missing billing tests | 4 |

### Work Items

#### D1: API Consistency (4 hours)

1. **Standardize response format** (4h)
   - Use camelCase everywhere
   - Update all API routes
   - Document response shapes

#### D2: Code Quality (11.5 hours)

1. **Replace console.log with logger** (3h)
2. **Fix CSS module file** (0.5h)
3. **Add version injection to extension** (1h)
4. **Update spec.md with schema fields** (2h)
5. **Upgrade ESLint** (2h)
6. **Add typecheck script** (0.5h)
7. **Enable TypeScript strict mode** (2.5h)
   - Focus on critical files first

#### D3: Testing Improvements (9 hours)

1. **Create test fixtures** (1h)
2. **Add webhook tests** (4h)
3. **Add billing flow tests** (4h)

#### D4: Build Optimization (4 hours)

1. **Analyze bundle size** (2h)
2. **Optimize imports** (2h)

### Package D Summary

| Category | Hours |
|----------|-------|
| Implementation | 28.5 |
| Testing | 9 |
| Buffer (15%) | 5.6 |
| **Total** | **43.1 hours** |

---

## Grand Total & Quote

### Hours Summary

| Package | Hours | Priority |
|---------|-------|----------|
| A: Foundation & Must-Fix | 31.2 | CRITICAL |
| B: Security & Compliance | 25.0 | CRITICAL |
| C: Stability & Resilience | 26.4 | HIGH |
| D: UX & Polish | 43.1 | MEDIUM |
| **Total** | **125.7 hours** |

### Cost Calculation

| Category | Hours | Rate | Subtotal |
|----------|-------|------|----------|
| Package A (Critical) | 31.2 | $150/hr | $4,680 |
| Package B (Critical) | 25.0 | $150/hr | $3,750 |
| Package C (High) | 26.4 | $125/hr | $3,300 |
| Package D (Medium) | 43.1 | $100/hr | $4,310 |
| **Labor Subtotal** | **125.7** | | **$16,040** |

### Additional Costs

| Item | Cost |
|------|------|
| Credential rotation & security audit | $1,000 |
| Staging environment setup | $500 |
| Documentation update | $500 |
| **Additional Subtotal** | **$2,000** |

---

## Final Quote

| Description | Amount |
|-------------|--------|
| Labor (125.7 hours) | $16,040 |
| Additional Costs | $2,000 |
| **GRAND TOTAL** | **$18,040 USD** |

### Payment Terms

- 40% upfront ($7,216) - Upon contract signing
- 30% midpoint ($5,412) - After Packages A & B complete
- 30% completion ($5,412) - Upon final delivery

### Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Week 1-2 | 10 days | Packages A & B complete |
| Week 3-4 | 10 days | Packages C & D complete |
| Week 5 | 5 days | Testing & verification |
| **Total** | **25 working days** | |

### Assumptions

1. Shopify dev store access provided
2. GCS bucket and Gemini API keys provided
3. Railway access for deployment testing
4. Client available for questions (1-2 business day response)
5. No scope changes during implementation

### Guarantee

All 68 issues documented in AUDIT_REPORT.md will be resolved. If any issue remains unresolved at delivery, work continues at no additional cost until 100% complete.

---

## Recommended Execution Order

### Phase 1: Critical Path (Week 1)
1. SEC-001: Rotate credentials (IMMEDIATE)
2. ENV-001: Fix build (onnxruntime)
3. ENV-003: Fix .env.example
4. SEC-002: Fix CORS

### Phase 2: Foundation (Week 2)
1. ENV-002, ENV-004, ENV-005: Build & config
2. CODE-010: Billing test mode
3. SEC-003, CODE-004, CODE-006: Security hardening

### Phase 3: Stability (Week 3)
1. CODE-001, CODE-007: Data persistence & race conditions
2. CODE-002, CODE-003: Code consolidation
3. CODE-005, CODE-015: URL & API fixes

### Phase 4: Quality (Week 4)
1. TEST-*: Testing infrastructure
2. CODE-008, CODE-012: API consistency & logging
3. DEPLOY-003, SCHEMA-002: Infrastructure

### Phase 5: Polish & Verify (Week 5)
1. Remaining items from Package D
2. Full regression testing
3. Documentation updates
4. Handoff & training

---

## Acceptance Criteria

The fix is considered complete when:

1. **Build:** `npm install && npm run build` succeeds
2. **Tests:** All tests pass
3. **Health:** `/healthz` returns healthy
4. **Security:** No secrets in repository
5. **Functional:** All flows in FLOWS.md work
6. **Billing:** Real charges can be created (test mode off)
7. **Compliance:** GDPR webhooks process successfully

---

**Quote Valid Until:** December 22, 2025

**Prepared By:** Senior Development Consultant
**Contact:** [To be provided]
