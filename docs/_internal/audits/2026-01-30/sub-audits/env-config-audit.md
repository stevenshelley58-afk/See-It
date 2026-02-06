# Environment & Configuration Precedence Audit

**Audit Date:** 2026-01-30  
**Auditor:** Kilo Code  
**Scope:** ENV and CONFIG PRECEDENCE across `app/` and `see-it-monitor/` workspaces

---

## Executive Summary

This audit identifies **significant inconsistencies** in environment variable handling between the main app and the monitor service. Key findings include:

1. **Duplicate DB URL resolution logic** with subtle differences
2. **Inconsistent env loading patterns** (no centralized loader)
3. **Conflicting fallback chains** for secrets/tokens
4. **No explicit dotenv usage** in either workspace (relies on framework/runtime)

---

## 1. Environment Loading Mechanisms

### 1.1 Main App (`app/`)

**No explicit dotenv loading found.** The app relies on:
- **Remix/Vite** to load `.env` files during development
- **Railway** to inject env vars in production
- **Custom env loader** in `scripts/migrate-statuses.js` only

| File | Loading Pattern | Notes |
|------|-----------------|-------|
| [`app/vite.config.js`](app/vite.config.js:1) | `process.env.*` direct access | No dotenv import |
| [`app/remix.config.js`](app/remix.config.js:1) | `process.env.*` direct access | Mutates env vars (HOST→SHOPIFY_APP_URL) |
| [`app/scripts/migrate-statuses.js`](app/scripts/migrate-statuses.js:417) | Custom loader | Loads `.env`, `.env.local`, `.env.production` manually |

### 1.2 Monitor Service (`see-it-monitor/`)

**No explicit dotenv loading found.** Relies on:
- **Next.js** to load `.env` files during development
- **Vercel** to inject env vars in production

| File | Loading Pattern | Notes |
|------|-----------------|-------|
| [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1) | `process.env.*` direct access | No dotenv import |
| [`see-it-monitor/lib/auth.ts`](see-it-monitor/lib/auth.ts:1) | `process.env.*` direct access | No dotenv import |
| [`see-it-monitor/middleware.ts`](see-it-monitor/middleware.ts:1) | `process.env.*` direct access | No dotenv import |

### 1.3 Root-Level `.env.example`

There are **two** `.env.example` files:
- [`/.env.example`](.env.example:1) - Root level (for main app)
- [`/see-it-monitor/.env.example`](see-it-monitor/.env.example:1) - Monitor-specific

**Issue:** No `.env.example` in `app/` directory - the root one serves both.

---

## 2. Database URL Resolution

### 2.1 Main App (`app/lib/db-url.js`)

**Priority Order:**
1. `DATABASE_URL` (if not Railway internal)
2. `DATABASE_PUBLIC_URL` (fallback)
3. `DATABASE_URL` (if Railway internal and no public URL - will fail)

**Features:**
- Detects `.railway.internal` hosts
- Validates Postgres URL format
- Checks for missing passwords
- Applies pool settings (`DB_POOL_SIZE`, `DB_POOL_TIMEOUT`)
- Supports `DB_PGBOUNCER` mode

```javascript
// From app/lib/db-url.js
if (privateUrl && !isRailwayInternalHost(privateUrl)) {
  url = privateUrl;
  source = "DATABASE_URL";
} else if (publicUrl) {
  url = publicUrl;
  source = "DATABASE_PUBLIC_URL";
}
```

### 2.2 Monitor Service (`see-it-monitor/lib/db.ts`)

**Priority Order:**
1. `DATABASE_URL` (if not Railway internal)
2. `DATABASE_PUBLIC_URL` (fallback)
3. `DATABASE_URL` (last resort - may fail)

**Issues:**
- **Duplicated logic** but missing features from main app:
  - No password validation
  - No `DB_PGBOUNCER` support
  - No SSL configuration helper
  - Simpler error messages

```typescript
// From see-it-monitor/lib/db.ts
if (privateUrl && !isRailwayInternalHost(privateUrl)) {
  baseUrl = privateUrl;
} else if (publicUrl) {
  baseUrl = publicUrl;
} else {
  baseUrl = privateUrl;
}
```

### 2.3 Comparison Table

| Feature | Main App | Monitor | Status |
|---------|----------|---------|--------|
| Railway internal detection | ✅ | ✅ | Consistent |
| Pool settings (`DB_POOL_SIZE`) | ✅ | ✅ | Consistent |
| Pool timeout (`DB_POOL_TIMEOUT`) | ✅ | ✅ | Consistent |
| Password validation | ✅ | ❌ | **DRIFT** |
| `DB_PGBOUNCER` support | ✅ | ❌ | **DRIFT** |
| SSL config helper | ✅ | ❌ | **DRIFT** |
| Detailed warnings | ✅ | ❌ | **DRIFT** |

---

## 3. Secret/Token Fallback Chains

### 3.1 JWT Secret / Monitor API Token

