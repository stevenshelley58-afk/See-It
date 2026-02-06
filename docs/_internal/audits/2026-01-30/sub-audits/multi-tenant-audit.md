# Multi-Tenant Scoping & Authentication Audit Report

**Date:** 2026-01-30  
**Auditor:** Kilo Code  
**Scope:** Authentication patterns, tenant scoping, and cross-tenant data access risks

---

## Executive Summary

This audit examines how tenant isolation is enforced across the See It application. The system uses **Shopify OAuth** for admin routes and **API Key + JWT** for external/monitor APIs. Overall tenant scoping is **well-implemented** in most areas, but there are **critical security gaps** that need immediate attention.

### Risk Rating: **HIGH** ⚠️
- 1 Critical vulnerability (unauthenticated diagnostic endpoint exposing all tenant data)
- 1 High vulnerability (external API lacks tenant-level authorization checks)
- Several medium/low concerns around implicit auth and token handling

---

## 1. Authentication Architecture Overview

### 1.1 Authentication Methods

| Route Category | Auth Method | Implementation |
|---------------|-------------|----------------|
| `/app/*` (Admin) | Shopify OAuth | `authenticate.admin(request)` |
| `/app-proxy/*` | Shopify Public App Proxy | `authenticate.public.appProxy(request)` |
| `/webhooks/*` | Shopify Webhook HMAC | `authenticate.webhook(request)` |
| `/external/*` | API Key (Bearer token) | `requireExternalAuth(request)` |
| `/api/*` (Internal) | Session-based | `authenticate.admin(request)` |
| See-It-Monitor | JWT or API Key | `authenticateRequest()` via middleware |

### 1.2 Key Auth Files

| File | Purpose |
|------|---------|
| [`app/app/services/external-auth/index.ts`](app/app/services/external-auth/index.ts:1) | External API auth (API key, rate limiting, CORS) |
| [`app/app/utils/shop.server.ts`](app/app/utils/shop.server.ts:1) | Session-to-shop resolution |
| [`see-it-monitor/lib/auth.ts`](see-it-monitor/lib/auth.ts:1) | JWT verification and session management |
| [`see-it-monitor/middleware.ts`](see-it-monitor/middleware.ts:1) | Request-level auth middleware |
| [`see-it-monitor/lib/api-utils.ts`](see-it-monitor/lib/api-utils.ts:1) | Shop access verification helpers |

---

## 2. Tenant Scoping Enforcement

### 2.1 Properly Scoped Areas ✅

#### Admin Routes (`/app/*`)
All admin routes correctly use [`getShopFromSession()`](app/app/utils/shop.server.ts:18) to resolve the authenticated shop:

```typescript
// Pattern found in: app._index.jsx, app.products.jsx, app.settings.jsx
const { session, admin } = await authenticate.admin(request);
let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
```

**Tenant isolation verified:**
- Queries include `where: { shopId: shop.id }`
- Product assets scoped by `shopId` + `productId`
- Settings fetched per-shop

#### App Proxy Routes (`/app-proxy/*`)
All app proxy routes use [`authenticate.public.appProxy()`](app/app/services/app-proxy.see-it-now.render.server.ts:82) and validate the shop:

```typescript
const { session } = await authenticate.public.appProxy(request);
const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
// All subsequent queries use shop.id for scoping
```

**Additional protections:**
- [`isSeeItNowAllowedShop()`](app/app/services/app-proxy.see-it-now.render.server.ts:101) allowlist check
- [`checkRateLimit()`](app/app/services/app-proxy.see-it-now.render.server.ts:158) per-session rate limiting
- [`checkQuota()`](app/app/services/app-proxy.see-it-now.render.server.ts:216) per-shop quota enforcement

#### See-It-Monitor API
The monitor API has **robust tenant scoping** via [`requireShopAccessAndPermission()`](see-it-monitor/lib/api-utils.ts:228):

```typescript
// Pattern in: see-it-monitor/app/api/shops/[shopId]/*
const authResult = requireShopAccessAndPermission(request, shopId, "VIEW_PROMPTS");
if ("error" in authResult) {
  return authResult.error;
}
```

**Access control features:**
- JWT tokens include `shops` claim (allowed shop IDs)
- Admins with `hasFullAccess: true` can access all shops
- Other users restricted to `session.allowedShops`
- Permission-based access control (`admin`, `editor`, `viewer` roles)

### 2.2 Database-Level Tenant Scoping

All Prisma queries properly include `shopId` filters:

```typescript
// Found in: api.products.$id.assets.jsx, api.products.prepare.jsx, etc.
where: { shopId: shop.id, productId: productId }

// Composite runs scoped to shop
where: { shopId, createdAt: { gte: oneHourAgo } }

// Monitor queries enforce shop scoping
where: { runId, shopId }
```

**Composite unique keys enforce tenant isolation:**
- `@@unique([shopId, name])` on `PromptDefinition`
- `@@unique([shopId, email])` on `Shopper`
- `@@unique([shopId, productId])` relationships

