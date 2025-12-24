# See It App - Flow Definitions

## Flow F1: Product Preparation (Admin → Background Processor)

**Trigger:** Admin clicks "Prepare" on product in `/app/products`

**Steps:**
1. Admin UI calls `POST /api/products/prepare` with `productId`, `imageUrl`, `imageId`
2. Route validates input, checks quota, creates/updates ProductAsset with `status="pending"`
3. Idempotency check: if asset already `ready` with `preparedImageUrl`, return existing
4. Background processor (or inline) calls `prepareProduct()` which:
   - **Stage: download** - Fetches from Shopify CDN, validates size (0 < size < 50MB), logs content-type
   - **Stage: convert** - Converts to PNG using sharp, validates output buffer > 0
   - **Stage: bg-remove** - Removes background using `@imgly/background-removal-node` with `mimeType: 'image/png'`, fallback to JPEG if needed
   - **Stage: upload** - Uploads to GCS bucket `see-it-room`, generates signed URL
   - **Stage: db-update** - Updates ProductAsset: `status="ready"`, `preparedImageUrl=<signed-url>`
5. On any failure: set `status="failed"`, `errorMessage=<truncated-error>`

**Error Handling:**
- Validation errors: 400 with structured error
- Quota exceeded: 429
- Shop not found: 404
- Processing failures: 500, asset marked failed with errorMessage
- All errors include `requestId` for correlation

**Idempotency Rules:**
- If asset `status="ready"` and `preparedImageUrl` exists, skip processing (unless explicit re-prepare)
- If asset `status="processing"`, skip update to avoid race conditions
- Background processor checks before starting work

## Flow F2: Storefront Consumption

**Trigger:** User opens "See it in your room" modal on storefront

**Steps:**
1. Storefront extension requests prepared image via `/app-proxy/product.prepared?productId=X`
2. Endpoint looks up ProductAsset by shopId + productId
3. If `status="ready"` and `preparedImageUrl` exists, return it
4. If not ready, return appropriate status/error
5. Prepared image used in render flows (composite)

## Flow F3: Re-prepare (Explicit)

**Trigger:** Admin clicks "Reprepare" on existing asset

**Steps:**
- Same as F1, but skips idempotency check
- Forces new preparation even if asset is already ready

## Flow F4: Prepare with Invalid URL

**Scenario:** Product image URL is invalid or unreachable

**Expected Behavior:**
- Download stage fails with structured error log
- Asset marked `status="failed"`, `errorMessage="Failed to fetch: <status> <statusText>"`
- Returns 500 with requestId

## Flow F5: Prepare with GCS Failure

**Scenario:** GCS bucket misconfigured or refusing uploads

**Expected Behavior:**
- Upload stage fails with structured error log
- Asset marked `status="failed"`, `errorMessage=<GCS-error>`
- Returns 500 with requestId

## Flow F6: Prepare with Prisma Failure

**Scenario:** Database connection lost or constraint violation

**Expected Behavior:**
- DB update stage fails with structured error log
- Error boundary catches, logs with full context
- Returns 500 with requestId
- Asset may remain in `processing` state (recoverable via processor)

## Flow F7: Storefront with Prepared Asset

**Scenario:** Product has prepared asset, user opens modal

**Expected Behavior:**
- `/app-proxy/product.prepared` returns preparedImageUrl
- Modal displays prepared product image
- User can proceed with room image upload and render

## Flow F8: Storefront without Prepared Asset

**Scenario:** Product has no prepared asset or status is failed

**Expected Behavior:**
- `/app-proxy/product.prepared` returns appropriate error/status
- UI shows message prompting admin to prepare product first
- User cannot proceed with render

## Pipeline Stage Contracts

### Stage: download
- **Input:** sourceImageUrl (string)
- **Output:** Buffer (non-empty, 0 < size < 50MB)
- **Failure:** Throw Error with message, log with stage="download"

### Stage: convert
- **Input:** Buffer (any image format)
- **Output:** Buffer (PNG format, validated > 0 bytes)
- **Failure:** Throw Error, log with stage="convert"

### Stage: bg-remove
- **Input:** Buffer (PNG), mimeType: 'image/png'
- **Output:** Buffer (PNG with transparency)
- **Failure:** Try fallback (JPEG), then throw Error, log with stage="bg-remove"

### Stage: upload
- **Input:** Buffer (PNG), key (string), contentType: 'image/png'
- **Output:** signedUrl (string, valid for 1 hour)
- **Failure:** Throw Error, log with stage="upload", bucket, key

### Stage: db-update
- **Input:** assetId, status, preparedImageUrl (or errorMessage)
- **Output:** Updated ProductAsset record
- **Failure:** Throw Error, log with stage="db-update", attempt recovery





