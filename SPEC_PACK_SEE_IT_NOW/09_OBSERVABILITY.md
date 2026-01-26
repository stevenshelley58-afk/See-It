# 09 — Observability

## Purpose
This document specifies logging, request tracing, metrics, monitoring tables, and health check requirements.

---

## Request ID Propagation

Every request must have a unique ID for tracing:

```typescript
// utils/request-context.server.ts

export function getRequestId(request: Request): string {
  const existingId = request.headers.get("x-request-id");
  if (existingId) return existingId;
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
```

---

## Logger Configuration

```typescript
// utils/logger.server.ts

import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createLogContext(
  operation: string,
  requestId: string,
  stage: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { operation, requestId, stage, ...extra };
}
```

---

## Monitoring Tables (2-LLM Pipeline)

### CompositeRun Table

Provides full lineage tracking for every See It Now render request.

```prisma
model CompositeRun {
  id                String   @id @default(uuid())
  shopId            String   @map("shop_id")
  productAssetId    String   @map("product_asset_id")
  roomSessionId     String   @map("room_session_id")
  requestId         String   @map("request_id")
  pipelineVersion Int      @map("pipeline_version")
  model             String
  
  // Image hashes for deduplication
  productImageHash  String   @map("product_image_hash")
  productImageMeta  Json     @map("product_image_meta")
  roomImageHash     String   @map("room_image_hash")
  roomImageMeta     Json     @map("room_image_meta")
  
  // Prompt tracking (full snapshots)
  resolvedFactsHash String   @map("resolved_facts_hash")
  resolvedFactsJson Json     @map("resolved_facts_json")
  pipelineConfigHash    String   @map("prompt_pack_hash")
  placementSetSnapshot    Json     @map("prompt_pack_json")
  
  // Results
  totalDurationMs   Int?     @map("total_duration_ms")
  status            String   // "complete" | "partial" | "failed"
  
  createdAt         DateTime @default(now()) @map("created_at")
  
  @@map("composite_runs")
}
```

### CompositeVariant Table

One record per variant per CompositeRun.

```prisma
model CompositeVariant {
  id              String   @id @default(uuid())
  renderRunId     String   @map("composite_run_id")
  variantId       String   @map("variant_id")  // "V01" through "V08"
  finalPromptHash String   @map("final_prompt_hash")
  status          String   // "success" | "failed" | "timeout"
  latencyMs       Int      @map("latency_ms")
  outputImageKey  String?  @map("output_image_key")
  outputImageHash String?  @map("output_image_hash")
  errorMessage    String?  @map("error_message")
  
  createdAt       DateTime @default(now()) @map("created_at")
  
  @@map("composite_variants")
}
```

### PromptVersion Table

Tracks prompt configuration versions for reproducibility.

```prisma
model PromptVersion {
  id             String   @id @default(uuid())
  version        Int      @unique
  globalHash     String   @map("global_hash")
  extractorHash  String   @map("extractor_hash")
  builderHash    String   @map("builder_hash")
  configSnapshot Json     @map("config_snapshot")
  createdAt      DateTime @default(now()) @map("created_at")
  
  @@map("prompt_versions")
}
```

---

## Monitor Admin UI

### Route: /app/monitor

Displays CompositeRun history with:
- DataTable with filters (status, version)
- Pagination
- Modal to view run details

### Route: /api/monitor/run/:id

Returns CompositeRun details with:
- All variant results
- Signed URLs for variant images
- resolvedFactsJson and placementSetSnapshot

---

## Log Stages

### See It Now Render (2-LLM Pipeline)

| Stage | Level | Message |
|-------|-------|---------|
| `see-it-now-start` | info | Render starting |
| `auth` | warn | Auth failed |
| `allowlist` | info | Allowlist check |
| `shop-lookup` | error | Shop not found |
| `product-check` | warn | Product not enabled |
| `pipeline-check` | warn | Pipeline data missing |
| `download` | info | Downloading image |
| `render-start` | info | Starting variant renders |
| `variant-{id}` | info | Variant rendering |
| `variant-{id}-complete` | info | Variant completed |
| `variant-{id}-failed` | error | Variant failed |
| `upload` | info | Uploading variant |
| `see-it-now-complete` | info | Render complete |
| `see-it-now-error` | error | Render failed |

### Product Preparation (2-LLM Pipeline)

| Stage | Level | Message |
|-------|-------|---------|
| `prompt-version-failed` | warn | Version check failed |
| `extraction-complete` | info | LLM #1 complete |
| `extraction-failed` | warn | LLM #1 failed |
| `prompt-pack-complete` | info | LLM #2 complete |
| `prompt-pack-failed` | warn | LLM #2 failed |

