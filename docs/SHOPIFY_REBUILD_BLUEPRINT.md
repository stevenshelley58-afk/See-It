# See It — Shopify App Store Rebuild Blueprint (Clean, Review-Ready)

**Audience:** You (building), future contractors, and “Shopify reviewer mindset” checks  
**Goal:** Rebuild the app cleanly while preserving your **exact UI/UX**, and satisfy Shopify App Store requirements with minimal review friction.

> Important repository rule: AI model names are **LOCKED**. Do not rename Gemini/Imagen models in service code. Model config must remain the single source of truth:
> - `app/app/config/ai-models.config.ts`
> - `image-service/ai-models.config.js`

---

## Decisions locked in (based on your answers)

- **No email capture / saved rooms for now**: we will remove this feature from the rebuild to reduce moving parts and Shopify review surface area.
- **Products admin UI**: we will build the **full recommended grid/list** with per-product status + actions.
- **Framework**: use Shopify’s **React Router v7 app template** (lowest-risk path to approval; your UI/UX can remain the same).

---

## 0) What Shopify typically rejects as “slop” (and what we saw here)

Shopify reviewers are mostly allergic to:

- **Unfinished or dead-end UX**: screens that exist but don’t work, stubs, placeholder flows, “Product listing removed”, broken navigation in embedded context.
- **Noisy/unsafe logs**: `console.log` spam, logging PII, logging secrets, logging raw payloads.
- **Performance regression on storefront**: large JS/CSS injected into themes, external font imports, heavy work on main thread, unbounded polling.
- **Inconsistent configuration**: mismatched API versions between `shopify.app.toml`, app code, and extension config; missing deterministic builds; missing staging.
- **Privacy/compliance gaps**: collecting personal data (emails) without clear consent, unclear retention, missing deletion/export flows, misleading GDPR webhook responses.
- **Security gaps**: permissive CORS, weak request validation/size limits, SSRF risks, token leakage.

This blueprint is designed to eliminate all of the above with an explicit spec, architecture, and acceptance tests.

---

## 1) Source Shopify docs to anchor the rebuild (use these as “requirements”)

Use these Shopify pages as your “contract” during rebuild:

- **App Store requirements**: `https://shopify.dev/docs/apps/store/requirements`
- **App review / launch** (submission, credentials, demo video, etc.): `https://shopify.dev/docs/apps/launch`
- **Auth**: `https://shopify.dev/docs/apps/auth`
- **Billing**: `https://shopify.dev/docs/apps/billing`
- **Webhooks**: `https://shopify.dev/docs/apps/webhooks`
- **App proxies**: `https://shopify.dev/docs/apps/online-store/app-proxies`
- **Theme app extensions**: `https://shopify.dev/docs/apps/online-store/theme-app-extensions`
- **App design / Polaris**: `https://shopify.dev/docs/apps/design` and `https://polaris.shopify.com/`
- **Performance best practices**: `https://shopify.dev/docs/apps/build/performance/general-best-practices`

**How to use these during rebuild:** every feature below includes an “Acceptance Criteria” section that maps back to these requirements.

---

## 2) Rebuild strategy (what “full rebuild” should mean)

### Recommended approach

Build a **new clean app** from Shopify’s latest official template, then port your UI/UX + business logic as modules.

- **Why:** Shopify’s templates encode lots of “gotchas” (embedded navigation, auth headers, session token strategy, and Remix/React Router integration). Rebuilding on the template reduces the review risk dramatically.
- **What gets ported:** theme extension UI/UX, image pipeline services, DB schema, and the business flows.

### Target stack (chosen)

- **Shopify App Template — React Router (v7)**  
  Shopify’s current recommendation for new builds. We’ll port your UI components and page layouts so the UI/UX stays the same.

---

## 3) High-level product spec (keep your UI/UX, clean implementation)

### Merchant (Admin) experience — requirements

- **Install → immediate success**: after install, merchant lands on a working dashboard and can complete setup in <5 minutes.
- **Clear setup checklist**:
  - Add theme app extension block / app embed (if required)
  - Pick products to enable (or auto-enable)
  - Prepare product images (bg remove) status clearly displayed
  - Verify storefront “See It” button appears
- **Billing**:
  - Free and Pro plan (already present).
  - Upgrade/downgrade without confusing states.
- **Analytics**:
  - Clear value, accurate counts, no placeholder “0” features unless hidden behind “Coming soon”.
- **Settings**:
  - Toggle lead capture + retention policy + deletion tools (if you collect email)
  - Style options for the storefront widget

### Shopper (Storefront) experience — requirements

Your current modal UX is strong; preserve it. But implement it in a Shopify-compliant way:

- **PDP button opens modal** with 4-step flow:
  1) Entry (camera/upload/saved rooms)
  2) Prepare room (mask/erase optional)
  3) Position product (drag/resize)
  4) Result (share/save/new)
- **Performance**:
  - Minimal script payload
  - No external fonts or third-party calls from storefront JS
  - Always handle errors gracefully (expired sessions, quota, network)

---

