# 07 — Storage Layout

## Purpose
This document specifies the exact GCS (Google Cloud Storage) key patterns, signed URL policies, and CORS configuration.

---

## Bucket Configuration

**Bucket Name**: Set via environment variable `GCS_BUCKET`

Example: `see-it-storage`

---

## Key Patterns

### Room Images

```
rooms/{shopId}/{sessionId}/room.{ext}
rooms/{shopId}/{sessionId}/canonical.jpg
rooms/{shopId}/{sessionId}/cleaned.jpg
```

| Key Pattern | Content | Format |
|-------------|---------|--------|
| `rooms/{shopId}/{sessionId}/room.{ext}` | Original upload | JPEG/PNG/WebP/HEIC |
| `rooms/{shopId}/{sessionId}/canonical.jpg` | Normalized room image | JPEG |
| `rooms/{shopId}/{sessionId}/cleaned.jpg` | Object-removed room | JPEG |

### See It Now Renders (v2 - 2-LLM Pipeline)

```
see-it-now/{runId}/{variantId}.jpg
```

| Key Pattern | Content | Format |
|-------------|---------|--------|
| `see-it-now/{runId}/{variantId}.jpg` | Generated hero shot | JPEG |

Where:
- `runId` = UUID from RenderRun table
- `variantId` = `V01` through `V08`

**Example:**
```
see-it-now/550e8400-e29b-41d4-a716-446655440000/V01.jpg
see-it-now/550e8400-e29b-41d4-a716-446655440000/V02.jpg
see-it-now/550e8400-e29b-41d4-a716-446655440000/V03.jpg
see-it-now/550e8400-e29b-41d4-a716-446655440000/V04.jpg
see-it-now/550e8400-e29b-41d4-a716-446655440000/V05.jpg
see-it-now/550e8400-e29b-41d4-a716-446655440000/V06.jpg
see-it-now/550e8400-e29b-41d4-a716-446655440000/V07.jpg
see-it-now/550e8400-e29b-41d4-a716-446655440000/V08.jpg
```

### Product Assets

```
shops/{shopId}/products/{productId}/prepared-{assetId}.png
```

| Key Pattern | Content | Format |
|-------------|---------|--------|
| `shops/{shopId}/products/{productId}/prepared-{assetId}.png` | Product cutout (transparent) | PNG |

---

## Signed URL Policies

### Upload URLs (Write)

```typescript
const [uploadUrl] = await file.getSignedUrl({
  version: 'v4',
  action: 'write',
  expires: Date.now() + 15 * 60 * 1000,  // 15 minutes
  contentType: contentType,
});
```

### Read URLs

| Purpose | TTL |
|---------|-----|
| Room image | 1 hour |
| Product cutout | 1 hour |
| Generated variant | 1 hour |

```typescript
const [url] = await file.getSignedUrl({
  version: 'v4',
  action: 'read',
  expires: Date.now() + 60 * 60 * 1000,  // 1 hour
});
```

---

## CORS Configuration

File: `gcs-cors.json`

```json
[
  {
    "origin": ["*"],
    "method": ["GET", "PUT", "HEAD", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "Content-Length",
      "Content-Disposition",
      "Cache-Control",
      "x-goog-resumable"
    ],
    "maxAgeSeconds": 3600
  }
]
```

Apply with:

```bash
gsutil cors set gcs-cors.json gs://YOUR_BUCKET_NAME
```

---

## Storage Service API

### uploadBuffer

```typescript
static async uploadBuffer(
  buffer: Buffer,
  key: string,
  contentType: string = 'image/png'
): Promise<string>  // Returns signed read URL
```

### getSignedReadUrl

```typescript
static async getSignedReadUrl(
  key: string,
  expiresInMs: number = 60 * 60 * 1000
): Promise<string>
```

### fileExists

```typescript
static async fileExists(key: string): Promise<boolean>
```

---

## File Size Limits

| Type | Max Size |
|------|----------|
| Room upload (client) | 10 MB |
| Room download (server) | 25 MB |
| Generated image | ~1-5 MB typical |

---

## Environment Variables

```bash
GCS_BUCKET=your-bucket-name
GCS_PROJECT_ID=your-project-id
GCS_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GCS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
