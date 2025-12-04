# Railway Environment Variables (Docker Deployment)

## ✅ Required Variables (keep existing values)
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES`
- `IMAGE_SERVICE_TOKEN`
- `IMAGE_SERVICE_BASE_URL`
- `DATABASE_URL`
- `SHOPIFY_APP_URL`
- `NODE_ENV`

## 🆕 Required for GCS Storage (ADD THESE)
- `GCS_BUCKET` = `see-it-room` (your GCS bucket name - CORS configured)
- `GOOGLE_CREDENTIALS_JSON` = (paste the ENTIRE contents of gcs-key.json as a single line)

### How to set GOOGLE_CREDENTIALS_JSON:
1. Open `image-service/gcs-key.json`
2. Copy the entire JSON content
3. In Railway → Variables, create `GOOGLE_CREDENTIALS_JSON`
4. Paste the JSON as the value (Railway handles escaping)

These already live in Railway → Variables and should remain unchanged.

## 🧹 Remove Old Nixpacks Variables
Delete the following entries from Railway → Variables (they are no longer used once we switch to the Dockerfile builder):
- `NIXPACKS_APT_PACKAGES`
- `NIXPACKS_NODE_VERSION`
- `NIXPACKS_INSTALL_CMD`
- `NIXPACKS_BUILD_CMD`
- `LD_LIBRARY_PATH`
- `PRISMA_CLI_BINARY_TARGETS`

## 🆕 Nothing New To Add
The new Dockerfile installs OpenSSL (`openssl`, `libssl-dev`, `ca-certificates`) and runs the full Prisma workflow during the image build, so no additional configuration variables are required.

## 🚀 Deploy Steps
1. Remove the obsolete variables listed above.
2. Commit & push the Dockerfile + `railway.json` changes:
   ```bash
   git add Dockerfile railway.json RAILWAY_ENV_VARS.md DEPLOY_TRIGGER.txt
   git commit -m "Fix: Use Dockerfile build on Railway with OpenSSL"
   git push origin main
   ```
3. Railway will rebuild automatically using the Dockerfile builder (Node 20 slim + OpenSSL).

## ✅ Verification
After the redeploy completes, tail the logs:
- Expect **no** `Prisma failed to detect the libssl/openssl version` warnings
- App should boot via `npm run docker-start` (which runs Prisma migrations + Remix serve)
