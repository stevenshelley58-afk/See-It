# Prisma Configuration for Railway

## Binary Targets

The `schema.prisma` includes binary targets for the Railway container environment:

```prisma
generator client {
  provider = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-1.1.x", "debian-openssl-3.0.x"]
}
```

These targets ensure Prisma works on:
- `native` - Your local development machine (if needed)
- `debian-openssl-1.1.x` - Older Debian/Ubuntu containers
- `debian-openssl-3.0.x` - Node 20 slim containers (current)

## Dockerfile Configuration

The root `Dockerfile` installs OpenSSL:

```dockerfile
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

## PostgreSQL Provider

The schema uses PostgreSQL (not SQLite):

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

## Migrations

Migrations are PostgreSQL-compatible, using:
- `TIMESTAMP(3)` instead of `DATETIME`
- `DOUBLE PRECISION` instead of `REAL`
- `CONSTRAINT xxx_pkey PRIMARY KEY` syntax
- `ALTER TABLE ... ADD CONSTRAINT` for foreign keys

## Running Migrations

Migrations are NOT run on container startup. Run manually:

```bash
railway run --service See-It npx prisma migrate deploy
```
