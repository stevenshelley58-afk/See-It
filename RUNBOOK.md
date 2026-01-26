# Runbook: See It Shopify App

## Deployment Architecture

- **Main App**: Railway (auto-deploys from GitHub)
- **Monitor Dashboard**: Vercel (auto-deploys from GitHub)
- **Database**: PostgreSQL on Railway
- **Local development is NOT supported**

## Environment Setup

### Railway (Main App)

Set these environment variables in Railway dashboard:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Railway provides this) |
| `SHOPIFY_API_KEY` | From Shopify Partner Dashboard |
| `SHOPIFY_API_SECRET` | From Shopify Partner Dashboard |
| `SHOPIFY_APP_URL` | `https://see-it-production.up.railway.app` |
| `GEMINI_API_KEY` | For AI compositing |
| `GOOGLE_CREDENTIALS_JSON` | Base64-encoded GCS service account |
| `GCS_BUCKET` | `see-it-room` |
| `IMAGE_SERVICE_BASE_URL` | Cloud Run image service URL |
| `IMAGE_SERVICE_TOKEN` | Shared secret for image service |

### Vercel (Monitor Dashboard)

Set these in Vercel project settings:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Same PostgreSQL connection as Railway |
| `DATABASE_PUBLIC_URL` | (Alternative) Railway public DB URL. If set without `DATABASE_URL`, the monitor build maps it to `DATABASE_URL` for Prisma generate. |
| `RAILWAY_API_URL` | `https://see-it-production.up.railway.app` |
| `MONITOR_API_TOKEN` | API token for auth |

## Deploying Changes

### Code Changes

1. Push to `main` branch
2. Railway and Vercel auto-deploy
3. Check Railway logs for any migration issues

### Database Migrations

Migrations run automatically on container start via `docker-start` script.

For manual migration:
```bash
# From Railway CLI (if installed)
railway run npx prisma migrate deploy
```

### Shopify App Config

To update webhooks, scopes, or app settings:
```bash
cd app
npm run deploy
```

## Verification

1. **Railway Dashboard**: Check deployment logs for errors
2. **Vercel Dashboard**: Check build logs
3. **Monitor Dashboard**: Visit https://see-it-monitor.vercel.app to verify health

## Troubleshooting

### Build Fails on Schema Sync

The build runs `check:consistency` which validates that `see-it-monitor/prisma/schema.prisma` is a subset of `app/prisma/schema.prisma`. If they're out of sync, update both schemas.

### Migration Errors

If migrations fail on deploy, check Railway logs. You may need to manually run migrations or reset the database if there's drift.
