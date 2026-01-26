# External Operator API

The External Operator API provides programmatic access to See It render monitoring data.

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

### Reveal Mode

Some endpoints redact sensitive data by default. To reveal sensitive fields, include:

```
X-Monitor-Reveal: <MONITOR_REVEAL_TOKEN>
```

The reveal token is configured via the `MONITOR_REVEAL_TOKEN` environment variable.

## CORS

Browser requests require the origin to be whitelisted in `MONITOR_ALLOWED_ORIGINS` (comma-separated).

## Rate Limiting

- **100 requests per minute** per token+IP combination
- **300 requests per minute** global limit
- Returns `429 Too Many Requests` with `Retry-After` header when exceeded

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
  "errors": [
    { "message": "timeout", "count": 5 }
  ]
}
```

---

### GET /external/v1/runs

Paginated list of runs with cursor-based pagination.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | - | Pagination cursor from previous response |
| `limit` | number | 20 | Results per page (max 100) |
| `status` | string | - | Filter by status: `pending`, `running`, `completed`, `failed` |
| `shopId` | string | - | Filter by shop ID |
| `includeTotal` | boolean | false | Include total count (slower) |

**Response:**

```json
{
  "runs": [
    {
      "id": "run_abc123",
      "shopId": "shop_xyz",
      "shopDomain": "example.myshopify.com",
      "status": "completed",
      "createdAt": "2024-01-15T10:30:00Z",
      "completedAt": "2024-01-15T10:30:05Z",
      "durationMs": 5000
    }
  ],
  "pagination": {
    "cursor": "eyJpZCI6InJ1bl9hYmMxMjMiLCJjcmVhdGVkQXQiOiIyMDI0LTAxLTE1VDEwOjMwOjAwWiJ9",
    "hasMore": true,
    "total": 1500
  }
}
```

---

### GET /external/v1/runs/:id

Get detailed information about a specific run.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Run ID |

**Response:**

```json
{
  "id": "run_abc123",
  "shopId": "shop_xyz",
  "shopDomain": "example.myshopify.com",
  "requestId": "req_def456",
  "status": "completed",
  "createdAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T10:30:05Z",
  "durationMs": 5000,
  "variants": [...],
  "resolvedFactsJson": null,
  "promptPackJson": null
}
```

**Redaction (without X-Monitor-Reveal):**
- `resolvedFactsJson` and `promptPackJson` are omitted

**With X-Monitor-Reveal:**
- All fields included

---

### GET /external/v1/runs/:id/events

Get events (timeline) for a specific run.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Run ID |

**Response:**

```json
{
  "runId": "run_abc123",
  "events": [
    {
      "id": "evt_001",
      "type": "render_start",
      "timestamp": "2024-01-15T10:30:00Z",
      "data": { ... }
    }
  ]
}
```

**Redaction (without X-Monitor-Reveal):**
- Sensitive keys removed from event data: `prompt`, `roomUrl`, `headers`, `authorization`, `token`, `apiKey`, `secret`, `password`, `credential`

---

### GET /external/v1/runs/:id/artifacts

Get artifacts (images, debug bundles) for a specific run.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Run ID |

**Response:**

```json
{
  "runId": "run_abc123",
  "artifacts": [
    {
      "id": "art_001",
      "type": "output_image",
      "url": "https://storage.example.com/output.jpg",
      "createdAt": "2024-01-15T10:30:05Z"
    }
  ]
}
```

**Redaction (without X-Monitor-Reveal):**
- Artifact types excluded: `room_input`, `debug_bundle`, `provider_payload`

**Note:** Output images are ALWAYS included (not considered sensitive).

---

### GET /external/v1/shops

Paginated list of shops with aggregate statistics.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | - | Pagination cursor |
| `limit` | number | 50 | Results per page (max 200) |
| `windowDays` | number | 7 | Days to include in stats (max 30) |
| `includeTotal` | boolean | false | Include total count |

**Response:**

```json
{
  "shops": [
    {
      "shopId": "shop_xyz",
      "shopDomain": "example.myshopify.com",
      "runsInWindow": 150,
      "successRateInWindow": 0.95,
      "lastRunAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "cursor": "eyJpZCI6InNob3BfeHl6In0=",
    "hasMore": true,
    "total": 42
  }
}
```

---

### GET /external/v1/shops/:id

Get detailed information about a specific shop.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Shop ID |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `recentRunsLimit` | number | 10 | Number of recent runs (max 20) |

**Response:**

```json
{
  "shop": {
    "id": "shop_xyz",
    "shopDomain": "example.myshopify.com",
    "createdAt": "2023-06-01T00:00:00Z"
  },
  "stats": {
    "totalRuns": 5000,
    "successRate7d": 0.95,
    "avgDurationMs": 3500
  },
  "recentRuns": [...],
  "topErrors": [
    { "message": "timeout", "count": 15 }
  ]
}
```

**Error Normalization:**
- Error messages are normalized: lowercase, digits replaced with `#`, UUIDs removed

---

## Error Responses

All errors follow this format:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "details": { ... }
}
```

**Error Codes:**

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

---

## Example Usage

### curl

```bash
# Health check
curl -H "Authorization: Bearer $TOKEN" \
  https://your-app.com/external/v1/health

# List runs with pagination
curl -H "Authorization: Bearer $TOKEN" \
  "https://your-app.com/external/v1/runs?limit=10"

# Get run detail with sensitive data
curl -H "Authorization: Bearer $TOKEN" \
  -H "X-Monitor-Reveal: $REVEAL_TOKEN" \
  https://your-app.com/external/v1/runs/run_abc123

# List shops
curl -H "Authorization: Bearer $TOKEN" \
  "https://your-app.com/external/v1/shops?windowDays=14"
```

### JavaScript

```javascript
const API_BASE = 'https://your-app.com/external/v1';
const TOKEN = process.env.MONITOR_API_TOKEN;

async function getHealth() {
  const response = await fetch(`${API_BASE}/health`, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
    },
  });
  return response.json();
}

async function listRuns(cursor = null) {
  const url = new URL(`${API_BASE}/runs`);
  url.searchParams.set('limit', '50');
  if (cursor) url.searchParams.set('cursor', cursor);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
    },
  });
  return response.json();
}
```
