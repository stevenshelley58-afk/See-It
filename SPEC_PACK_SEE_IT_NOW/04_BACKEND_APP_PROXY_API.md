# 04 — Backend App Proxy API

## Purpose
This document specifies the exact API contracts for all storefront-facing app proxy routes. These routes are accessed via Shopify's app proxy at `/apps/see-it/...`.

---

## Route Overview

| Route | Method | Purpose |
|-------|--------|---------|
| `/apps/see-it/room/upload` | POST | Start a room session, get upload URL |
| `/apps/see-it/room/confirm` | POST | Confirm upload, generate canonical image |
| `/apps/see-it/see-it-now/render` | POST | Generate 8 hero shot variants (V01-V08) |
| `/apps/see-it/see-it-now/select` | POST | Record user selection, optionally upscale |

---

## Authentication

All routes use Shopify app proxy authentication:

```typescript
const { session } = await authenticate.public.appProxy(request);
if (!session) {
  return json({ error: "forbidden" }, { status: 403 });
}
```

---

## CORS Headers

All responses must include:

```typescript
function getCorsHeaders(shopDomain: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
  };
  if (shopDomain) {
    headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
  }
  return headers;
}
```

---

## Error Response Format

All errors must return JSON (never HTML):

```typescript
{
  "error": "error_code",
  "message": "Human-readable message"
}
```

**CRITICAL**: Use 4xx status codes for expected failures. Shopify app proxy wraps 5xx responses in HTML.

| Status | When to Use |
|--------|-------------|
| 400 | Missing/invalid request parameters |
| 403 | Auth failed, feature not enabled |
| 404 | Resource not found |
| 422 | Business logic failure (generation failed, pipeline not ready) |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error (avoid if possible) |

---

## POST /apps/see-it/room/upload

### Purpose
Start a new room session and get a presigned upload URL.

### Request
```json
{
  "content_type": "image/jpeg"  // Optional, defaults to "image/jpeg"
}
```

### Response (200 OK)
```json
{
  "room_session_id": "uuid-string",
  "upload_url": "https://storage.googleapis.com/...",
  "room_image_future_url": "https://storage.googleapis.com/...",
  "content_type": "image/jpeg",
  "max_file_size_bytes": 10485760,
  "max_file_size_mb": 10
}
```

---

## POST /apps/see-it/room/confirm

### Purpose
Confirm room image upload and generate canonical (normalized) version.

### Request
```json
{
  "room_session_id": "uuid-string",
  "crop_params": {
    "ratio_label": "16:9",
    "ratio_value": 1.777,
    "crop_rect_norm": { "x": 0.0, "y": 0.1, "w": 1.0, "h": 0.8 }
  }
}
```

### Response (200 OK)
```json
{
  "ok": true,
  "canonical_room_image_url": "https://storage.googleapis.com/...",
  "canonical_width": 1920,
  "canonical_height": 1080,
  "ratio_label": "16:9"
}
```

---

## POST /apps/see-it/see-it-now/render

### Purpose
Generate 8 hero shot visualization variants using the 2-LLM pipeline.

### Architecture
This endpoint uses pre-computed prompt data from the product preparation phase:
1. Fetches `resolvedFacts` and `placementSet` from ProductAsset
2. Calls `renderAllVariants()` which fires 8 parallel Gemini image generation calls
3. Returns successful variants with signed URLs

### Request
```json
{
  "room_session_id": "uuid-string",
  "product_id": "shopify-product-id"
}
```

### Response (200 OK)
```json
{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "complete",
  "variants": [
    {
      "id": "V01",
      "image_url": "https://storage.googleapis.com/...",
      "latency_ms": 4523
    },
    {
      "id": "V02",
      "image_url": "https://storage.googleapis.com/...",
      "latency_ms": 4891
    },
    {
      "id": "V03",
      "image_url": "https://storage.googleapis.com/...",
      "latency_ms": 5102
    },
    {
      "id": "V04",
      "image_url": "https://storage.googleapis.com/...",
      "latency_ms": 4756
    },
    {
      "id": "V05",
      "image_url": "https://storage.googleapis.com/...",
      "latency_ms": 4634
    },
    {
      "id": "V06",
      "image_url": "https://storage.googleapis.com/...",
      "latency_ms": 4988
    },
    {
      "id": "V07",
      "image_url": "https://storage.googleapis.com/...",
      "latency_ms": 5234
    },
    {
      "id": "V08",
      "image_url": "https://storage.googleapis.com/...",
      "latency_ms": 4412
    }
  ],
  "duration_ms": 12500,
  "version": "see-it-now-v2"
}
```

### Variant IDs (V01-V08)

