# Docker Configuration

## ⚠️ DEPRECATED FOR LOCAL DEVELOPMENT

This project uses **Railway for production deployment**. The Docker files are used by Railway's Dockerfile builder, not for local development.

## Production Deployment

Railway automatically builds from the root `Dockerfile` when you push to GitHub.

**Do NOT use:**
- `docker-compose.yml` (legacy, for reference only)
- `app/Dockerfile` (legacy, superseded by root Dockerfile)
- Any local Docker commands

## Root Dockerfile

The root `Dockerfile` is the single source of truth for Railway deployments:

```dockerfile
FROM node:20-slim AS base
WORKDIR /usr/src/app
# ... installs deps, builds app, generates Prisma client
CMD ["npm", "run", "start"]
```

## Image Service

The image service runs on **Google Cloud Run**, not Railway. See `image-service/Dockerfile` for its configuration.

## Migration Strategy

Database migrations are run manually, not on container startup:

```bash
# After pushing schema changes:
railway run --service See-It npx prisma migrate deploy
```

## Why Not Local Docker?

1. **Shopify CLI requirements** - The app needs Shopify CLI tunnels for OAuth
2. **Environment complexity** - Requires Shopify API keys, database, image service
3. **Production parity** - Better to test directly on Railway staging if needed

If you need to test changes, push to a branch and use Railway's preview environments.
