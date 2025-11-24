# 🚀 Shopify App Development Setup Guide

## 📋 Complete Setup Checklist for New Projects

This guide will help you avoid configuration mismatches and deployment issues in future Shopify app projects.

---

## 1️⃣ **Initial Project Setup**

### Step 1: Create Your App in Partner Dashboard FIRST
```
1. Go to partners.shopify.com
2. Click "Apps" → "Create app"
3. Choose "Public app"
4. Name your app
5. Note down:
   - Client ID: 404b1dcd...
   - Client Secret: shpss_...
```

### Step 2: Initialize Your Project
```bash
# Clone the Shopify app template
npm init @shopify/app@latest

# Choose options:
# - Name: your-app-name
# - Package manager: npm
# - Template: remix
```

### Step 3: Create Configuration File
Create `.env.production` in project root:
```env
# Shopify App Credentials (from Partner Dashboard)
SHOPIFY_API_KEY=404b1dcd8562143be56b2dd81dec2270
SHOPIFY_API_SECRET=shpss_...
SCOPES=write_products,read_products

# App URLs (will update after deployment)
SHOPIFY_APP_URL=https://your-app.up.railway.app

# Database (will get from Railway)
DATABASE_URL=postgresql://...

# Additional Services
IMAGE_SERVICE_BASE_URL=https://...
IMAGE_SERVICE_TOKEN=...
```

---

## 2️⃣ **Deployment Setup (Railway)**

### Step 1: Prepare for Railway
```bash
# Create railway.json
cat > railway.json << EOF
{
    "$schema": "https://railway.app/railway.schema.json",
    "build": {
        "builder": "NIXPACKS",
        "buildCommand": "cd app && npm ci && npx prisma generate && npm run build"
    },
    "deploy": {
        "startCommand": "cd app && npm run start",
        "restartPolicyType": "ON_FAILURE",
        "restartPolicyMaxRetries": 10
    }
}
EOF
```

### Step 2: Deploy to Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and create project
railway login
railway init

# Add PostgreSQL database
railway add postgresql

# Deploy
railway up
```

### Step 3: Configure Railway Environment
Go to Railway dashboard and set ALL variables from `.env.production`

### Step 4: Update Configuration Files
After Railway deployment, update ALL these files with your Railway URL:
- `shopify.app.toml`
- `app/shopify.app.toml`
- `.env.production`

---

## 3️⃣ **Partner Dashboard Configuration**

### CRITICAL: Update These Settings
1. **App Setup → URLs**
   - App URL: `https://your-app.up.railway.app`
   - Redirect URLs (add ALL):
     ```
     https://your-app.up.railway.app/auth/callback
     https://your-app.up.railway.app/api/auth
     https://your-app.up.railway.app/auth/login
     https://your-app.up.railway.app/auth
     ```

2. **App Setup → API Access**
   - Select required scopes

3. **App Proxy** (if needed)
   - Subpath prefix: `apps`
   - Subpath: `your-app`
   - URL: `https://your-app.up.railway.app/app-proxy`

---

## 4️⃣ **Theme Extension Development**

### Step 1: Generate Extension
```bash
cd app
npm run shopify app generate extension
# Choose: Theme app extension
# Name: your-extension
```

### Step 2: Required Files Structure
```
app/extensions/your-extension/
├── blocks/
│   └── your-button.liquid
├── assets/
│   ├── your-style.css
│   └── your-script.js
├── locales/
│   └── en.default.json
└── shopify.extension.toml
```

### Step 3: Deploy Extension
```bash
# IMPORTANT: Check you're using correct app
npm run shopify app info

# Deploy
npm run deploy
```

---

## 5️⃣ **Configuration Management Best Practices**

### Use Single Source of Truth
Create `config/app-config.js`:
```javascript
module.exports = {
    CLIENT_ID: process.env.SHOPIFY_API_KEY || '404b1dcd...',
    APP_URL: process.env.SHOPIFY_APP_URL || 'https://...',
    SCOPES: 'write_products,read_products',
    // ... all other config
};
```

### Automated Verification
Use the verification script regularly:
```bash
node verify-config.js
```

### Git Hooks for Config Checking
Add to `.git/hooks/pre-push`:
```bash
#!/bin/bash
node verify-config.js || exit 1
```

---

## 6️⃣ **Common Pitfalls to Avoid**

### ❌ **DON'T DO THIS:**
1. Having multiple `shopify.app.toml` files with different values
2. Forgetting to update Partner Dashboard after URL changes
3. Deploying theme extension before configuring app
4. Missing redirect URLs in Partner Dashboard
5. Using wrong client ID in any config file
6. Not setting Railway environment variables
7. Deploying to wrong Shopify app

