# External Operator API

The External Operator API provides programmatic access to See It monitoring data (runs, events, artifacts, shops).

## Base URL

```
https://<your-app-domain>/external/v1
```

## Authentication

All endpoints require Bearer token authentication:

```
Authorization: Bearer <MONITOR_API_TOKEN>
```

The token is configured via the `MONITOR_API_TOKEN` environment variable.

### Reveal mode (sensitive data)

Some data is hidden or redacted by default. To request revealed data, include:

```
X-Monitor-Reveal: <MONITOR_REVEAL_TOKEN>
```

If the reveal token is missing/invalid, responses remain redacted (no error).

## CORS

Browser requests require the request `Origin` to be whitelisted in `MONITOR_ALLOWED_ORIGINS` (comma-separated).

Requests without an `Origin` header (curl/server-to-server) are allowed without CORS headers.

## Rate limiting

- **100 requests per minute** per token+IP combination
- **300 requests per minute** global limit
- Returns `429 Too Many Requests` with `Retry-After` header (seconds) when exceeded

---

## Endpoints

### GET /external/v1/health

Global health statistics across all shops.

**Response:**

```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "failureRate1h": 0.05,
  "failureRate24h": 0.03,
  "totalRuns1h": 150,
  "totalRuns24h": 2400,
  "latencyP50": 1250,
  "latencyP95": 3500,
  "providerErrors24h": 12,
  "storageErrors24h": 3
}
```

---

### GET /external/v1/runs

Paginated list of runs (cursor-based).

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | - | Cursor from previous response |
| `limit` | number | 20 | Results per page (max 100) |
| `status` | string | - | Filter by status: `in_flight`, `complete`, `partial`, `failed` |
| `shopId` | string | - | Filter by shop ID |
| `includeTotal` | boolean | false | Include total count (slower) |

**Response:**

```json
{
  "runs": [
    {
      "id": "run_abc123",
      "createdAt": "2024-01-15T10:30:00Z",
      "shopId": "shop_xyz",
      "shopDomain": "example.myshopify.com",
      "productTitle": "My Product",
      "productId": "1234567890",
      "status": "complete",
      "pipelineConfigHash": "c2f3...abcd",
      "totalDurationMs": 5000,
      "variantCount": 8,
      "successCount": 8,
      "failCount": 0,
      "timeoutCount": 0,
      "traceId": "trace_123"
    }
  ],
  "cursor": "eyJpZCI6InJ1bl9hYmMxMjMiLCJjcmVhdGVkQXQiOiIyMDI0LTAxLTE1VDEwOjMwOjAwWiJ9",
  "total": 1500
}
```

Notes:
- `total` is only present when `includeTotal=true`.

---

### GET /external/v1/runs/:id

Get detailed information about a specific run.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Run ID |