---

## Log Format

```json
{
  "level": "info",
  "time": "2024-01-15T10:30:00.000Z",
  "operation": "render",
  "requestId": "req_1705315800_abc123",
  "stage": "see-it-now-complete",
  "shopId": "shop-uuid",
  "productId": "12345",
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "durationMs": 12500,
  "variantCount": 8,
  "successCount": 7,
  "status": "partial",
  "msg": "[See It Now] Render complete: 7/8 variants, 12500ms, status=partial"
}
```

---

## Session Event Logging

```typescript
// services/session-logger.server.ts

interface SeeItNowEvent {
  sessionId: string;       // run_id for v2
  shop: string;
  productId?: string;
  roomSessionId?: string;
  step?: string;
  variantCount?: number;
  variantIds?: string[];
  durationMs?: number;
  selectedVariantId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export function logSeeItNowEvent(
  eventType: string,
  data: SeeItNowEvent
): void {
  logger.info({
    eventType,
    ...data,
    timestamp: new Date().toISOString(),
  }, `[See It Now Event] ${eventType}`);
}
```

Event types:
- `session_started`
- `room_uploaded`
- `variants_generated` — includes variant count and IDs
- `variant_selected`
- `error` — includes errorCode and errorMessage

---

## Health Check Endpoint

```typescript
// routes/healthz.ts

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const checks: Record<string, boolean> = {};
  
  // Database check
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }
  
  // GCS check
  try {
    const storage = getGcsClient();
    await storage.bucket(GCS_BUCKET).exists();
    checks.storage = true;
  } catch {
    checks.storage = false;
  }
  
  const healthy = Object.values(checks).every(Boolean);
  
  return json({
    status: healthy ? "healthy" : "unhealthy",
    checks,
    timestamp: new Date().toISOString(),
  }, { status: healthy ? 200 : 503 });
};
```

---

## Metrics to Track

### Request Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `see_it_now_render_requests` | Counter | shop, status |
| `see_it_now_render_duration_ms` | Histogram | shop |
| `see_it_now_variant_success_rate` | Gauge | shop |
| `see_it_now_errors` | Counter | shop, error_code, variant_id |

### Pipeline Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `extraction_success_rate` | Gauge | LLM #1 success rate |
| `prompt_build_success_rate` | Gauge | LLM #2 success rate |
| `variant_latency_ms` | Histogram | Per-variant render time |
| `variant_status` | Counter | By variant_id and status |

### Business Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `room_sessions_created` | Counter | New room sessions |
| `variants_generated` | Counter | Total variants produced |
| `variants_selected` | Counter | User selections |
| `upscale_requests` | Counter | Pro model upscales |

---

## Query Examples

### Find all variants for a render run

```sql
SELECT * FROM composite_variants 
WHERE composite_run_id = 'uuid-here'
ORDER BY variant_id;
```

### Calculate variant success rate by ID

```sql
SELECT 
  variant_id,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
  ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM composite_variants
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY variant_id
ORDER BY variant_id;
```

### Find failed variants with errors

```sql
SELECT 
  rr.id as run_id,
  vr.variant_id,
  vr.error_message,
  vr.latency_ms,
  rr.created_at
FROM composite_variants vr
JOIN composite_runs rr ON vr.composite_run_id = rr.id
WHERE vr.status = 'failed'
AND rr.created_at > NOW() - INTERVAL '1 hour'
ORDER BY rr.created_at DESC;
```

### Average duration by prompt version

```sql
SELECT 
  pipeline_version,
  AVG(total_duration_ms) as avg_duration_ms,
  COUNT(*) as render_count
FROM composite_runs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY pipeline_version
ORDER BY pipeline_version DESC;
```

---

## Alerting Thresholds

| Condition | Threshold | Severity |
|-----------|-----------|----------|
| Health check failing | 3 consecutive | Critical |
| Error rate | > 10% in 5 min | Warning |
| Error rate | > 25% in 5 min | Critical |
| Render duration | > 60s p95 | Warning |
| Variant success rate (any V0X) | < 50% | Warning |
| Variant success rate (all) | < 25% | Critical |
| LLM #1 extraction failures | > 20% | Warning |
| LLM #2 build failures | > 20% | Warning |
| Database connection errors | Any | Critical |

---

## Environment Variables

```bash
# Log level
LOG_LEVEL=info  # debug | info | warn | error

# External monitoring (optional)
MONITOR_URL=https://your-monitor.example.com
MONITOR_API_KEY=your-api-key
```
