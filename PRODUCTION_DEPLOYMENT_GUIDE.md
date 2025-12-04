# Production Deployment Guide - See It App

## Deployment Architecture

| Component | Platform | URL |
|-----------|----------|-----|
| Main App | Railway | `https://see-it-production.up.railway.app` |
| Database | Railway PostgreSQL | `postgres.railway.internal:5432` |
| Image Service | Google Cloud Run | `https://see-it-image-service-433767365876.us-central1.run.app` |
| Storage | Google Cloud Storage | `see-it-room` bucket |

## Deployment Process

### 1. Push Code Changes

```bash
git add .
git commit -m "your changes"
git push origin main
```

Railway automatically deploys from the `main` branch.

### 2. Monitor Deployment

Check Railway dashboard or:

```bash
railway logs --service See-It
```

### 3. Run Migrations (if schema changed)

```bash
railway run --service See-It npx prisma migrate deploy
```

## Required Environment Variables

Set these in Railway dashboard for the See-It service:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Railway provides this) |
| `SHOPIFY_API_KEY` | From Shopify Partner Dashboard |
| `SHOPIFY_API_SECRET` | From Shopify Partner Dashboard |
| `SHOPIFY_APP_URL` | `https://see-it-production.up.railway.app` |
| `SCOPES` | `write_products,read_products` |
| `IMAGE_SERVICE_BASE_URL` | Cloud Run URL |
| `IMAGE_SERVICE_TOKEN` | Shared secret for auth |
| `GCS_BUCKET` | `see-it-room` |
| `GOOGLE_CREDENTIALS_JSON` | Base64-encoded service account JSON |

## Shopify Configuration

### Partner Dashboard Settings

1. **App URL**: `https://see-it-production.up.railway.app`
2. **Redirect URL**: `https://see-it-production.up.railway.app/auth/callback`
3. **App Proxy**:
   - Subpath prefix: `apps`
   - Subpath: `see-it`
   - Proxy URL: `https://see-it-production.up.railway.app/app-proxy`

### Theme Extension Deployment

```bash
cd app
npx shopify app deploy
```

## Webhook Handlers

The app registers these webhooks automatically:

| Webhook | Handler |
|---------|---------|
| `APP_INSTALLED` | `webhooks.app.installed.jsx` |
| `APP_UNINSTALLED` | `webhooks.app.uninstalled.jsx` |
| `APP_SCOPES_UPDATE` | `webhooks.app.scopes_update.jsx` |
| `PRODUCTS_UPDATE` | `webhooks.products.update.jsx` |

## Health Checks

- **App**: Visit `https://see-it-production.up.railway.app`
- **Image Service**: Visit `https://see-it-image-service-433767365876.us-central1.run.app/health`

## Troubleshooting

### Service Not Starting

1. Check Railway deployment logs
2. Verify `DATABASE_URL` is set correctly
3. Ensure Postgres service is running in Railway project

### Database Connection Errors

- Internal URL (`postgres.railway.internal`) only works within Railway
- Public URL (`maglev.proxy.rlwy.net:21199`) works from external tools

### OAuth Errors

1. Verify Partner Dashboard URLs match `shopify.app.toml`
2. Reinstall app on dev store to refresh sessions
3. Check `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`

### Image Service Errors

1. Check Cloud Run logs in Google Cloud Console
2. Verify `IMAGE_SERVICE_TOKEN` matches on both sides
3. Test with `node scripts/test-image-service-connection.js`