| ID | Intent |
|----|--------|
| V01 | Primary placement, best-guess scale |
| V02 | Primary placement, conservative scale (15-25% smaller) |
| V03 | Primary placement, bold scale (15-25% larger) |
| V04 | Secondary placement, best-guess scale |
| V05 | Secondary placement, conservative scale |
| V06 | Alternative anchor point, best-guess scale |
| V07 | Context-heavy framing, multiple scale references |
| V08 | Maximum realism, conservative choices |

### Errors

| Status | Error Code | Message |
|--------|------------|---------|
| 400 | `invalid_json` | "Request body must be valid JSON" |
| 400 | `missing_room_session` | "room_session_id is required" |
| 400 | `missing_product_id` | "product_id is required" |
| 400 | `no_room_image` | "No room image available" |
| 400 | `no_product_image` | "No product image available" |
| 403 | `forbidden` | N/A |
| 403 | `see_it_now_not_enabled` | "See It Now features are not enabled for this shop" |
| 404 | `shop_not_found` | N/A |
| 404 | `room_not_found` | "Room session not found" |
| 422 | `product_not_enabled` | "This product is not enabled for See It visualization" |
| 422 | `pipeline_not_ready` | "Product prompt data is not ready. Please wait for processing to complete." |
| 422 | `all_variants_failed` | "Failed to generate any variants" |
| 422 | `generation_failed` | (varies) |
| 429 | `rate_limit_exceeded` | "Too many requests. Please wait a moment." |

### Processing Flow

```
1. Validate shop is in See It Now allowlist
2. Rate limit check (per session)
3. Quota check (per shop)
4. Fetch RoomSession and ProductAsset
5. Validate:
   - ProductAsset.status === "live"
   - ProductAsset.resolvedFacts is not null
   - ProductAsset.placementSet is not null
6. Get signed URLs for room and product images
7. Download both images (max 2048px)
8. Build RenderInput object
9. Call renderAllVariants() → 8 parallel Gemini calls
10. Upload successful variants to GCS
11. Write CompositeRun + CompositeVariant records
12. Increment quota
13. Return results
```

### Gemini API Call (per variant)

```typescript
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

const parts = [
  { inlineData: { mimeType: "image/png", data: productBase64 } },
  { inlineData: { mimeType: "image/jpeg", data: roomBase64 } },
  { text: finalPrompt }  // GLOBAL_RENDER_STATIC + productDescription + placementInstruction
];

const result = await model.generateContent({
  contents: [{ role: "user", parts }],
  generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
});
```

### Image Order
1. Product cutout (PNG) — FIRST
2. Room photo (JPEG) — SECOND (determines aspect ratio)
3. Prompt text — LAST

### GCS Key Format
```
see-it-now/{run_id}/{variant_id}.jpg
```

### Partial Success

The endpoint returns whatever variants succeeded:
- **status: "complete"** → All 8 variants succeeded
- **status: "partial"** → 1-7 variants succeeded
- **status: "failed"** → 0 variants succeeded (returns error)

---

## POST /apps/see-it/see-it-now/select

### Purpose
Record which variant the user selected, optionally upscale with Pro model.

### Request
```json
{
  "session_id": "see-it-now_:room_session_id_:timestamp",
  "room_session_id": "uuid-string",
  "selected_variant_id": "V01",
  "selected_image_url": "https://storage.googleapis.com/...",
  "upscale": true,
  "product_id": "12345"
}
```

### Response (200 OK)
```json
{
  "success": true,
  "render_job_id": "uuid-string",
  "selected_variant": "V01",
  "final_image_url": "https://storage.googleapis.com/...",
  "upscaled": true,
  "duration_ms": 3500,
  "version": "see-it-now-v2"
}
```

### Upscale Prompt
```
Enhance this interior photograph to professional quality.
Improve sharpness, detail, and color accuracy while maintaining the exact composition.
Do not change the placement of any objects.
```

Model: `gemini-3-pro-image-preview`

---

## Rate Limiting

Per-session rate limiting:
- Window: 60 seconds
- Max requests: 10

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please wait a moment."
}
// Status: 429
```

---

## Quota Enforcement

```typescript
await checkQuota(shopId, "render", 1);
// After success:
await incrementQuota(shopId, "render", 1);
```

Quota exceeded (402):
```json
{
  "error": "quota_exceeded",
  "message": "Monthly render quota exceeded"
}
```

---

## Allowlist Check

```typescript
if (!isSeeItNowAllowedShop(session.shop)) {
  return json({
    error: "see_it_now_not_enabled",
    message: "See It Now features are not enabled for this shop"
  }, { status: 403 });
}
```

---

## SSRF Protection

All server-side image fetches must validate URLs:

```typescript
validateTrustedUrl(url, "image URL");
```

Trusted domains:
- `storage.googleapis.com`
- `*.storage.googleapis.com`
- `cdn.shopify.com`
- `*.myshopify.com`