## 4) “Shopify compliance spec” (what must be true to pass review)

### 4.1 Auth & embedded behavior

**Rules:**

- All admin routes require `authenticate.admin(request)` and must use Shopify’s embedded redirect helpers (avoid `window.location` for navigation inside iframe).
- Ensure “top level redirection” works when Shopify requires escaping the iframe.
- Avoid storing unnecessary access tokens outside Shopify’s session storage.

**Current review risk we saw:**

- Embedded pages use `window.location.href`/`window.location.reload` (can break embedded session + iframe constraints).

**Rebuild requirement:**

- Use App Bridge navigation utilities (or Shopify’s helper patterns) for admin navigation.
- Replace “open theme editor” actions with App Bridge redirect to admin paths.

### 4.2 Billing

**Rules:**

- Billing must not be hardcoded to test mode in production.
- Your billing callback must be robust (idempotent, handles missing shop record).
- UI must clearly reflect plan and quota.

**Current note:**

- Billing test mode is already env-controlled in `api.billing.jsx`, but logs are still noisy in callback.

### 4.3 Webhooks + GDPR

**Rules:**

- Implement/declare required GDPR topics (customers/data_request, customers/redact, shop/redact) and app/uninstalled handling.
- Do not log personal data (customer email) in webhook logs.
- If you store shopper data, be honest about it and implement deletion on request.

**Current review risk we saw:**

- `webhooks.jsx` logs customer email and customer id.
- The code claims “no customer-specific data stored” while the app stores shopper emails in `SavedRoomOwner`. That mismatch is review-risk.

**Rebuild decision:**

- We will **not store shopper emails** and will remove any “saved rooms tied to email” workflow from the storefront.

### 4.4 Storefront performance + deceptive code

**Rules:**

- Theme extension assets must be lean; avoid huge JS/CSS.
- Avoid external font imports and external script loads.
- No obfuscation, no hidden tracking, no surprise data exfiltration.

**Current review risk we saw:**

- Theme extension CSS imports Google Fonts (`fonts.googleapis.com`).
- Theme extension JS contains extensive debug logs and is likely very large.

### 4.5 Security basics

**Rules:**

- Validate inbound inputs (IDs, sizes, URLs), especially app-proxy endpoints.
- Request size limits for JSON payloads.
- CORS restricted to the correct shop domain.
- SSRF protection for any server-side fetches (you already have a whitelist helper).

---

## 5) Architecture spec (how to rebuild cleanly)

### 5.1 Repo layout (target state)

Keep “thin routes, fat services”:

- `app/app/routes/*`  
  - only request parsing, auth, and calling domain services
- `app/app/services/*`  
  - “business logic” and integrations (GCS, Gemini, bg remove, etc.)
- `app/app/utils/*`  
  - cross-cutting: logger, request IDs, validation, configuration helpers
- `app/prisma/*`  
  - schema + migrations committed, deterministic deploys
- `app/extensions/*`  
  - theme extension with performance budgets and no external imports

### 5.2 Configuration single sources of truth

**Required invariants:**

- API versions are defined once and reused (no mismatches across `shopify.app.toml`, server code, extension toml).
- AI model names only come from the two locked config files.
- Billing test mode comes from env: `SHOPIFY_BILLING_TEST_MODE` (default safe for dev, explicit for prod).

### 5.3 Data model spec (privacy-aware)

Current schema includes:

- `Shop` (merchant install record)
- `Session` (Shopify session storage via Prisma adapter)
- `ProductAsset` (prepared images and metadata)
- `RoomSession`, `RenderJob`, `UsageDaily`
- `SavedRoomOwner` + `SavedRoom` (stores shopper email + saved rooms) **(to be removed from rebuild for now)**

**Rebuild decision (chosen):**

- **Remove shopper email storage entirely**
  - No “Saved Rooms” feature that requires backend persistence.
  - If you want “Saved Rooms” later, we can re-add it either:
    - client-side only (local storage), or
    - server-side with a full privacy program (consent, retention, deletion tools).

---

## 6) Detailed implementation plan (step-by-step rebuild)

### Phase 0 — Project reset (day 0–1)

- Create a new app from the official Shopify template (React Router template preferred).
- Add your repo docs (`/docs/see-it/*`) and define the new “single source” spec file.
- Set up environments: **dev**, **staging**, **production** (Shopify reviewers love reliable staging).

**Acceptance criteria:**

- Fresh template installs and loads inside Shopify Admin.
- Auth flow works with no loops.
- You can run `npm ci`, `npm run build`, `npm test` deterministically.

### Phase 1 — Core platform plumbing (day 1–3)

**Goal:** foundational Shopify correctness.

- Auth/session:
  - Ensure `authenticate.admin` for all admin routes.
  - Ensure app proxy uses `authenticate.public.appProxy`.
  - Remove any `window.location` navigation from embedded admin. Use App Bridge redirect.
- Webhooks:
  - Ensure required GDPR webhooks are declared and routed.
  - Ensure app/uninstalled is handled and idempotent.
  - Remove PII from logs.
