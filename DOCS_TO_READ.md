# See It App – Documentation Map

This file lists the **must‑read** docs for anyone working on the See It app, and the external references they depend on.

---

## 1. Internal Project Docs

These live in this repo and are the primary specs. Always check these first before changing code.

- Canonical spec & contracts (single source of truth)
  - `/docs/see-it/spec.md`
  - `/docs/see-it/contracts/frontend.md`
  - `/docs/see-it/contracts/backend.md`
  - `/docs/see-it/contracts/db.md`
- Flows & pipelines
  - `FLOWS.md` (flow definitions like F1: prep, F2: storefront, F9: cleanup + render)
- Implementation state & lessons
  - `IMPLEMENTATION_SUMMARY.md` (what’s actually implemented)
  - `SEE_IT_CURRENT_ISSUES.md` (historical issues – use as reference, not future spec)
  - `GRAVEYARD_LESSONS.md` (if present – summarizes “what not to do again”)
- Running & deployment
  - `RUNBOOK.md` (local setup and dev flow)
  - `NEXT_STEPS.md` (end‑to‑end flows to test)
  - `DEPLOYMENT.md` (Railway + Docker deployment)
  - `RAILWAY_ENV_VARS.md` (required env vars)
  - `PRISMA_OPENSSL_FIX.md` (historic context – deployment now uses Dockerfile)
- Background APIs & models
  - `app/docs/GEMINI_MODELS_REFERENCE.md`
  - `app/docs/BACKGROUND_REMOVAL_NOTES.md` (if present)
- Shopify theme extension
  - `extensions/see-it-extension/README.md`
  - `extensions/see-it-extension/blocks/see-it-button.liquid`
  - `extensions/see-it-extension/assets/see-it-modal.js`
  - `extensions/see-it-extension/assets/see-it-modal.css`

When in doubt, treat `/docs/see-it/spec.md` and `/docs/see-it/contracts/*` as the source of truth, and update them if code behavior changes intentionally.

---

## 2. Shopify Docs

Core references for how the app integrates with Shopify.

- App development overview  
  https://shopify.dev/docs/apps

- Admin GraphQL API (products, images, metafields)  
  https://shopify.dev/docs/api/admin-graphql

- App proxies (used by `/app-proxy/*` routes)  
  https://shopify.dev/docs/apps/online-store/app-proxies

- Theme app extensions (PDP block + modal)  
  https://shopify.dev/docs/apps/online-store/theme-app-extensions

- Webhooks (install/uninstall, products/update, GDPR)  
  https://shopify.dev/docs/apps/webhooks

- Billing API (plans, charges, upgrades)  
  https://shopify.dev/docs/apps/billing

- Shopify App Store requirements & review guidelines  
  https://shopify.dev/docs/apps/store/requirements

Before touching auth, webhooks, billing, or app proxy routes, review the relevant Shopify docs above.

---

## 3. Background Removal / Image APIs

You should only need **one** external background‑removal provider at a time. These are examples:

- PhotoRoom API (background removal & segmentation)  
  https://www.photoroom.com/api

- Remove.bg API  
  https://www.remove.bg/api

Pick a single provider, wire it into `app/app/services/bg-removal.external.server.ts`, and follow its docs for:

- Authentication (API keys / headers)
- Request shapes (image URL vs upload)
- Error codes and rate limits

---

## 4. Google Cloud Storage (Uploads, Signed URLs, CORS)

The app currently uses GCS for room images, prepared assets, and composites.

- Signed URLs (V4)  
  https://cloud.google.com/storage/docs/access-control/signed-urls

- CORS configuration for browser uploads  
  https://cloud.google.com/storage/docs/configuring-cors

When changing `StorageService` or presigned upload flows:

- Ensure CORS is configured on the bucket (see `gcs-cors.json` and `DEPLOYMENT.md`).  
- Prefer storing **object keys** in the DB and re‑signing URLs on read.

---

## 5. Gemini / Image Generation

Gemini is used for composite polishing.

- Gemini API docs (image generation & multimodal)  
  https://ai.google.dev

Check:

- Supported models and image response formats.  
- Error handling and rate limits.  
- Any recommendations on retries / backoff.

All Gemini calls should go through `app/app/services/gemini.server.ts`.

---

## 6. Backend Stack & Infra

### Prisma + Postgres

- Prisma docs (schema, client, migrations)  
  https://www.prisma.io/docs

Always keep `app/prisma/schema.prisma` and migrations in sync with `/docs/see-it/spec.md` and `/docs/see-it/contracts/db.md`.

### Remix

- Remix framework docs (routes, loaders, actions)  
  https://remix.run/docs

Routes in `app/app/routes/*` should follow Remix best practices: thin routes, domain + services doing the heavy lifting.

### Railway (or your hosting platform)

- Railway docs (deploying Docker images, env vars, logs)  
  https://docs.railway.app

Use these docs alongside `DEPLOYMENT.md` to keep the production deploy pipeline healthy and predictable.

---

## 7. Frontend / Theme

Theme extension and Liquid behavior are governed by Shopify’s theme docs:

- Theme app extensions & blocks (structure, assets, locales)  
  https://shopify.dev/docs/apps/online-store/theme-app-extensions

Use this whenever you change:

- `app/extensions/see-it-extension/blocks/see-it-button.liquid`
- `app/extensions/see-it-extension/assets/see-it-modal.js`
- `app/extensions/see-it-extension/assets/see-it-modal.css`

---

## 8. Operational & Observability Tools

If/when you add third‑party monitoring/logging, link their docs here too (for example: Sentry, Datadog, Logtail, etc.).

- Example placeholders (update if you adopt these):
  - Sentry for Node.js: https://docs.sentry.io/platforms/node/
  - Datadog APM for Node.js: https://docs.datadoghq.com/tracing/trace_collection/automatic_instrumentation/nodejs/

These become relevant when you wire structured logs and error reporting into `logger.server.ts` and your Remix routes.

