# Deploy See It - Quick Guide

## Changes Made (v1.0.20)

I've made the following improvements:

1. **Fixed product sync issue** - Now fetches ALL products from Shopify using pagination (was limited to 20 before)

2. **Removed external Image Service dependency** - The app now uses a local Gemini service built into the main app. No separate Cloud Run service needed!

3. **Fixed theme extension warnings** - Added width/height attributes to img tags.

4. **Updated version to 1.0.20**

## Step 1: Commit and Push to Trigger Railway Deployment

Run these commands in PowerShell from the `c:\See It` directory:

```powershell
cd "c:\See It"
git add -A
git commit -m "v1.0.20: Fetch ALL products with pagination, use local Gemini service"
git push origin main
```

## Step 2: Verify Railway Environment Variables

Go to your Railway dashboard: https://railway.app/project/eb044abc-f17a-4747-aff8-5c5e79c42669

Click on your **See-It** service → **Variables** tab

**REQUIRED Variables (add if missing):**

| Variable | Description | Value |
|----------|-------------|-------|
| `GEMINI_API_KEY` | Google Gemini API key | Get from https://aistudio.google.com/app/apikey |
| `GOOGLE_CREDENTIALS_JSON` | GCS service account JSON | Paste full JSON from your service account key file |
| `GCS_BUCKET` | GCS bucket name | `see-it-room` |

**Optional Variables (can remove):**
- `IMAGE_SERVICE_BASE_URL` - No longer needed
- `IMAGE_SERVICE_TOKEN` - No longer needed

## Step 3: Deploy Shopify Theme Extension

From the `app` directory, run:

```powershell
cd "c:\See It\app"
shopify app deploy
```

When prompted, confirm "Yes, release this new version".

## Step 4: Enable Theme Extension in Your Shopify Store

1. Go to your Shopify admin
2. Navigate to **Online Store → Themes**
3. Click **Customize** on your active theme
4. In the theme editor, look for **App embeds** (usually in the left sidebar footer)
5. Enable **See It** 
6. Save your changes

## Step 5: Test the App

1. Go to your Shopify admin → Apps → See It
2. Navigate to **Products**
3. Click **Prepare** on a product
4. Wait for it to complete (status should change to "ready")
5. Go to your storefront product page
6. Look for the "See it in your room" button
7. Upload a room photo and test the visualization!

## Troubleshooting

### If "Prepare" fails:
- Check Railway logs: `railway logs` or view in dashboard
- Verify `GEMINI_API_KEY` is set correctly
- Verify `GOOGLE_CREDENTIALS_JSON` is valid

### If theme extension doesn't show:
- Make sure it's enabled in theme editor (App embeds)
- Clear browser cache
- Try a different browser

### If upload fails:
- Check `GCS_BUCKET` is correct
- Verify `GOOGLE_CREDENTIALS_JSON` has storage permissions

## What Changed in v1.0.20

- `app.products.jsx` - **Fixed: Now fetches ALL products using pagination** (was limited to 20)
- `api.products.prepare.jsx` - Now uses local `gemini.server.ts` instead of external service
- `api.products.batch-prepare.jsx` - Same, processes images locally
- `app-proxy.room.confirm.ts` - Removed optional Gemini pre-upload call
- `see-it-button.liquid` - Added width/height to img tags
- `Dockerfile` - Updated version comment
- `package.json` - Version bump to 1.0.20





