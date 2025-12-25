# See It — Shopify App Store Rebuild Execution Plan (Most Detailed, Step-by-Step)

This is the **do-this-next** document. It assumes the decisions in `docs/SHOPIFY_REBUILD_BLUEPRINT.md`:

- No email capture / no server-side saved rooms (for now)
- Full Products grid in Admin
- Rebuild on Shopify’s **React Router v7** template

---

## 1) Non-negotiable “Shopify approval” constraints (pin this)

### 1.1 Storefront (theme extension)

- **No external assets**: no Google Fonts, no third-party CDNs, no external script tags.
- **No debug spam**: storefront JS must not spam `console.log` in production.
- **No broken signed URLs**: never append query params to signed URLs. Cache busting must be done by:
  - generating a new signed URL server-side, or
  - using a new object key, or
  - setting proper `Cache-Control` headers + unique URLs.

### 1.2 Admin (embedded app)

- **No `window.location` navigation** inside embedded admin pages. Use Shopify App Bridge navigation/redirect utilities.
- Avoid iframe pitfalls: always use Shopify’s recommended redirect patterns when auth/session needs top-level navigation.

### 1.3 Privacy scope (simplify)

- If we’re “trying to get listed”, remove features that create privacy obligations:
  - email capture
  - saved rooms stored server-side
  - customer PII in logs

---

## 2) New repo baseline (clean rebuild from template)

### 2.1 Create a new app (separate folder/branch)

**Goal:** you get a working Shopify embedded app *before* porting anything.

**Actions:**

- Create a new repo folder (or a new branch + new `app/` directory).
- Initialize via Shopify CLI using the **React Router** template.
- Confirm it runs locally with `shopify app dev`.

**Acceptance tests (must pass before moving on):**

- Install app on a dev store.
- App loads inside Admin, no auth loop.
- Refresh inside Admin works.

### 2.2 Environment setup (dev/staging/prod)

Create a single environment checklist and keep it identical across envs:

- **Required env vars**
  - `SHOPIFY_API_KEY`
  - `SHOPIFY_API_SECRET`
  - `SCOPES`
  - `SHOPIFY_APP_URL`
  - `DATABASE_URL`
  - `GEMINI_API_KEY` (required for core render/cleanup)
  - `GOOGLE_CREDENTIALS_JSON` or equivalent (for GCS)
  - `GCS_BUCKET`
  - `SHOPIFY_BILLING_TEST_MODE` (true in dev/staging, false in prod)

**Acceptance tests:**

- `npm ci` works (deterministic installs)
- `npm run build` works
- `npm test` runs (even if minimal tests at first)

---

## 3) Port the “domain modules” first (no UI yet)

### 3.1 Define module boundaries (target)

Create these modules (names illustrative; keep them small and testable):

- **Shopify platform**
  - `auth/` (authenticate helpers)
  - `billing/` (plan config + billing operations)
  - `webhooks/` (handlers, topic routing, idempotency)
- **Render pipeline**
  - `storage/` (GCS client + signed URL generation)
  - `bg-remove/` (background removal abstraction)
  - `composite/` (final render/composite)
- **Domain**
  - `shops/` (ensure shop record exists)
  - `product-assets/` (prepare + status + keys)
  - `room-sessions/` (start/upload/confirm/cleanup)
  - `room-sessions/` (start/upload/confirm)
  - `render-jobs/` (create/poll/cancel)
- **Cross-cutting**
  - `logging/` (structured logger)
  - `validation/` (Zod or similar; request size checks; SSRF checks)

**Rules:**

- Routes do parsing + auth + call domain service.
- Domain services never read `process.env` directly except centralized config modules.

### 3.2 Database: keep only what you need to get listed

Since we’re dropping saved rooms/email capture, remove or postpone:

- `SavedRoomOwner`
- `SavedRoom`

**If you keep them temporarily in DB** (not recommended): you must build privacy tooling. Don’t.

**Acceptance tests:**

