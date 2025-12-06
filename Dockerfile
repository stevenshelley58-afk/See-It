# Build v1.0.21 - Fix Vite build externalization
# Cache bust: 2024-12-06-v2
FROM node:20-slim AS base

WORKDIR /usr/src/app

# Install system dependencies required by Prisma and Sharp
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl libssl-dev ca-certificates libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first to leverage Docker layer caching
# package-lock.json may be absent; install without lockfile
COPY app/package.json ./app/

WORKDIR /usr/src/app/app

# Install all dependencies (dev deps required for building Remix + Prisma)
RUN npm install

# Copy the remainder of the application source
COPY app/ .

# Build Remix bundle and generate Prisma client, then drop devDependencies
RUN npx prisma generate \
    && npm run build \
    && npm prune --omit=dev

EXPOSE 3000

ENV NODE_ENV=production

# Runs prisma migrate deploy + remix-serve
CMD ["npm", "run", "docker-start"]