**Monitor Service** (`see-it-monitor/lib/auth.ts`):
```typescript
const JWT_SECRET = process.env.JWT_SECRET || process.env.MONITOR_API_TOKEN;
```

**Monitor Middleware** (`see-it-monitor/middleware.ts`):
```typescript
const jwtSecret = process.env.JWT_SECRET || process.env.MONITOR_API_TOKEN;
```

**Main App** (`app/app/services/external-auth/index.ts`):
```typescript
const expectedToken = getRequiredEnvVar("MONITOR_API_TOKEN");
// No fallback to JWT_SECRET
```

**Issue:** Inconsistent fallback chains between services.

### 3.2 Shopper Token Secret

**Main App** (`app/app/utils/shopper-token.server.ts`):
```typescript
const TOKEN_SECRET = process.env.SHOPPER_TOKEN_SECRET || 
                     process.env.SHOPIFY_API_SECRET || 
                     "fallback-secret-change-in-production";
```

**Issue:** Falls back to hardcoded string - potential security risk if not overridden.

---

## 4. Environment Variable Casing & Naming

### 4.1 Consistent Variables (✅)

| Variable | Used In | Casing |
|----------|---------|--------|
| `DATABASE_URL` | Both | ✅ Consistent |
| `DATABASE_PUBLIC_URL` | Both | ✅ Consistent |
| `DB_POOL_SIZE` | Both | ✅ Consistent |
| `DB_POOL_TIMEOUT` | Both | ✅ Consistent |
| `NODE_ENV` | Both | ✅ Consistent |
| `GEMINI_API_KEY` | Both | ✅ Consistent |

### 4.2 Inconsistent Variables (⚠️)

| Variable | Location | Issue |
|----------|----------|-------|
| `MONITOR_API_TOKEN` | Both | Used for different purposes |
| `JWT_SECRET` | Monitor only | Falls back to `MONITOR_API_TOKEN` |
| `SHOPPER_TOKEN_SECRET` | App only | No equivalent in monitor |
| `PGSSLMODE` | App only | Not used in monitor |
| `DB_PGBOUNCER` | App only | Not used in monitor |

---

## 5. Precedence Order Analysis

### 5.1 Runtime Precedence (Both Workspaces)

Since neither workspace uses explicit `dotenv.config()`, precedence depends on the framework:

**Development:**
1. Framework-loaded `.env.local` (Remix/Next.js)
2. Framework-loaded `.env`
3. Shell environment variables
4. System environment

**Production (Railway/Vercel):**
1. Platform-injected env vars (highest priority)
2. Build-time env vars (if any)

### 5.2 Script-Level Precedence (`migrate-statuses.js`)

The only place with explicit env loading:
```javascript
// Order: least-specific -> most-specific
loadEnvFileIfPresent(".env", { preferDotenv });
loadEnvFileIfPresent(".env.local", { preferDotenv });
loadEnvFileIfPresent(".env.production", { preferDotenv });
```

**Issue:** `--prefer-dotenv` flag allows env files to override existing env vars - opposite of standard behavior.

---

## 6. Critical Issues Found

### 6.1 🔴 HIGH: Duplicate DB Resolution Logic

**Location:** [`app/lib/db-url.js`](app/lib/db-url.js:1) vs [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1)

**Risk:** Logic drift could cause different connection behavior between services.

**Recommendation:** Extract to shared package or create symlink.

### 6.2 🔴 HIGH: Implicit Auth Security Gap

**Location:** [`see-it-monitor/middleware.ts`](see-it-monitor/middleware.ts:77)

```typescript
const allowImplicitAuth =
  process.env.NODE_ENV !== "production" ||
  process.env.MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH === "true";
```

**Risk:** Implicit auth can be enabled in production via env var.

### 6.3 🟡 MEDIUM: Hardcoded Fallback Secret

**Location:** [`app/app/utils/shopper-token.server.ts`](app/app/utils/shopper-token.server.ts:10)

```typescript
const TOKEN_SECRET = process.env.SHOPPER_TOKEN_SECRET || 
                     process.env.SHOPIFY_API_SECRET || 
                     "fallback-secret-change-in-production";
```

**Risk:** If neither env var is set, uses predictable fallback.

### 6.4 🟡 MEDIUM: Missing Env Var Validation

**Location:** Multiple files

**Risk:** Many env vars are accessed without validation, causing runtime failures.

Example:
```javascript
// app/app/shopify.server.js
apiKey: process.env.SHOPIFY_API_KEY, // No validation
```

### 6.5 🟡 MEDIUM: HOST Variable Mutation

**Location:** [`app/vite.config.js`](app/vite.config.js:11) and [`app/remix.config.js`](app/remix.config.js:4)

```javascript
if (process.env.HOST && (!process.env.SHOPIFY_APP_URL || ...)) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}
```

**Risk:** Mutating env vars at runtime can cause confusion in debugging.

---

## 7. Recommendations

### 7.1 Immediate Actions

1. **Unify DB URL resolution**
   - Create shared package or utility
   - Ensure both services use identical logic

