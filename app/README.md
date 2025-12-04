# See It - Shopify App

A Shopify app that lets customers visualize products in their own rooms using AI-powered image compositing.

## Production URLs

- **App**: `https://see-it-production.up.railway.app`
- **Image Service**: `https://see-it-image-service-433767365876.us-central1.run.app`

## Architecture

- **Framework**: Remix (Shopify App template)
- **Database**: PostgreSQL on Railway
- **Hosting**: Railway (app), Google Cloud Run (image service)
- **AI**: Google Gemini for image processing

## Deployment

This app is deployed to Railway. Push to `main` and Railway auto-deploys.

For migrations after schema changes:

```bash
railway run --service See-It npx prisma migrate deploy
```

## Configuration

See `shopify.app.toml` for Shopify configuration.  
See `prisma/schema.prisma` for database schema.

## Verification

From the repository root:

```bash
node verify-config.js
```

## Documentation

See the repository root for deployment guides:

- `RUNBOOK.md` - Quick reference
- `PRODUCTION_DEPLOYMENT_GUIDE.md` - Detailed deployment steps
- `DEPLOYMENT_SINGLE_SOURCE.md` - Canonical URLs and settings
