# Runbook: See It Shopify App

## Production Deployment (Railway + Cloud Run)

This app is deployed to production only. There is no local development workflow.

### Architecture

- **Main App**: Railway (`see-it-production.up.railway.app`)
- **Database**: Railway PostgreSQL  
- **Image Service**: Google Cloud Run (`see-it-image-service-433767365876.us-central1.run.app`)
- **Storage**: Google Cloud Storage (`see-it-room` bucket)

### Required Environment Variables (Railway)

Set these in the Railway dashboard for the See-It service:

```
DATABASE_URL=postgresql://postgres:xxx@postgres.railway.internal:5432/railway
SHOPIFY_API_KEY=404b1dcd8562143be56b2dd81dec2270
SHOPIFY_API_SECRET=shpss_xxx
SHOPIFY_APP_URL=https://see-it-production.up.railway.app
SCOPES=write_products,read_products
IMAGE_SERVICE_BASE_URL=https://see-it-image-service-433767365876.us-central1.run.app
IMAGE_SERVICE_TOKEN=xxx
GCS_BUCKET=see-it-room
GOOGLE_CREDENTIALS_JSON=<base64-encoded-service-account-json>
```

### Deployment Flow

1. **Push changes** to the `main` branch on GitHub
2. **Railway auto-deploys** from the root `Dockerfile`
3. **Verify deployment** using Railway logs or the Railway dashboard

### Database Migrations

Migrations are **NOT** run automatically on container startup. When you change the Prisma schema:

1. Update `app/prisma/schema.prisma`
2. Create a new migration file in `app/prisma/migrations/`
3. Push to GitHub and let Railway deploy
4. Run migrations manually via Railway CLI:

```bash
railway run --service See-It npx prisma migrate deploy
```

### Shopify Configuration

All three `.toml` files must agree:

- `/shopify.app.toml` (root)
- `/app/shopify.app.toml`
- `/app/shopify.app.see-it.toml`

Run `node verify-config.js` to check consistency.

**Partner Dashboard must match:**
- App URL: `https://see-it-production.up.railway.app`
- Redirect URL: `https://see-it-production.up.railway.app/auth/callback`
- App Proxy: `apps/see-it` → `https://see-it-production.up.railway.app/app-proxy`

### Verifying the Deployment

1. Check Railway dashboard for service status
2. Visit `https://see-it-production.up.railway.app` (should not 404)
3. Install/reinstall app on dev store to refresh sessions
4. Test Admin UI at `/app`
5. Test storefront "See It" button flow

### Troubleshooting

**Service showing "Not Found":**
- Check Railway deployment logs for startup errors
- Verify DATABASE_URL is correct and Postgres service is running
- Ensure migrations have been applied

**Database connection errors:**
- The internal Railway URL (`postgres.railway.internal`) only works from within Railway
- For external access, use the public URL (`maglev.proxy.rlwy.net:21199`)

**Image service errors:**
- Check Cloud Run logs in Google Cloud Console
- Verify `IMAGE_SERVICE_TOKEN` matches between Railway and Cloud Run
