# See It App - Handoff Document (v1.0.22)

**Last Updated:** 2025-12-06
**Branch:** `claude/review-app-docs-01DhbTZan5Nx7c65kiRjTnGA`

---

## What This App Does

See It is a Shopify app that lets customers visualize furniture in their own room using AI.

**User Flow:**
1. Customer clicks "See it in your room" button on product page
2. Uploads/takes photo of their room
3. Optionally removes existing furniture (paint mask → AI cleanup)
4. Drags/resizes the product image onto their room
5. Clicks "Generate" → AI composites product into scene
6. Optional: "Enhance HD" for higher quality

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     SHOPIFY STOREFRONT                          │
│  see-it-button.liquid → see-it-modal.js → see-it-modal.css     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (App Proxy: /apps/see-it/*)
┌─────────────────────────────────────────────────────────────────┐
│                      REMIX APP (Railway)                        │
│                                                                 │
│  Routes:                                                        │
│  ├─ app-proxy.room.upload.ts    → Upload room image to GCS     │
│  ├─ app-proxy.room.confirm.ts   → Confirm upload, cache image  │
│  ├─ app-proxy.room.cleanup.ts   → Remove furniture (Gemini)    │
│  ├─ app-proxy.render.ts         → Generate composite (Gemini)  │
│  └─ app-proxy.render.$jobId.ts  → Poll job status              │
│                                                                 │
│  Services:                                                      │
│  ├─ gemini.server.ts            → AI image generation          │
│  ├─ storage.server.ts           → Google Cloud Storage         │
│  └─ image-cache.server.ts       → In-memory buffer cache       │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌────────┐     ┌──────────┐    ┌──────────┐
         │  GCS   │     │  Gemini  │    │  SQLite  │
         │ Images │     │    AI    │    │  (Prisma)│
         └────────┘     └──────────┘    └──────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/extensions/see-it-extension/blocks/see-it-button.liquid` | Shopify theme block - button + modal HTML |
| `app/extensions/see-it-extension/assets/see-it-modal.js` | Frontend logic - all user interactions |
| `app/extensions/see-it-extension/assets/see-it-modal.css` | Styling |
| `app/app/routes/app-proxy.render.ts` | Main render endpoint |
| `app/app/services/gemini.server.ts` | AI compositing + image cleanup |
| `app/app/utils/image-cache.server.ts` | Buffer cache for images |
| `app/prisma/schema.prisma` | Database schema |

---

## Recent Changes (v1.0.22)

### 1. Speed Optimization
- **Before:** 10-25 seconds (Gemini Pro model)
- **After:** 3-6 seconds (Gemini Flash model)
- HD available via "Enhance HD" button (uses Pro model)

### 2. Image Caching
- New file: `app/app/utils/image-cache.server.ts`
- 30-minute TTL, 500MB max
- Room images cached on upload confirm (eager caching)
- Product images cached on first render

### 3. Product ID Fix
- **Bug:** Frontend sent `8547291234567`, backend expected `gid://shopify/Product/8547291234567`
- **Fix:** Changed Liquid template to output GID format

### 4. Parallel Downloads
- Room and product images now download simultaneously
- Cache keys passed to avoid re-downloads

---

## Known Issues (NOT YET FIXED)

### Critical
1. **Polling timeout** - `pollStatus()` in see-it-modal.js has no max attempts. Can poll forever.
   - Fix: Add `maxAttempts = 30` counter, show error after timeout

2. **Signed URL expiry** - GCS URLs expire after 1 hour. If user leaves tab open, 403 errors.
   - Fix: Store GCS key in DB, re-sign URL on read

### Medium
3. **No npm install** - Environment had network issues. User must run locally.

4. **Legacy code** - Cloud Run image-service references still exist but are unused.

### Low
5. **Scale range mismatch** - Slider: 0.5-2.0x, Drag handles: 0.2-5.0x

---

## Environment Variables Required

```env
# Shopify
SHOPIFY_API_KEY=xxx
SHOPIFY_API_SECRET=xxx
SCOPES=write_products,read_products

# Google Cloud
GOOGLE_CLOUD_PROJECT=see-it-xxx
GCS_BUCKET_NAME=see-it-images
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Gemini AI
GEMINI_API_KEY=xxx

# Database
DATABASE_URL=file:./dev.db
```

---

## Gemini Models Used

| Model | Speed | Quality | Used For |
|-------|-------|---------|----------|
| `gemini-2.5-flash-image` | 3-6 sec | Good | Default renders |
| `gemini-3-pro-image-preview` | 10-20 sec | Best | HD enhance |

---

## Database Tables (Prisma)

```
Shop            - Shopify store info, quotas
RoomSession     - Customer room upload sessions
RenderJob       - Composite render jobs
ProductAsset    - Prepared product images (bg removed)
```

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/apps/see-it/room/upload` | Get signed upload URL |
| POST | `/apps/see-it/room/confirm` | Confirm room uploaded |
| POST | `/apps/see-it/room/cleanup` | Remove furniture with mask |
| POST | `/apps/see-it/render` | Start composite render |
| GET | `/apps/see-it/render/:jobId` | Poll job status |

---

## Render Request Payload

```json
{
  "room_session_id": "uuid",
  "product_id": "gid://shopify/Product/123456",
  "placement": {
    "x": 0.5,
    "y": 0.6,
    "scale": 1.2
  },
  "quality": "fast",
  "config": {
    "style_preset": "neutral",
    "product_image_url": "https://cdn.shopify.com/..."
  }
}
```

- `quality`: `"fast"` (default, Flash model) or `"hd"` (Pro model)
- `x`, `y`: Normalized 0-1 coordinates (center of product)
- `scale`: 1.0 = original size

---

## To Deploy

```bash
cd app
npm install
npm run build
# Deploy to Railway or run locally with:
npm run dev
```

---

## To Test

1. Install app on dev store
2. Add "See It Button" block to product page
3. Click button → upload room → place product → generate

---

## Files to Read First

If you're debugging, read these in order:
1. `see-it-modal.js` - Frontend flow
2. `app-proxy.render.ts` - Render endpoint
3. `gemini.server.ts` - AI logic
4. `image-cache.server.ts` - Caching

---

## Contact

Owner: Steve (bhm.com.au)
Purpose: Visualize vintage/custom furniture in customer rooms