### ✅ **ALWAYS DO THIS:**
1. Check configuration with `verify-config.js` before deploying
2. Keep all URLs consistent across all files
3. Update Partner Dashboard immediately after any URL change
4. Set ALL environment variables in Railway
5. Use the same scopes order everywhere
6. Test installation flow after deployment

---

## 7️⃣ **Development Workflow**

### Local Development
```bash
# 1. Start tunnel
npm run dev

# 2. Update SHOPIFY_APP_URL in .env
SHOPIFY_APP_URL=https://your-tunnel.ngrok.io

# 3. Update Partner Dashboard with tunnel URL
```

### Staging Deployment
```bash
# 1. Create staging branch
git checkout -b staging

# 2. Deploy to Railway staging
railway environment staging
railway up

# 3. Update staging configs
```

### Production Deployment
```bash
# 1. Verify all configs
node verify-config.js

# 2. Merge to main
git checkout main
git merge staging

# 3. Deploy
git push origin main  # Railway auto-deploys

# 4. Deploy theme extension
npm run deploy
```

---

## 8️⃣ **Debugging Checklist**

### If App Won't Install:
```bash
□ Check Client ID matches everywhere
□ Verify all redirect URLs in Partner Dashboard
□ Check Railway logs: railway logs
□ Verify DATABASE_URL is set
□ Run: node verify-config.js
```

### If Theme Extension Not Showing:
```bash
□ Check extension deployed to correct app
□ Verify in Partner Dashboard versions
□ Clear browser cache
□ Try different theme
□ Check theme editor → App embeds
```

### If 404 Errors:
```bash
□ Verify SHOPIFY_APP_URL in Railway
□ Check application_url in all .toml files
□ Confirm Partner Dashboard App URL
□ Test Railway deployment: curl https://your-app.up.railway.app
```

---

## 9️⃣ **Project Structure Best Practice**

```
your-shopify-app/
├── app/                      # Main app code
│   ├── routes/              # Remix routes
│   ├── extensions/          # Theme extensions
│   ├── shopify.app.toml     # Main config
│   └── package.json
├── config/                  # Configuration files
│   ├── app-config.js       # Single source of truth
│   └── verify-config.js    # Verification script
├── docs/                    # Documentation
│   ├── SETUP.md
│   └── DEPLOYMENT.md
├── .env.example            # Example env vars
├── .env.production         # Production env (gitignored)
├── railway.json            # Railway config
└── README.md              # Project overview
```

---

## 🔟 **Quick Commands Reference**

```bash
# Verify configuration
node verify-config.js

# Check app info
npm run shopify app info

# Deploy to Railway
railway up

# Deploy theme extension
npm run deploy

# View Railway logs
railway logs --tail 50

# Update Partner Dashboard
# Manual - no CLI command

# Test installation
# Visit: https://your-store.myshopify.com/admin/oauth/install?client_id=YOUR_CLIENT_ID
```

---

## 🚨 **Emergency Fixes**

### Reset Everything:
```bash
# 1. Update all configs to match
find . -name "*.toml" -exec grep -l "client_id" {} \; | xargs sed -i 's/old_id/new_id/g'

# 2. Clear and redeploy
railway down
railway up

# 3. Reinstall app on test store
```

### Force Theme Extension Update:
```bash
# Delete and recreate
rm -rf app/extensions/your-extension
npm run generate extension
npm run deploy --force
```

---

## 📚 **Resources**

- [Shopify App Development Docs](https://shopify.dev/docs/apps)
- [Railway Deployment Guide](https://docs.railway.app)
- [Remix Shopify Template](https://github.com/Shopify/shopify-app-template-remix)
- [Theme Extension Guide](https://shopify.dev/docs/apps/online-store/theme-app-extensions)

---

## ✅ **Final Checklist Before Going Live**

```markdown
□ All configuration files have matching values
□ Railway environment variables are set
□ Partner Dashboard URLs are correct
□ Theme extension is deployed
□ Webhooks are configured
□ Billing is tested (if applicable)
□ Installation flow works on test store
□ verify-config.js shows 100%
□ Documentation is updated
□ Backup/rollback plan exists
```

---

## 💡 **Pro Tips**

1. **Always run `verify-config.js` before major actions**
2. **Keep a spreadsheet with all your URLs and IDs**
3. **Use Railway environments (staging, production)**
4. **Document every configuration change**
5. **Test installation on multiple test stores**
6. **Set up monitoring (Sentry, LogRocket)**
7. **Use GitHub Actions for automated checks**

---

Remember: **Configuration consistency is key!** When in doubt, run the verification script.
