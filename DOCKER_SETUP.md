# Docker Setup Guide

## Overview

This project has multiple deployment options:
- **Production**: Railway with Nixpacks (automatic)
- **Local Development**: Docker Compose (for testing)
- **Individual Services**: Separate Dockerfiles

## Directory Structure

```
c:\See It\
├── docker-compose.yml         # Orchestrates all services for local dev
├── app/
│   └── Dockerfile            # Shopify Remix app container
└── image-service/
    └── Dockerfile            # Image processing service container
```

## Local Development with Docker

### 1. Quick Start with Docker Compose

```bash
# Build and start all services
docker-compose up --build

# Or run in background
docker-compose up -d --build

# Stop all services
docker-compose down
```

This will start:
- **App**: http://localhost:3000
- **Image Service**: http://localhost:8001

### 2. Running Services Individually

#### Shopify App Only
```bash
cd app
docker build -t see-it-app .
docker run -p 3000:3000 see-it-app
```

#### Image Service Only
```bash
cd image-service
docker build -t see-it-image-service .
docker run -p 8001:8001 see-it-image-service
```

## Environment Variables

Create a `.env` file in the root directory:

```env
# Shopify App Variables
SHOPIFY_APP_URL=your-app-url
SHOPIFY_API_KEY=your-api-key
SHOPIFY_API_SECRET=your-api-secret
DATABASE_URL=file:./prisma/dev.sqlite

# Image Service Variables
GCP_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json
```

## Production Deployment

Production uses Railway with Nixpacks (NOT Docker):
- Configuration: `railway.json` and `nixpacks.toml`
- No Dockerfile needed for Railway deployment
- Railway automatically builds from source

## Why Multiple Dockerfiles?

1. **app/Dockerfile**: Contains Shopify-specific dependencies and Prisma setup
2. **image-service/Dockerfile**: Lightweight container for image processing with libvips
3. **docker-compose.yml**: Orchestrates both services for local testing

## Common Issues & Solutions

### OpenSSL Error with Prisma
Already fixed in `app/Dockerfile` with:
```dockerfile
RUN apk add --no-cache openssl openssl-dev libc6-compat python3 make g++
```

### Port Conflicts
Change ports in docker-compose.yml if defaults are in use:
```yaml
ports:
  - "3001:3000"  # Change 3001 to any available port
```

### Database Persistence
SQLite database is mounted as a volume to persist between container restarts:
```yaml
volumes:
  - ./app/prisma:/app/prisma
```

## Best Practices

1. **Never commit .env files** - Use .env.example as template
2. **Use docker-compose for local dev** - Ensures services can communicate
3. **Production uses Railway** - Docker is for local testing only
4. **Keep Dockerfiles in their service directories** - Clear ownership
