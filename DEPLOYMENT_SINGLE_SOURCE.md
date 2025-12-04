# See It - Single Source of Truth

This document is the canonical reference for the See It Shopify app deployment.

## Canonical URLs

| Component | URL |
|-----------|-----|
| **App (Railway)** | `https://see-it-production.up.railway.app` |
| **Image Service (Cloud Run)** | `https://see-it-image-service-433767365876.us-central1.run.app` |
| **App Proxy** | `https://<store>.myshopify.com/apps/see-it/*` |

## Railway Project

- **Project ID**: `eb044abc-f17a-4747-aff8-5c5e79c42669`
- **Project Name**: `see-it-production`
- **Services**: `See-It`, `Postgres`
- **Environment**: `production`

## Shopify App

- **Client ID**: `404b1dcd8562143be56b2dd81dec2270`
- **Scopes**: `write_products,read_products`
- **API Version**: `2026-01`

## Required Environment Variables

| Variable | Value/Description |
|----------|-------------------|
| `DATABASE_URL` | Railway PostgreSQL internal URL |
| `SHOPIFY_API_KEY` | `404b1dcd8562143be56b2dd81dec2270` |
| `SHOPIFY_API_SECRET` | Shopify Partner Dashboard secret |
| `SHOPIFY_APP_URL` | `https://see-it-production.up.railway.app` |
| `SCOPES` | `write_products,read_products` |
| `IMAGE_SERVICE_BASE_URL` | `https://see-it-image-service-433767365876.us-central1.run.app` |
| `IMAGE_SERVICE_TOKEN` | Shared authentication token |
| `GCS_BUCKET` | `see-it-room` |
| `GOOGLE_CREDENTIALS_JSON` | Base64-encoded GCS service account |

## Deployment Sequence

1. **Make code changes** in this repository
2. **Push to `main` branch** on GitHub
3. **Railway auto-deploys** using root `Dockerfile`
4. **Run migrations** (if schema changed):
   ```bash
   railway run --service See-It npx prisma migrate deploy
   ```
5. **Verify** by visiting the app URL or checking Railway logs

## Key Files

| File | Purpose |
|------|---------|
| `/Dockerfile` | Production container build (Railway uses this) |
| `/railway.json` | Railway build configuration |
| `/shopify.app.toml` | Shopify app configuration |
| `/app/prisma/schema.prisma` | Database schema (PostgreSQL) |
| `/verify-config.js` | Configuration validation script |

## Image Service Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/product/prepare` | POST | Remove background from product |
| `/room/preload` | POST | Pre-upload room to Gemini |
| `/room/cleanup` | POST | Inpaint masked areas |
| `/scene/composite` | POST | Generate final render |

## DO NOT

- ❌ Run `npm run dev` or `docker-compose up`
- ❌ Use SQLite in production
- ❌ Run migrations on every container startup
- ❌ Use the old `see-it-image-service-876` URL
- ❌ Reference `app/Dockerfile` (use root Dockerfile)

## Verification

Run `node verify-config.js` to check configuration consistency.