- Prisma migrate from scratch works in dev.
- Schema supports the core flows: prepare, room session, render jobs, quota.

---

## 4) Rebuild Admin UI (preserve your UI/UX, but do it “Shopify-native”)

### 4.1 Navigation and page structure

**Must-have pages:**

- `/app` Dashboard
- `/app/products` Products (full grid/list)
- `/app/billing` Billing
- `/app/settings` Settings
- `/app/support` Support (contact + troubleshooting) (helps review)

**Embedded navigation requirement:**

- Use App Bridge navigation/redirect utilities; no `window.location`.

### 4.2 Products page (recommended full build)

**Core UX you need:**

- Product list:
  - title, featured image, status badge (Not prepared / Preparing / Ready / Failed / Stale)
  - “Prepare” (choose image)
  - “Re-prepare”
  - “Manual adjust”
  - “View last error”
- Bulk actions:
  - Bulk prepare selected
  - Bulk mark stale / refresh
- Filtering:
  - All / Ready / Needs attention / Failed

**Implementation details:**

- Prefer GraphQL pagination (cursor-based).
- Cache product list server-side if needed, but avoid stale UI.
- Store only keys in DB; re-sign URLs for display.

**Acceptance tests:**

- A merchant can prepare a product and see “Ready”.
- A merchant can retry a failed prepare.
- A merchant can choose alternate product image.

---

## 5) Rebuild Theme Extension (preserve exact modal UX, but make it review-friendly)

### 5.1 Asset budgets (practical target)

Define budgets that you can measure:

- `see-it-modal.js`: keep as small as possible; lazy-load heavier code after click.
- `see-it-modal.css`: no external imports; prefer system fonts or theme fonts.

### 5.2 Remove saved rooms/email capture flow

In the modal:

- Remove “Saved Photo / Saved Rooms” entry points **or** make them client-only (localStorage).
- Remove `identifyShopper`, `X-Shopper-Token`, and any backend endpoints for that.

### 5.3 App proxy calls

Your extension should only call your own endpoints via app proxy, for example:

- `POST /apps/see-it/room/upload`
- `POST /apps/see-it/room/confirm`
- `POST /apps/see-it/room/cleanup`
- `GET /apps/see-it/product/prepared?product_id=...`
- `POST /apps/see-it/render`
- `GET /apps/see-it/render/:jobId`

**Hard requirements:**

- Validate payload sizes (mask data URL limits).
- Don’t modify signed URLs.

**Acceptance tests:**

- Modal flow works on Dawn.
- Upload works on mobile Safari and Chrome.
- Render completes and image displays reliably (no cache bugs).

---

## 6) Logging & “no slop” policy

### 6.1 Server logging

- Use a structured logger (already exists in your current codebase — keep the pattern).
- Never log:
  - raw webhook payloads
  - customer emails
  - access tokens
  - full signed URLs (log only prefixes/keys)

### 6.2 Client logging

- Theme extension should have **dev-only logging** behind a flag:
  - `window.__SEE_IT_DEBUG__ = true`
  - or a theme setting that only exists in dev.

---

## 7) Shopify submission pack (do this early)

Shopify review is smoother if you prepare these while building:

- **Demo video script**:
  - install → onboarding → add block → prepare product → storefront usage → uninstall
- **Reviewer instructions**:
  - “Install app”
  - “Go to Products → Prepare”
  - “Open a product page → click See It → complete flow”
- **Test store**: a dev store with sample products and the block already available.
- **Support contact**: email + response window.
- **Privacy policy**: must match what the app actually does (especially now that we’re removing email capture).

---

## 8) Immediate “first rebuild sprint” checklist (1–2 days)

This is the smallest slice that proves you can build cleanly:

- New template runs, installs, and loads embedded.
- Implement `/healthz`.
- Implement webhooks with safe logging (no PII).
- Implement `/app/products` skeleton with GraphQL list + status placeholders.
- Implement theme extension skeleton with button + “Hello modal”.

Once that works, start porting the real modal UX.


