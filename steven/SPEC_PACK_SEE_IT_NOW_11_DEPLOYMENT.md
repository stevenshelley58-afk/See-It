# 11 — Deployment

## Purpose
This document specifies environment variables, deployment platforms, migration procedures, and rollback strategies.

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIza...` |
| `GCS_BUCKET` | GCS bucket name | `see-it-storage` |
| `GCS_PROJECT_ID` | GCP project ID | `my-project-123` |
| `GCS_CLIENT_EMAIL` | Service account email | `sa@project.iam.gserviceaccount.com` |
| `GCS_PRIVATE_KEY` | Service account private key | `-----BEGIN PRIVATE KEY-----...` |
| `SHOPIFY_API_KEY` | Shopify app API key | `abc123...` |
| `SHOPIFY_API_SECRET` | Shopify app API secret | `xyz789...` |
| `SCOPES` | Shopify API scopes | `read_products,write_products` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level | `info` |
| `NODE_ENV` | Environment | `production` |
| `SEE_IT_NOW_ALLOWED_SHOPS` | Comma-separated shop domains | `""` |
| `PORT` | Server port | `3000` |

### Environment File Template

```bash
# .env.example

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/see_it_now

# Google Cloud Storage
GCS_BUCKET=see-it-storage
GCS_PROJECT_ID=your-project-id
GCS_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GCS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Shopify
SHOPIFY_API_KEY=your-shopify-api-key
SHOPIFY_API_SECRET=your-shopify-api-secret
SCOPES=read_products,write_products

# Feature Flags
SEE_IT_NOW_ALLOWED_SHOPS=shop1.myshopify.com,shop2.myshopify.com

# Logging
LOG_LEVEL=info
```

---

## Platform Configurations

### Railway

**File: `railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**File: `.railwayignore`**

```
node_modules
.git
*.md
tests
```

### Vercel

**File: `vercel.json`**

```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/remix"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/"
    }
  ],
  "env": {
    "NODE_ENV": "production"
  }
}
```

### Docker

**File: `Dockerfile`**

```dockerfile
FROM node:18-slim

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production

# Generate Prisma client
RUN npx prisma generate

# Copy app code
COPY . .

# Build
RUN npm run build

# Expose port
EXPOSE 3000

# Start
CMD ["npm", "run", "start"]
```

---

## Database Migration

### Development

```bash
# Create a new migration
npx prisma migrate dev --name add_new_field

# Reset database (WARNING: destroys data)
npx prisma migrate reset
```

### Production

```bash
# Apply pending migrations
npx prisma migrate deploy

# Generate client after migration
npx prisma generate
```

### Migration Checklist

1. [ ] Test migration on staging first
2. [ ] Backup production database
3. [ ] Run `prisma migrate deploy`
4. [ ] Verify migration success
5. [ ] Deploy new code
6. [ ] Verify application works

---

## Deployment Steps

### Initial Deployment

```bash
# 1. Clone repository
git clone https://github.com/your-org/see-it-now.git
cd see-it-now/app

# 2. Install dependencies
npm ci

# 3. Set environment variables
cp .env.example .env
# Edit .env with production values

# 4. Run database migrations
npx prisma migrate deploy

# 5. Generate Prisma client
npx prisma generate

# 6. Build application
npm run build

# 7. Start server
npm run start
```

### Subsequent Deployments

```bash
# 1. Pull latest code
git pull origin main

# 2. Install any new dependencies
npm ci

# 3. Run migrations (if any)
npx prisma migrate deploy

# 4. Build
npm run build

# 5. Restart server
# (platform-specific)
```

---

## Shopify App Setup

### 1. Create Shopify App

In Shopify Partners Dashboard:
- Create new app
- Set App URL to your deployment URL
- Set Allowed redirection URLs

### 2. Configure shopify.app.toml

```toml
name = "See It Now"
handle = "see-it-now"
client_id = "your-client-id"

[access_scopes]
scopes = "read_products,write_products"

[auth]
redirect_urls = [
  "https://your-app.railway.app/auth/callback",
  "https://your-app.railway.app/auth/shopify/callback"
]

[webhooks]
api_version = "2024-01"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
uri = "/webhooks"

[[webhooks.subscriptions]]
topics = ["products/update"]
uri = "/webhooks"

[app_proxy]
url = "https://your-app.railway.app"
subpath = "see-it"
prefix = "apps"

[pos]
embedded = false
```

### 3. Deploy Theme Extension

```bash
# Deploy extension
cd extensions/see-it-extension
shopify app deploy

# Or push specific extension
shopify app push --extension see-it-extension
```

---

## GCS Setup

### 1. Create Bucket

```bash
gsutil mb -l us-central1 gs://your-bucket-name
```

### 2. Set CORS

```bash
gsutil cors set gcs-cors.json gs://your-bucket-name
```

### 3. Create Service Account

```bash
gcloud iam service-accounts create see-it-storage-sa \
  --display-name="See It Storage Service Account"

gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:see-it-storage-sa@your-project-id.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud iam service-accounts keys create service-account.json \
  --iam-account=see-it-storage-sa@your-project-id.iam.gserviceaccount.com
```

---

## Health Check Verification

After deployment, verify health:

```bash
curl https://your-app.railway.app/healthz
```

Expected response:

```json
{
  "status": "healthy",
  "checks": {
    "database": true,
    "storage": true
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Rollback Procedure

### Code Rollback

```bash
# Railway
railway rollback

# Vercel
vercel rollback

# Manual Git
git revert HEAD
git push origin main
```

### Database Rollback

**WARNING**: Prisma doesn't support automatic rollback. For critical migrations:

1. Create a rollback migration manually
2. Test rollback on staging
3. Apply if needed

```bash
# Create rollback migration
npx prisma migrate dev --name rollback_xyz

# Apply rollback
npx prisma migrate deploy
```

---

## Monitoring Post-Deployment

### Verify Checklist

1. [ ] Health endpoint returns 200
2. [ ] Database connection works
3. [ ] GCS connection works
4. [ ] Shopify OAuth works
5. [ ] App proxy routes respond
6. [ ] Theme extension loads
7. [ ] See It Now button appears on PDP
8. [ ] Generation flow completes

### Log Monitoring

```bash
# Railway
railway logs

# Vercel
vercel logs

# Docker
docker logs <container-id> -f
```

---

## Scaling Considerations

### Database

- Use connection pooling (PgBouncer) for high traffic
- Consider read replicas for analytics queries
- Index frequently queried columns

### Storage

- GCS auto-scales, no action needed
- Consider CDN for frequently accessed images

### Compute

- Railway: Scale replicas in dashboard
- Vercel: Automatic scaling
- Docker: Use orchestrator (Kubernetes, ECS)

---

## Secrets Rotation

### Gemini API Key

1. Generate new key in Google AI Studio
2. Update environment variable
3. Redeploy
4. Delete old key

### GCS Service Account

1. Create new key in GCP Console
2. Update `GCS_PRIVATE_KEY` environment variable
3. Redeploy
4. Delete old key

### Shopify API Secret

1. Regenerate in Shopify Partners
2. Update `SHOPIFY_API_SECRET`
3. Redeploy
4. Users will need to reinstall app (breaking change)
