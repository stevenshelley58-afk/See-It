# Build v1.0.22 - Fix ReadableStream compatibility
# Cache bust: 2025-12-08
FROM node:20-slim AS base

WORKDIR /usr/src/app

# Install system dependencies required by Prisma and Sharp
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl libssl-dev ca-certificates libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first to leverage Docker layer caching
COPY app/package.json ./app/

WORKDIR /usr/src/app/app

# Copy .npmrc if it exists
COPY .npmrc* ./

# Copy package-lock.json if it exists for deterministic builds
COPY app/package-lock.json* ./

# Install all dependencies (dev deps required for building Remix + Prisma)
# Use npm ci if package-lock.json exists, otherwise npm install
RUN if [ -f package-lock.json ]; then \
        echo "✓ Using package-lock.json for deterministic build" && npm ci; \
    else \
        echo "⚠ WARNING: No package-lock.json - using npm install (non-deterministic)" && npm install; \
    fi

# Copy the remainder of the application source
COPY app/ .

# Build Remix bundle and generate Prisma client, then drop devDependencies
RUN npx prisma generate \
    && npm run build \
    && npm prune --omit=dev

EXPOSE 3000

ENV NODE_ENV=production

# Runtime: only generate Prisma client, no migrations
# Migrations should be run manually or via deploy step, not on every container start
CMD ["npm", "run", "docker-start"]