---

## 3. Critical Vulnerabilities

### 3.1 🔴 CRITICAL: Unauthenticated Diagnostic Endpoint

**File:** [`app/app/routes/api.diagnose.jsx`](app/app/routes/api.diagnose.jsx:1)

**Issue:** This endpoint has **NO authentication** and exposes sensitive cross-tenant data:

```typescript
// NO authenticate.admin() call!
export const loader = async () => {
    const shops = await prisma.shop.findMany({
        select: {
            id: true,
            shopDomain: true,
            plan: true,
            _count: {
                select: {
                    renderJobs: true,
                    productAssets: true,
                    roomSessions: true,
                }
            }
        }
    });
    // Returns ALL shops with counts
}
```

**Exposed Data:**
- All shop IDs and domains
- Plan information
- Render job counts per shop
- Product asset counts per shop
- Recent render jobs with shop domains

**Risk:** Complete tenant data enumeration by any unauthenticated attacker.

**Recommendation:** 
1. **IMMEDIATE:** Remove this endpoint from production
2. Add authentication if diagnostic endpoint is needed
3. Scope results to the authenticated shop only

---

### 3.2 🔴 HIGH: External API Lacks Tenant Authorization

**File:** [`app/app/routes/external.v1.runs.$id.tsx`](app/app/routes/external.v1.runs.$id.tsx:30)

**Issue:** The external API only validates the API key but does **NOT verify** that the requested run belongs to any specific tenant:

```typescript
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    const { revealEnabled, corsHeaders } = await requireExternalAuth(request);
    
    const runId = params.id;
    // NO shopId validation!
    
    const run = await getRunDetailExternal(runId, revealEnabled);
    // Returns ANY run if you know the ID
}
```

**Affected Endpoints:**
- `GET /external/v1/runs/:id` - Can access any run by ID
- `GET /external/v1/runs/:id/events` - Can access any run's events
- `GET /external/v1/runs/:id/artifacts` - Can access any run's artifacts

**Risk:** Cross-tenant data access via run ID enumeration.

**Recommendation:**
1. Add shop-based authorization to external endpoints
2. Require `shopId` parameter and validate against the run
3. Or use JWT with `shops` claim like the monitor API

---

## 4. Medium & Low Concerns

### 4.1 🟡 MEDIUM: Implicit Auth Bypass in Development

**File:** [`see-it-monitor/middleware.ts`](see-it-monitor/middleware.ts:75)

```typescript
// Check if implicit dashboard auth is allowed
const allowImplicitAuth =
  process.env.NODE_ENV !== "production" ||
  process.env.MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH === "true";

if (allowImplicitAuth && monitorApiToken) {
  // Create admin session using MONITOR_API_TOKEN
  const session = {
    actor: "dashboard@see-it.app",
    role: "admin",
    hasFullAccess: true,
  };
}
```

**Risk:** If `MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH` is accidentally set in production, full admin access is granted without authentication.

**Recommendation:** Add additional safeguards or warnings when implicit auth is enabled.

### 4.2 🟡 MEDIUM: External Health Endpoint Returns Global Stats

**File:** [`app/app/routes/external.v1.health.tsx`](app/app/routes/external.v1.health.tsx:16)

The health endpoint returns global statistics without tenant filtering. While this is less sensitive, it could leak aggregate usage data.

### 4.3 🟡 MEDIUM: Timing-Safe Comparison Implementation

**File:** [`see-it-monitor/lib/auth.ts`](see-it-monitor/lib/auth.ts:227)

The custom timing-safe comparison differs from Node's built-in:

```typescript
// Custom implementation (vulnerable to early-exit optimization?)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;  // Early return leaks length info
  }
  // ...
}
```

**Recommendation:** Use Node's `crypto.timingSafeEqual()` consistently.

### 4.4 🟢 LOW: Healthz Endpoint Publicly Accessible

**File:** [`app/app/routes/healthz.ts`](app/app/routes/healthz.ts:1)

Health check endpoint is intentionally public (no auth) for load balancer checks. This is acceptable but should not expose sensitive data.

---

## 5. Authentication Patterns Analysis

### 5.1 Proper Pattern: Admin Routes

```typescript
// CORRECT: app/app/routes/api.products.prepare.jsx
const { admin, session } = await authenticate.admin(request);
const { shopId } = await getShopFromSession(session, request, "prepare");
// All queries use shopId for scoping
```

### 5.2 Proper Pattern: Monitor API with Shop Access Check

```typescript
// CORRECT: see-it-monitor/app/api/shops/[shopId]/prompts/route.ts
const authResult = requireShopAccessAndPermission(
  request,
  shopId,
  "VIEW_PROMPTS"
);
if ("error" in authResult) {
  return authResult.error;
}
```

### 5.3 Vulnerable Pattern: Missing Tenant Check

```typescript
// VULNERABLE: app/app/routes/external.v1.runs.$id.tsx
const { corsHeaders } = await requireExternalAuth(request);
const run = await getRunDetailExternal(runId, revealEnabled); // No shop filter!
```

### 5.4 Vulnerable Pattern: No Authentication

```typescript
// VULNERABLE: app/app/routes/api.diagnose.jsx
export const loader = async () => {
  // NO AUTH - exposes all tenant data
}
```

---

## 6. Cross-Tenant Data Access Risks

| Risk Area | Status | Notes |
|-----------|--------|-------|
| Product Assets | ✅ Safe | Always filtered by `shopId` |
| Render Jobs | ⚠️ At Risk | External API can access any run by ID |
| Room Sessions | ✅ Safe | App proxy validates session.shop |
| Shop Settings | ✅ Safe | Fetched by shopDomain from session |
| Prompt Definitions | ✅ Safe | Scoped by shopId with SYSTEM fallback |
| Shopper Data | ✅ Safe | Scoped by shopId + email |
| Composite Runs | ⚠️ At Risk | External API lacks shop validation |
| Usage Statistics | ⚠️ At Risk | api.diagnose exposes aggregate counts |

---

## 7. Recommendations

### Immediate Actions (Critical)

1. **Remove/Secure api.diagnose.jsx**
   ```diff
   - export const loader = async () => {
   + export const loader = async ({ request }) => {
   +   const { session } = await authenticate.admin(request);
   +   const { shopId } = await getShopFromSession(session, request);
   +   // Only return data for authenticated shop
   ```

2. **Add Tenant Authorization to External API**
   ```typescript
   // Add to external.v1.runs.$id.tsx
   const run = await getRunDetailExternal(runId, revealEnabled);
   if (!run || run.shopId !== authenticatedShopId) {
     return jsonError("not_found", 404, "Run not found");
   }
   ```

### Short-term Actions (High Priority)

3. **Implement API Key Scoping**
   - Store allowed shop IDs with each API key
   - Validate requested resources belong to allowed shops

4. **Add Rate Limiting to External API**
   - Currently only has global rate limiting
   - Add per-tenant rate limits

5. **Audit All External Endpoints**
   - Verify all endpoints check resource ownership
   - Add automated tests for cross-tenant access attempts

### Long-term Improvements (Medium Priority)

6. **Centralize Authorization Logic**
   - Create reusable `requireResourceAccess(resourceType, resourceId)` helper
   - Standardize across all route types

7. **Add Audit Logging**
   - Log all cross-tenant access attempts
   - Alert on suspicious patterns

8. **Implement API Versioning**
   - `/external/v2/` with proper tenant authorization
   - Deprecate v1 endpoints

---

## 8. Appendix: Files Audited

### Authentication & Authz Files
- [`app/app/services/external-auth/index.ts`](app/app/services/external-auth/index.ts:1)
- [`app/app/services/external-auth/types.ts`](app/app/services/external-auth/types.ts:1)
- [`app/app/utils/shop.server.ts`](app/app/utils/shop.server.ts:1)
- [`see-it-monitor/lib/auth.ts`](see-it-monitor/lib/auth.ts:1)
- [`see-it-monitor/lib/auth.types.ts`](see-it-monitor/lib/auth.types.ts:1)
- [`see-it-monitor/middleware.ts`](see-it-monitor/middleware.ts:1)
- [`see-it-monitor/lib/api-utils.ts`](see-it-monitor/lib/api-utils.ts:1)

### Route Files (Sample)
- [`app/app/routes/app._index.jsx`](app/app/routes/app._index.jsx:1)
- [`app/app/routes/app.products.jsx`](app/app/routes/app.products.jsx:1)
- [`app/app/routes/api.products.prepare.jsx`](app/app/routes/api.products.prepare.jsx:1)
- [`app/app/routes/api.diagnose.jsx`](app/app/routes/api.diagnose.jsx:1) ⚠️
- [`app/app/routes/external.v1.runs.$id.tsx`](app/app/routes/external.v1.runs.$id.tsx:1) ⚠️
- [`app/app/routes/external.v1.shops.$id.tsx`](app/app/routes/external.v1.shops.$id.tsx:1)
- [`app/app/routes/app-proxy.see-it-now.render.ts`](app/app/routes/app-proxy.see-it-now.render.ts:1)
- [`app/app/services/app-proxy.see-it-now.render.server.ts`](app/app/services/app-proxy.see-it-now.render.server.ts:1)
- [`see-it-monitor/app/api/shops/[shopId]/prompts/route.ts`](see-it-monitor/app/api/shops/[shopId]/prompts/route.ts:1)

### Service Files (Sample)
- [`app/app/services/monitor/queries.server.ts`](app/app/services/monitor/queries.server.ts:1)
- [`app/app/services/prompt-control/prompt-resolver.server.ts`](app/app/services/prompt-control/prompt-resolver.server.ts:1)

---

*End of Report*
