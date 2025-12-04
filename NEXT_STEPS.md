# Next Steps: Testing Real Flows on Dev Store

## Prerequisites Checklist

Before testing, ensure you have:

- [ ] **Shopify Partner Account** with access to Partner Dashboard
- [ ] **Dev Store** created and accessible
- [ ] **Shopify API Keys** from Partner Dashboard for "See It" app
- [ ] **Dev server running** (`npm run dev` in `c:\See It\app`)

---

## Step 1: Configure Environment Variables

1. **Open** `c:\See It\app\.env`

2. **Fill in the following from your Shopify Partner Dashboard:**
   ```bash
   SHOPIFY_API_KEY=<your_api_key>
   SHOPIFY_API_SECRET=<your_api_secret>
   SCOPES=write_products,read_products
   SHOPIFY_APP_URL=<tunnel_url_from_npm_run_dev>
   DATABASE_URL="file:./prisma/dev.sqlite"
   ```

3. **Get API Keys:**
   - Go to [partners.shopify.com](https://partners.shopify.com)
   - Navigate to Apps > "See It"
   - Copy API key and API secret key

4. **Save the file**

---

## Step 2: Install App on Dev Store

1. **Start dev server** (if not already running):
   ```bash
   cd c:\See It\app
   npm run dev
   ```

2. **Copy the Preview URL** from terminal output:
   ```
   Preview URL: https://test-store-[ID].myshopify.com/admin/oauth/redirect_from_cli?client_id=[CLIENT_ID]
   ```

3. **Open the URL** in your browser

4. **Click "Install app"** when prompted

5. **Verify installation:**
   - You should see the Admin UI dashboard
   - Check billing status (should be FREE plan)
   - Verify daily quota shows 5/5 available

---

## Step 3: Test Complete Flow

### 3.1 Product Preparation

**Goal:** Prepare a product asset for rendering

1. **Navigate to Products page** in Admin UI
2. **Click "Generate Sample Product"** (or select existing product)
3. **Click "Prepare" button** on a product
4. **Verify:**
   - Status changes to "pending" → "ready"
   - `product_assets` table has new entry
   - `prepared_image_url` is populated

**Database Check:**
```bash
npx prisma studio
# Check product_assets table
# Verify status = 'ready'
```

### 3.2 Room Cleanup (Optional)

**Goal:** Test mask-based room cleanup

1. **Open storefront** (your dev store product page)
2. **Click "See it in your room"** button
3. **Upload room image** with an object to remove
4. **Click "Remove Object"** button
5. **Upload mask image** (black/white mask)
6. **Verify:**
   - Room image updates with cleaned version
   - `room_sessions` table has `cleaned_room_image_url`

**Skip this if you don't have mask images ready**

### 3.3 Render (Core Flow)

**Goal:** Generate composite image

1. **On storefront modal:**
   - Upload room image (or use cleaned room)
   - Drag product to desired position
   - Adjust scale slider (e.g., 1.5x)
   - Select style preset (Neutral/Warm/Crisp)
   - Click "Generate"

2. **Verify:**
   - Status shows "Generating..."
   - After ~5-10 seconds, composite image appears
   - Image shows product placed in room
   - "Adjust Placement" and "Retry" buttons appear

3. **Database Check:**
   ```bash
   npx prisma studio
   # Check render_jobs table
   # Verify status = 'completed'
   # Check stylePreset matches selection
   # Verify placementX, placementY, placementScale
   ```

4. **Check Usage:**
   - Go to Admin UI Dashboard
   - Verify "Daily Usage" shows 1 render used
   - Check `usage_daily` table has `compositeRenders = 1`

### 3.4 Analytics Dashboard

**Goal:** Verify analytics data

1. **Navigate to Analytics** in Admin UI
2. **Verify:**
   - Recent jobs table shows your render
   - Status badge is green ("completed")
   - Style preset shows correctly (not "Default")
   - Success rate is 100% (1 completed, 0 failed)
   - Duration is reasonable (~5-10s)

3. **Generate a failed render** (optional):
   - Trigger quota exceeded (do 6 renders on FREE plan)
   - Or cause an error somehow
   - Verify failed render appears in analytics
   - Verify success rate updates correctly

### 3.5 Multi-Room Sessions

**Goal:** Test save/load room functionality

1. **On storefront modal:**
   - Upload first room image (e.g., living room)
   - Click "Save This Room"
   - Enter name: "Living Room"
   - Verify success message

2. **Upload second room:**
   - Upload different room image (e.g., bedroom)
   - Click "Save This Room"
   - Enter name: "Bedroom"

3. **Verify saved rooms list:**
   - Both rooms appear with thumbnails
   - Room names are correct

4. **Test room switching:**
   - Click "Living Room" in saved rooms
   - Verify room loads
   - **Verify placement resets** (product centered, scale 1.0)
   - Move product and change scale
   - Switch to "Bedroom"
   - **Verify placement resets again**

5. **Test render with saved room:**
   - Load "Living Room"
   - Place product
   - Generate render
   - Verify render completes
   - Check database: `room_session_id` matches saved room

6. **Test deletion:**
   - Click "Delete" on a saved room
   - Verify it's removed from list

7. **Browser Storage Check:**
   - Open DevTools (F12) > Application > Local Storage
   - Find key: `see-it-saved-rooms:<your-shop-domain>`
   - Verify structure:
     ```json
     [
       {
         "id": "room_session_id",
         "thumbnailUrl": "https://...",
         "name": "Living Room"
       }
     ]
     ```

---

## Step 4: Test Billing & Quotas

### 4.1 Quota Enforcement

1. **On FREE plan** (default after install):
   - Daily quota: 5 renders
   - Generate 5 renders on storefront
   - Verify 6th render returns quota exceeded error
   - Check error message: "Daily quota exceeded..."

2. **Verify Admin UI:**
   - Dashboard shows 5/5 used
   - Progress bar is at 100%

### 4.2 Upgrade to PRO

1. **Click "Upgrade to Pro"** in Admin UI
2. **Shopify redirects** to payment page
3. **Approve payment** (test mode)
4. **Verify redirect** back to Admin UI
5. **Check database:**
   ```bash
   npx prisma studio
   # Check shops table
   # Verify plan = 'pro'
   # Verify dailyQuota = 100
   # Verify monthlyQuota = 2000
   ```

6. **Test increased quota:**
   - Generate more renders (should work beyond 5)
   - Verify quota shows 100/day

---

## Step 5: Test Edge Cases

### Retry Failed Render
1. Cause a render to fail (quota exceeded or error)
2. Click "Retry" button
3. Verify new render job is created
4. Check analytics shows both attempts

### Stale Product Handling
1. In Shopify Admin, change product featured image
2. Webhook should mark asset as "stale"
3. Verify in Admin UI: product shows stale indicator
4. Re-prepare product
5. Verify status changes to "ready"

### Batch Prepare
1. Select multiple products in Admin UI
2. Click "Batch Prepare"
3. Verify all products are queued
4. Check quota is enforced for batch

---

## Troubleshooting

### Dev Server Issues
- **Error: "Invalid API key"**
  - Check `.env` file has correct `SHOPIFY_API_KEY`
  - Restart dev server after changing `.env`

- **Error: "Database URL invalid"**
  - Ensure `DATABASE_URL="file:./prisma/dev.sqlite"`
  - Run `npx prisma generate`

### OAuth Issues
- **Error: "App not installed"**
  - Click the Preview URL again
  - Ensure you're logged into correct dev store

### Render Issues
- **Render stays "queued"**
  - Image service may not be running
  - Check image service logs
  - Verify image service URL is correct

### Analytics Issues
- **No data showing**
  - Ensure you've generated at least one render
  - Check `render_jobs` table has entries
  - Verify `shopId` matches current shop

---

## Success Criteria

✅ App installs successfully on dev store  
✅ Product preparation works (status: ready)  
✅ Room cleanup works (if tested)  
✅ Render generates composite image  
✅ Analytics shows render history  
✅ Multi-room save/load works  
✅ Placement resets when switching rooms  
✅ Quota enforcement blocks excess renders  
✅ Billing upgrade works (PRO plan)  
✅ All database tables populated correctly  

---

## What's Next?

After successful testing:

1. **Deploy to Production**
   - Set up production environment variables
   - Deploy image service
   - Configure production database
   - Update `shopify.app.toml` for production

2. **Submit to Shopify App Store** (optional)
   - Complete app listing
   - Add screenshots
   - Write app description
   - Submit for review

3. **Monitor & Iterate**
   - Watch analytics for usage patterns
   - Gather merchant feedback
   - Optimize render quality
   - Add new style presets

---

**You're ready to test!** Start with Step 1 and work through each flow systematically.