- Configuration:
  - Align API versions across:
    - `app/shopify.app.toml`
    - server `ApiVersion.*`
    - `extensions/*/shopify.extension.toml`

**Acceptance criteria:**

- Install, reload, uninstall/reinstall flows are solid.
- Webhook delivery succeeds (200) and handlers are idempotent.

### Phase 2 — Rebuild the Admin UI (day 3–7)

**Goal:** keep your exact dashboard/settings UX but implement Shopify-native navigation and error boundaries.

- Dashboard (`/app`):
  - No placeholder metrics unless hidden behind “Coming soon”.
  - Remove fragile “theme editor URL” construction; use App Bridge.
- Products (`/app/products`):
  - Restore a real product management UI (current “Product listing removed” is review-risk).
  - Must support:
    - list products
    - show prepare status
    - choose image for prepare
    - manual segmentation workflow
- Settings (`/app/settings`):
  - Make lead-capture toggle real (if keeping it) and backed by DB.
  - Add “privacy” section:
    - data retention
    - delete shopper data (if applicable)

**Acceptance criteria:**

- A merchant can complete setup without reading a README.
- All admin routes work within the embedded iframe without broken navigation.

### Phase 3 — Rebuild the Theme Extension cleanly (day 5–10)

**Goal:** preserve your modal UX exactly, but deliver it as a review-friendly theme extension.

**Rules to follow:**

- Remove external font imports (no `fonts.googleapis.com`).
- Remove debug console logs (use a dev-only flag if needed).
- Reduce JS size aggressively:
  - Split code into small modules if Shopify packaging allows.
  - Lazy-load heavy steps only when the modal opens.
- Ensure *signed URLs are never modified* (do not append cache-busters to signed URLs).
  - If you need cache busting, generate new signed URLs server-side, or change object keys.

**Acceptance criteria:**

- Modal works on Dawn and at least one popular theme.
- Lighthouse on PDP doesn’t tank due to extension assets.

### Phase 4 — Image pipeline hardening (day 7–14)

**Goal:** stable, predictable image prep and render.

- Background removal:
  - Keep using `@imgly/background-removal-node` if install/build is stable in your CI/CD environment.
  - If `onnxruntime-node` install is flaky in your hosting, move bg removal to a separate service with controlled build.
- Storage:
  - Store **object keys** in DB, not long-lived signed URLs.
  - Always re-sign on read, with consistent TTL policies.
- Quotas:
  - Ensure quota enforcement is atomic (already mostly implemented).

**Acceptance criteria:**

- Prep and render succeed under retries, and failures are visible and actionable in admin UI.

### Phase 5 — Testing + submission readiness (day 10–18)

- Add automated tests:
  - Auth smoke tests
  - Webhook signature verification tests
  - Billing flow tests (test mode and prod-mode flag behavior)
  - App proxy request validation tests
- Add operational readiness:
  - `/healthz` includes DB, storage, and dependency checks
  - Structured logging only (no raw payload dumps)

**Submission pack:**

- Demo video that matches listing claims
- Clear test credentials + steps
- Privacy policy and data handling disclosures
- Support contact and response-time promise

---

## 7) “Definition of Done” checklist (what must be true before submission)

### Shopify review checklist (minimum)

- **Auth**
  - Embedded navigation works; no blank screens or loops.
  - Reinstall works cleanly.
- **UX**
  - No dead pages, no placeholder flows in primary navigation.
  - Clear onboarding/setup.
- **Performance**
  - Theme extension assets are lean; no external fonts; no debug logs.
- **Security**
  - Input validation + request size limits for app-proxy endpoints.
  - CORS locked to shop domain.
  - SSRF protections for server fetches.
- **Privacy**
  - If you store shopper emails: consent + retention + deletion/export implemented.
  - GDPR webhooks do not misrepresent stored data.
- **Ops**
  - Deterministic builds (`npm ci`) and migrations strategy is documented.

---

## 8) Targeted “codebase findings” to fix in the rebuild (examples)

These are concrete patterns to remove during rebuild:

- **Admin embedded navigation via `window.location`** (replace with App Bridge redirect/navigation).
- **Theme extension loads Google Fonts** (`@import url('https://fonts.googleapis.com/...')`) — remove.
- **Theme extension adds query params to signed URLs** (breaks signatures) — remove.
- **Console log spam** across routes and extension — replace with structured logger server-side, and dev-only logs client-side.
- **Mismatched API versions** between:
  - `app/shopify.app.toml` (currently `2025-10`)
  - `app/app/shopify.server.js` (currently `ApiVersion.January25`)
  - `app/extensions/.../shopify.extension.toml` (currently `2024-01`)
- **Duplicate shop creation logic** in multiple loaders — centralize into a single `ensureShop()` service.
- **Storing access tokens in `Shop`** — evaluate whether you can remove this and rely on session storage only.

---

## 9) Next document to follow

This blueprint is the “why + what”. For the ultra-detailed “how”, follow:

- `docs/SHOPIFY_REBUILD_EXECUTION_PLAN.md`