**Query Parameters (optional):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `shopId` | string | Extra scoping (must match the run's shop) |

**Response (redacted by default):**

```json
{
  "id": "run_abc123",
  "createdAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T10:30:05Z",
  "traceId": "trace_123",
  "shopId": "shop_xyz",
  "shopDomain": "example.myshopify.com",
  "productAssetId": "pa_001",
  "productTitle": "My Product",
  "productId": "1234567890",
  "roomSessionId": null,
  "status": "complete",
  "pipelineConfigHash": "c2f3...abcd",
  "totalDurationMs": 5000,
  "successCount": 8,
  "failCount": 0,
  "timeoutCount": 0,
  "variants": [
    {
      "id": "cv_001",
      "variantId": "V01",
      "status": "success",
      "latencyMs": 1200,
      "providerMs": null,
      "uploadMs": null,
      "errorCode": null,
      "errorMessage": null,
      "imageUrl": "https://storage.googleapis.com/...signed...",
      "imageRef": "products/shop_xyz/.../v01.png",
      "imageHash": "abc..."
    }
  ],
  "llmCalls": []
}
```

When reveal is enabled (`X-Monitor-Reveal`), these snapshots may be included:
- `resolvedFactsSnapshot`
- `placementSetSnapshot`
- `pipelineConfigSnapshot`

---

### GET /external/v1/runs/:id/events

Get timeline events for a specific run.

**Query Parameters (optional):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `shopId` | string | Extra scoping (must match the run's shop) |

**Response:**

```json
{
  "events": [
    {
      "id": "evt_001",
      "ts": "2024-01-15T10:30:00Z",
      "source": "renderer",
      "type": "variant_started",
      "severity": "info",
      "variantId": "V01",
      "payload": { "message": "..." },
      "overflowArtifactId": null
    }
  ]
}
```

Redaction behavior:
- Without reveal, sensitive keys are removed from `payload`.
- Without reveal, very large payloads may be replaced with a small object containing `__monitor_truncated`.

---

### GET /external/v1/runs/:id/artifacts

Get artifacts (images, bundles, payloads) for a specific run.

**Query Parameters (optional):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `shopId` | string | Extra scoping (must match the run's shop) |

**Response:**

```json
{
  "artifacts": [
    {
      "id": "art_001",
      "ts": "2024-01-15T10:30:05Z",
      "createdAt": "2024-01-15T10:30:05Z",
      "type": "variant_output",
      "contentType": "image/png",
      "byteSize": 12345,
      "width": 1024,
      "height": 768,
      "dimensions": { "width": 1024, "height": 768 },
      "sha256": "abc...def",
      "url": "https://storage.googleapis.com/...signed..."
    }
  ]
}
```

Notes:
- Without reveal, sensitive artifact types/retention classes are excluded.
- `url` may be `null` if signing fails (or if the artifact is hidden).

---

### GET /external/v1/artifacts/:id

Get a single artifact by ID.

Sensitive artifacts are hidden unless reveal is enabled.

**Query Parameters (optional):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `shopId` | string | Extra scoping (must match the artifact's shop) |

**Response:** a single artifact object (same shape as items in `/runs/:id/artifacts`).

---

### GET /external/v1/shops

Paginated list of shops with aggregate statistics.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | - | Cursor from previous response |
| `limit` | number | 50 | Results per page (max 200) |
| `windowDays` | number | 7 | Days to include in stats (max 30) |
| `includeTotal` | boolean | false | Include total count (slower) |

**Response:**

```json
{
  "shops": [
    {
      "shopId": "shop_xyz",
      "shopDomain": "example.myshopify.com",
      "runsInWindow": 150,
      "successRateInWindow": 95.0,
      "lastRunAt": "2024-01-15T10:30:00Z"
    }
  ],
  "cursor": "eyJpZCI6InNob3BfeHl6In0=",
  "total": 42
}
```

Notes:
- `successRateInWindow` is a percentage (0-100).
- `total` is only present when `includeTotal=true`.

---

### GET /external/v1/shops/:id

Get detail for a specific shop.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `recentRunsLimit` | number | 10 | Number of recent runs (max 20) |

**Response:**

```json
{
  "shop": {
    "shopId": "shop_xyz",
    "shopDomain": "example.myshopify.com",
    "plan": "basic",
    "createdAt": "2023-06-01T00:00:00Z"
  },
  "recentRuns": [],
  "topErrors": [
    { "message": "timeout", "count": 15 }
  ],
  "health": {
    "failureRate1h": 0,
    "failureRate24h": 0,
    "failureRate7d": 0,
    "totalRuns1h": 0,
    "totalRuns24h": 0,
    "totalRuns7d": 0,
    "latencyP50": null,
    "latencyP95": null,
    "providerErrors24h": 0,
    "storageErrors24h": 0
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "details": { }
}
```

Common error codes:

| Code | Status | Description |
|------|--------|-------------|
| `unauthorized` | 401 | Missing or invalid Bearer token |
| `forbidden` | 403 | Origin not allowed (CORS) |
| `not_found` | 404 | Resource not found |
| `rate_limited` | 429 | Too many requests |
| `bad_request` | 400 | Invalid parameters |
| `internal_error` | 500 | Server error |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONITOR_API_TOKEN` | Yes | Bearer token for API authentication |
| `MONITOR_REVEAL_TOKEN` | No | Token to reveal sensitive data |
| `MONITOR_ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins |

