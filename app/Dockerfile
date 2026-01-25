# Custom Dockerfile to bypass Railway cache
# Cache bust: 2026-01-25T12:05:00Z

FROM node:20-slim AS builder

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all files (no layer caching optimization - force fresh build)
COPY . .

# Install dependencies, generate Prisma client, and build
RUN npm ci
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# Production image
FROM node:20-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts

# Set environment
ENV NODE_ENV=production

# Start the app
CMD ["npm", "run", "docker-start"]
