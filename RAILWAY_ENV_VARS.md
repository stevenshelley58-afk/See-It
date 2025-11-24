# Railway Environment Variables - MUST SET IN DASHBOARD

## 🚨 CRITICAL: Add These to Railway Dashboard NOW

Go to your Railway project → Variables tab → Add these EXACTLY:

```
NIXPACKS_APT_PACKAGES=openssl libssl-dev ca-certificates
NIXPACKS_NODE_VERSION=20
NIXPACKS_INSTALL_CMD=cd app && npm ci
NIXPACKS_BUILD_CMD=cd app && npx prisma generate && npm run build
PRISMA_CLI_BINARY_TARGETS=["native","linux-musl-openssl-3.0.x"]
LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
```

## Why This Works

1. **NIXPACKS_APT_PACKAGES**: Installs OpenSSL at the system level
2. **PRISMA_CLI_BINARY_TARGETS**: Forces Prisma to use the correct binary
3. **LD_LIBRARY_PATH**: Tells the system where to find OpenSSL libraries

## Steps to Deploy

1. **Add ALL variables above to Railway Dashboard**
   - Go to https://railway.app
   - Open your project
   - Click "Variables" tab
   - Add each variable EXACTLY as shown

2. **Simplify railway.json** (already done)

3. **Push changes**:
   ```bash
   git add railway.json RAILWAY_ENV_VARS.md
   git rm nixpacks.toml railway.toml  # Remove deleted files from git
   git commit -m "Fix: Use Railway environment variables for OpenSSL"
   git push origin main
   ```

4. **Force rebuild in Railway**:
   - After push, go to Railway dashboard
   - Click on your deployment
   - Click "Redeploy" → "Clear build cache"

## Verification

After deployment, check logs for:
- ✅ No OpenSSL warning
- ✅ "Starting Container" message
- ✅ Clean startup

## If STILL Not Working

Add these additional variables:
```
PRISMA_QUERY_ENGINE_LIBRARY=/usr/lib/x86_64-linux-gnu/libssl.so.3
OPENSSL_CONF=/etc/ssl/
```

## Railway's Approach

Railway recommends using environment variables over config files for Nixpacks configuration. This is why we:
- Deleted nixpacks.toml
- Deleted railway.toml  
- Simplified railway.json
- Use environment variables for everything

Source: Railway's official build configuration guide
