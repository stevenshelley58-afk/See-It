# Pre-Audit Snapshot

**Date:** 2025-12-06  
**Git Tag:** `pre-audit`

## System Map

```
┌─────────────────────────────────────┐
│  Shopify Embedded Admin App        │
│  (Remix)                           │
│  - /app/products                   │
│  - /api/products/prepare           │
└──────────────┬──────────────────────┘
               │
               │ HTTP POST
               ▼
┌─────────────────────────────────────┐
│  Prepare Processor                  │
│  (inside same app, triggered via    │
│   route + timer)                    │
│  - prepare-processor.server.ts      │
│  - gemini.server.ts                 │
└──────────────┬──────────────────────┘
               │
               │ Pipeline:
               │ 1. Fetch from Shopify CDN
               │ 2. Convert to PNG (sharp)
               │ 3. Background removal (@imgly)
               │ 4. Upload to GCS
               │ 5. Update Prisma
               ▼
┌─────────────────────────────────────┐
│  GCS Bucket: see-it-room            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Postgres on Railway                │
│  - ProductAsset                     │
│  - Shop                             │
│  - RenderJob                        │
└─────────────────────────────────────┘
```

## Main Flows

**F1: Product list → click Prepare → product asset prepared**
- Admin UI calls `/api/products/prepare`
- Creates/updates ProductAsset with status="pending"
- prepare-processor picks up pending assets
- Pipeline: fetch → convert → bg-remove → upload → DB update
- Status set to "ready" or "failed"

**F2: Prepared asset consumed by "See it in your room" modal on storefront**
- Storefront extension requests prepared image
- `/app-proxy/product.prepared` endpoint serves it
- Used in render flows

## Prisma Schema State

**Location:** `app/prisma/schema.prisma`

**ProductAsset Model:**
- ✅ Has: id, shopId, productId, variantId, sourceImageId, sourceImageUrl, preparedImageUrl, status, prepStrategy, promptVersion, createdAt, updatedAt
- ❌ Missing: `errorMessage` field (but code may try to write to it)

**RenderJob Model:**
- ✅ Has: errorMessage field (line 107)

**Migrations:**
- Single migration: `20251203135621_init`
- No errorMessage column in product_assets table

## Railway Configuration

**Dockerfile:**
- Build: `npm run build` + `prisma generate`
- Start: `npm run docker-start` → `npm run setup && npm run start`

**package.json scripts:**
- `setup`: `prisma generate && prisma migrate resolve --applied 20251203135621_init || true && prisma migrate deploy`
- `start`: `remix-serve ./build/server/index.js`
- `docker-start`: `npm run setup && npm run start`

**Issue:** Migration resolution runs on every container start, causing P3008 noise.

## Current Issues Identified

1. **Schema Drift:** Code may try to write `errorMessage` to ProductAsset, but schema doesn't have it
2. **Noise in Logs:** Ad-hoc `[Gemini]` and `[Prepare]` logs without structured fields
3. **Missing Error Boundaries:** Errors can bubble as 500s without proper handling
4. **No Request ID Tracking:** Hard to trace requests through logs
5. **Migration Resolution on Boot:** Runs every container start
6. **No Health Check Endpoint:** Can't verify app readiness
7. **No Idempotency Checks:** May re-process assets unnecessarily

## Next Steps

See implementation plan for:
- Structured logging with requestId
- Schema reconciliation
- Pipeline hardening
- Auth tightening
- Runtime stability
- UI alignment
- Test harness