2. **Remove hardcoded secrets**
   - Fail fast if required secrets are missing
   - Remove `"fallback-secret-change-in-production"`

3. **Document env var requirements**
   - Add validation at startup
   - Log warnings for missing optional vars

### 7.2 Short-term Improvements

1. **Add explicit env loading**
   - Consider `dotenv` with explicit config
   - Document precedence clearly

2. **Standardize naming conventions**
   - Prefix service-specific vars (e.g., `APP_`, `MONITOR_`)
   - Create shared constants file

3. **Add env var validation layer**
   - Schema validation at startup (e.g., Zod)
   - Clear error messages for missing vars

### 7.3 Long-term Architecture

1. **Centralized configuration service**
   - Single source of truth for env handling
   - Type-safe config objects

2. **Configuration drift detection**
   - CI check for env var consistency
   - Automated audit on PR

---

## 8. Appendix: Complete Env Var Inventory

### 8.1 Main App (`app/`)

| Variable | Required | Used In | Fallback |
|----------|----------|---------|----------|
| `SHOPIFY_API_KEY` | ✅ | shopify.server.js | None |
| `SHOPIFY_API_SECRET` | ✅ | shopify.server.js | `""` |
| `SCOPES` | ✅ | shopify.server.js | None |
| `SHOPIFY_APP_URL` | ✅ | shopify.server.js | `HOST` |
| `HOST` | ⚠️ | vite.config.js | - |
| `DATABASE_URL` | ✅ | db.server.js | None |
| `DATABASE_PUBLIC_URL` | ⚠️ | db-url.js | None |
| `DB_POOL_SIZE` | ❌ | db-url.js | `"10"` |
| `DB_POOL_TIMEOUT` | ❌ | db-url.js | `"20"` |
| `DB_PGBOUNCER` | ❌ | db-url.js | None |
| `PGSSLMODE` | ❌ | db-url.js | None |
| `GEMINI_API_KEY` | ✅ | Multiple | None |
| `PHOTOROOM_API_KEY` | ⚠️ | photoroom.server.js | None |
| `GOOGLE_CREDENTIALS_JSON` | ✅ | gcs-client.server.js | None |
| `GCS_BUCKET` | ❌ | gcs-client.server.js | `"see-it-room"` |
| `GCS_SESSION_BUCKET` | ❌ | session-logger.server.js | `"see-it-sessions"` |
| `MONITOR_API_TOKEN` | ✅ | external-auth/index.ts | None |
| `MONITOR_PREP_EVENTS_URL` | ❌ | prep-events.server.js | Hardcoded URL |
| `SHOPPER_TOKEN_SECRET` | ❌ | shopper-token.server.ts | `SHOPIFY_API_SECRET` → hardcoded |
| `CRON_SECRET` | ⚠️ | cron.*.ts | None (dev bypass) |
| `NODE_ENV` | ❌ | Multiple | `"development"` |

### 8.2 Monitor Service (`see-it-monitor/`)

| Variable | Required | Used In | Fallback |
|----------|----------|---------|----------|
| `DATABASE_URL` | ✅ | lib/db.ts | None |
| `DATABASE_PUBLIC_URL` | ⚠️ | lib/db.ts | None |
| `DB_POOL_SIZE` | ❌ | lib/db.ts | `"10"` |
| `DB_POOL_TIMEOUT` | ❌ | lib/db.ts | `"20"` |
| `MONITOR_API_TOKEN` | ✅ | lib/auth.ts | None |
| `JWT_SECRET` | ⚠️ | lib/auth.ts | `MONITOR_API_TOKEN` |
| `RAILWAY_API_URL` | ✅ | api/external | None |
| `MONITOR_REVEAL_TOKEN` | ❌ | api/external | None |
| `MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH` | ❌ | middleware.ts | `false` |
| `GEMINI_API_KEY` | ✅ | lib/prompt-service.ts | None |
| `NODE_ENV` | ❌ | Multiple | `"development"` |

---

## 9. Files Audited

### Core Configuration Files
- [`app/app/db.server.js`](app/app/db.server.js:1)
- [`app/app/shopify.server.js`](app/app/shopify.server.js:1)
- [`app/lib/db-url.js`](app/lib/db-url.js:1)
- [`see-it-monitor/lib/db.ts`](see-it-monitor/lib/db.ts:1)
- [`see-it-monitor/lib/auth.ts`](see-it-monitor/lib/auth.ts:1)
- [`see-it-monitor/middleware.ts`](see-it-monitor/middleware.ts:1)

### Environment Examples
- [`/.env.example`](.env.example:1)
- [`/see-it-monitor/.env.example`](see-it-monitor/.env.example:1)

### Build/Runtime Config
- [`app/vite.config.js`](app/vite.config.js:1)
- [`app/remix.config.js`](app/remix.config.js:1)
- [`see-it-monitor/next.config.js`](see-it-monitor/next.config.js:1)

### Scripts with Custom Loading
- [`app/scripts/migrate-statuses.js`](app/scripts/migrate-statuses.js:1)

---

*End of Audit Report*
