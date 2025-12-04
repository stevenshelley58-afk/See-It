# Prisma OpenSSL Railway Deployment Fix

## The Problem
Prisma is showing the warning: "Prisma failed to detect the libssl/openssl version to use"

## Updated Root Cause
1. Relying on the deprecated Nixpacks builder meant OpenSSL libraries were never bundled into the final image.
2. Environment-variable overrides were brittle and still left Prisma unable to locate `libssl`.
3. We had no control over the runtime image, so we could not verify which packages were actually present.

## Definitive Solution (Dockerfile Deployment)

### 1. Build a Known-Good Image
- Added a root-level `Dockerfile` based on `node:20-slim`.
- Installs `openssl`, `libssl-dev`, and `ca-certificates` via `apt-get`.
- Runs `npm ci`, `npx prisma generate`, `npm run build`, and then prunes dev dependencies.
- Uses `npm run docker-start` (which executes Prisma migrations before `remix-serve`) as the container entrypoint.

### 2. Update Railway Config
- `railway.json` now sets `"builder": "DOCKERFILE"` and points to the new `Dockerfile`.
- `startCommand` is `null` so Railway honors the Dockerfile `CMD`.

### 3. Clean Environment Variables
- Remove the temporary `NIXPACKS_*`, `PRISMA_CLI_BINARY_TARGETS`, and `LD_LIBRARY_PATH` overrides from Railway.
- Keep your Shopify + DATABASE variables exactly as they were.

## Deployment Steps

1. **Commit & push code:**
   ```bash
   git add Dockerfile railway.json RAILWAY_ENV_VARS.md PRISMA_OPENSSL_FIX.md DEPLOY_TRIGGER.txt
   git commit -m "Fix: Switch Railway deploy to Dockerfile with OpenSSL"
   git push origin main
   ```
2. **Clean Railway variables:** delete the obsolete `NIXPACKS_*`, `PRISMA_CLI_BINARY_TARGETS`, and `LD_LIBRARY_PATH` entries in the Railway dashboard.
3. **Redeploy:** Railway will rebuild using the Dockerfile automatically. Clear the build cache once to ensure a clean image.

## Why This Works

1. **Full control over the image** – we explicitly install the required system libraries.
2. **Deterministic Prisma workflow** – `prisma generate` + `npm run build` happen inside the Docker build, not in an opaque builder.
3. **Less guesswork** – no hidden buildpacks or deprecated builders; everything lives in versioned code.

## Verification

Once the redeploy finishes:
- Logs should no longer display `Prisma failed to detect the libssl/openssl version`.
- Container startup should show the Dockerfile steps followed by `npm run docker-start`.
- Prisma migrations should run automatically (because `docker-start` executes `prisma migrate deploy`).
