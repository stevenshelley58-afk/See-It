# Next Steps: Production Verification

This document outlines the steps to verify the See It app is working correctly in production.

## Pre-Verification Checklist

- [ ] Railway See-It service is deployed and running (not crashed)
- [ ] Database migrations have been applied to Railway PostgreSQL
- [ ] Shopify Partner Dashboard matches the app URLs
- [ ] Theme extension is deployed via `shopify app deploy`

---

## Step 1: Verify Service Health

1. **Check Railway dashboard** - See-It service should show "Active"
2. **Check deployment logs** - No startup errors
3. **Verify endpoint** - `https://see-it-production.up.railway.app` returns HTML (not 404)

---

## Step 2: Install App on Dev Store

1. Go to **Shopify Partner Dashboard** → Apps → See It
2. Click **Test on development store**
3. Select your dev store and **Install**
4. You should land on the embedded Admin UI (`/app`)

---

## Step 3: Test Admin Flows

### 3.1 Product Preparation

1. Navigate to **Products** page in Admin UI
2. Click **Prepare** on a product with an image
3. Verify:
   - Status changes to "pending" → "ready"
   - `prepared_image_url` is populated
   - No errors in Railway logs

### 3.2 Analytics Dashboard

1. Navigate to **Analytics** page
2. Verify render history is displayed (if any renders exist)

---

## Step 4: Test Storefront Flow

1. Go to your dev store's product page
2. Click **"See it in your room"** button (theme extension)
3. Upload a room image
4. Draw mask to remove objects (optional)
5. Place product and adjust scale
6. Click **Generate**
7. Verify:
   - Composite image appears
   - Render job shows "completed" in database

---

## Step 5: Verify Image Service Connection

Run the test script:

```bash
node scripts/test-image-service-connection.js
```

Expected output:
- ✅ Health check passes
- ✅ Token authentication works

---

## Step 6: Test Billing & Quotas

### 6.1 Quota Enforcement

1. On FREE plan, generate renders until quota exhausted
2. Verify 429 error when quota exceeded
3. Check Admin UI shows correct usage

### 6.2 Upgrade Flow

1. Click **Upgrade to Pro** in Admin UI
2. Complete Shopify payment flow (test mode)
3. Verify plan updates to PRO with higher quotas

---

## Success Criteria

✅ Service is healthy and reachable  
✅ App installs and loads Admin UI  
✅ Product preparation works  
✅ Storefront modal opens and functions  
✅ Renders complete successfully  
✅ Quota enforcement works  

---

## If Something Fails

1. **Check Railway logs** - `railway logs --service See-It`
2. **Check Cloud Run logs** - Google Cloud Console
3. **Verify environment variables** - Railway dashboard
4. **Check database** - Use Railway's database UI or `railway connect postgres`
