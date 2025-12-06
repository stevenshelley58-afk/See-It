# See It - Deployment Guide

## Railway Production Deployment

### Prerequisites

1. **Railway Account** with project: `see-it-production`
2. **PostgreSQL Database** provisioned on Railway
3. **Environment Variables** configured (see below)

### Required Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...  # Auto-provided by Railway Postgres

# Shopify
SHOPIFY_API_KEY=<your-api-key>
SHOPIFY_API_SECRET=<your-api-secret>
SHOPIFY_APP_URL=<your-railway-url>
SCOPES=read_products,write_products,read_files,write_files

# Google Cloud (for GCS storage and Gemini AI)
GOOGLE_CREDENTIALS_JSON=<base64-encoded-json>
GCS_BUCKET=see-it-room
GEMINI_API_KEY=<your-gemini-api-key>

# Optional
NODE_ENV=production
DISABLE_PREPARE_PROCESSOR=false  # Set to true to disable background processor
```

---

## Deployment Process

### 1. Run Database Migrations (BEFORE deploying code)

**Critical:** Migrations must be run manually BEFORE code deployment to avoid runtime errors.

```bash
# Connect to Railway project
railway link

# Run pending migrations
railway run npm run migrate --dir app

# Or via Railway CLI:
railway run --service see-it-production "cd app && npx prisma migrate deploy"
```

**Verify Migration Status:**
```bash
railway run "cd app && npx prisma migrate status"
```

---

### 2. Deploy Code to Railway

Railway auto-deploys on git push to `main` branch:

```bash
git push origin main
```

**Or manual deploy:**
```bash
railway up
```

---

### 3. Monitor Deployment

**Watch build logs:**
```bash
railway logs --tail
```

**Check health endpoint after deployment:**
```bash
curl https://your-app.railway.app/healthz
```

Expected response:
```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "storage": "ok"
  },
  "timestamp": "2025-12-06T08:30:00.000Z"
}
```

---

## Build Process

The Dockerfile follows this sequence:

1. **Install system dependencies** (libvips for Sharp, OpenSSL for Prisma)
2. **Copy package.json** and optional `.npmrc`, `package-lock.json`
3. **Install npm dependencies:**
   - If `package-lock.json` exists: `npm ci` (deterministic)
   - Otherwise: `npm install` (non-deterministic, slower)
4. **Copy application source**
5. **Generate Prisma client** (`npx prisma generate`)
6. **Build Remix app** (`npm run build`)
7. **Prune devDependencies** (`npm prune --omit=dev`)
8. **Runtime:** Start server via `npm run docker-start`

---

## Common Issues & Solutions

### Issue: "Shop not found in database"

**Symptom:** App proxy routes return 404 errors
**Cause:** Shop record missing from database (app not installed properly)
**Fix:**
1. Reinstall the app from Shopify admin
2. Check `webhooks.app.installed.jsx` executed successfully
3. Verify shop created in database:
   ```bash
   railway run "cd app && npx prisma studio"
   ```

### Issue: "GEMINI_API_KEY environment variable is not set"

**Symptom:** Prepare processor doesn't start, or API calls fail
**Fix:**
1. Add `GEMINI_API_KEY` to Railway environment variables
2. Restart the service: `railway restart`

### Issue: "Failed to parse GCS credentials"

**Symptom:** Image uploads fail, GCS errors in logs
**Fix:**
1. Ensure `GOOGLE_CREDENTIALS_JSON` is properly base64-encoded:
   ```bash
   cat service-account.json | base64 -w 0
   ```
2. Update Railway env var with the base64 string
3. Restart service

### Issue: Background removal fails with "Unsupported format"

**Symptom:** ProductAsset status stuck on "processing" or "failed"
**Fix:**
- Already resolved in latest code (v1.0.22+)
- Ensures PNG format before passing to @imgly library
- Has JPEG fallback if PNG decoder rejects

### Issue: Prisma migration errors on startup

**Symptom:** P3008 "already applied" warnings in logs
**Fix:**
- Already resolved in v1.0.22+
- Removed `setup` script with migration resolution
- Migrations now run manually before deployment

---

## Rollback Procedure

If deployment fails:

1. **Revert code:**
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Rollback database (if migrations were applied):**
   ```bash
   # Connect to database
   railway run "cd app && npx prisma migrate resolve --rolled-back <migration-name>"
   ```

3. **Restore from backup (if available):**
   Railway Postgres provides automatic backups - restore via Railway dashboard

---

## Monitoring & Logs

### View Real-Time Logs
```bash
railway logs --tail
```

### Filter by Stage
Structured logs include `stage` field for filtering:
- `stage: "download"` - CDN fetches
- `stage: "convert"` - Image format conversion
- `stage: "bg-remove"` - Background removal
- `stage: "upload"` - GCS uploads
- `stage: "db-update"` - Database writes

### Example: Find Failed Prepares
```bash
railway logs | grep '"flow":"prepare"' | grep '"stage":"bg-remove"' | grep ERROR
```

### Trace a Specific Request
Use `requestId` from error response:
```bash
railway logs | grep 'requestId":"<uuid>"'
```

---

## Performance Optimization

### Background Processor Tuning

Edit `app/app/services/prepare-processor.server.ts`:

```typescript
const BATCH_SIZE = 5;  // Max assets processed per cycle (default: 5)
const INTERVAL_MS = 10000;  // Processing interval (default: 10s)
```

**To disable processor entirely:**
```bash
railway variables set DISABLE_PREPARE_PROCESSOR=true
```

### Database Connection Pooling

Railway Postgres has default connection limits. Monitor active connections:
```sql
SELECT count(*) FROM pg_stat_activity WHERE datname = 'railway';
```

Adjust Prisma connection pool in `app/app/db.server.js` if needed.

---

## Security Checklist

- [ ] All environment variables use Railway's encrypted storage (not committed to git)
- [ ] `GOOGLE_CREDENTIALS_JSON` has minimal IAM permissions (Storage Object Admin only)
- [ ] `GEMINI_API_KEY` has API usage limits configured
- [ ] Shopify webhook signatures validated (handled by `@shopify/shopify-app-remix`)
- [ ] App proxy requests authenticated via session (handled by `authenticate.public.appProxy`)
- [ ] Rate limiting enabled on render endpoint (5 req/min per session)
- [ ] Quota enforcement active (daily/monthly limits)

---

## Next Steps After Deployment

1. **Monitor first 10 product preparations** - check logs for errors
2. **Test storefront integration** - verify "See it in your room" modal loads
3. **Check quota usage** - ensure daily limits are reasonable
4. **Review error logs** - address any new structured log warnings
5. **Set up alerts** (optional) - Railway can integrate with monitoring services

---

## Support & Troubleshooting

- **Logs:** `railway logs --tail`
- **Health Check:** `curl https://your-app.railway.app/healthz`
- **Database Console:** `railway run "cd app && npx prisma studio"`
- **Railway Dashboard:** https://railway.app/dashboard

For urgent issues, check:
1. Railway service status
2. Database connection (via healthz endpoint)
3. GCS bucket permissions
4. Gemini API quota
