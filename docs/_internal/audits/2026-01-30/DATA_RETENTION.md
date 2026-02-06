# Data Retention Strategy

> **Principle:** Keep metadata forever (it's small), archive images aggressively (they're big), and let the user export before deletion.

---

## The Data Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA LIFECYCLE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  HOT (7 days)          WARM (90 days)         COLD (1 year)        ARCHIVE  │
│  ─────────────         ──────────────         ───────────         ───────── │
│                                                                             │
│  ┌───────────┐         ┌───────────┐          ┌───────────┐       ┌────────┐│
│  │ Full run  │   ──▶   │ Metadata  │   ──▶    │ Metadata  │  ──▶  │ Stats  ││
│  │ records   │         │ only      │          │ + export  │       │ only   ││
│  │ Images    │         │ GCS 30d   │          │ link      │       │        ││
│  │ available │         │           │          │           │       │        ││
│  └───────────┘         └───────────┘          └───────────┘       └────────┘│
│                                                                             │
│  Query: ms             Query: 100ms           Query: 5s            N/A      │
│  Storage: $$           Storage: $             Storage: $           Free     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tier 1: Hot Data (0-7 days)

**What's kept:** Everything

```prisma
// PostgreSQL - full detail
model CompositeRun {
  id        String   @id
  shopId    String
  status    String
  
  // Full inputs (for immediate reproduction)
  inputJson        Json    // ~5KB
  factsOutput      Json?   // ~3KB
  placementOutput  Json?   // ~2KB
  compositeOutput  Json?   // ~1KB
  
  // Error details
  errorStage   String?
  errorMessage String?
  
  // Audit
  promptVersions Json
  models         Json
  
  createdAt DateTime @default(now())
  
  @@index([shopId, createdAt])
  @@index([createdAt]) // For cleanup queries
}
```

**Images:** GCS with 7-day lifecycle
- Room photos, product images, results
- Signed URLs on-demand

**Use case:**
- Customer complaints about recent renders
- Debugging yesterday's issues
- Immediate quality analysis

---

## Tier 2: Warm Data (7-90 days)

**What's kept:** Metadata only (no images)

```prisma
// PostgreSQL - compressed metadata
model CompositeRunArchive {
  id        String   @id
  shopId    String
  status    String
  
  // Compressed summary (not full JSON)
  summary Json  // {
                //   productType: "chair",
                //   factsExtraction: { model: "gemini-1.5", latencyMs: 1200 },
                //   placement: { promptVersion: "v3", model: "gemini-2.0", latencyMs: 800 },
                //   error: null
                // }
  
  // Link to cold storage if user exported
  exportUrl String?  // GCS link to full data
  
  createdAt DateTime
  archivedAt DateTime @default(now())
  
  @@index([shopId, createdAt])
  @@index([archivedAt]) // For cleanup
}
```

**Images:** Deleted (GCS lifecycle policy)
- Room photos: auto-delete after 7 days
- Result images: auto-delete after 30 days (in case merchant wants to download)

**Migration:**
```typescript
// Daily cron job
async function archiveOldRuns() {
  const cutoff = subDays(new Date(), 7);
  
  const oldRuns = await db.compositeRun.findMany({
    where: { createdAt: { lt: cutoff } },
    take: 1000, // Batch
  });
  
  for (const run of oldRuns) {
    // Compress to summary
    const summary = compressRun(run);
    
    await db.compositeRunArchive.create({
      data: {
        id: run.id,
        shopId: run.shopId,
        status: run.status,
        summary,
        createdAt: run.createdAt,
      }
    });
    
    // Delete full record
    await db.compositeRun.delete({ where: { id: run.id } });
  }
}
```

**Use case:**
- Trends over past month
- "How many failures did we have last week?"
- Pattern analysis (which product types fail most)

---

## Tier 3: Cold Data (90 days - 1 year)

**What's kept:** Minimal stats + user exports

```prisma
// PostgreSQL - minimal
model CompositeRunCold {
  id        String   @id
  shopId    String
  status    String
  createdAt DateTime
  
  // Just enough for basic queries
  productType String?
  hasError    Boolean
  totalLatencyMs Int?
  
  // User can request export before this point
  exportRequestedAt DateTime?
  exportUrl         String?
  exportExpiresAt   DateTime?
}
```

**User-initiated export:**
```typescript
// Merchant requests full data for a run
async function exportRun(runId: string) {
  // Check if still in hot/warm
  const hotRun = await db.compositeRun.findById(runId);
  if (hotRun) {
    return generateExport(hotRun);
  }
  
  // Check archive
  const warmRun = await db.compositeRunArchive.findById(runId);
  if (warmRun?.exportUrl) {
    return warmRun.exportUrl;
  }
  
  // Reconstruct from logs if possible
  // Or return "data expired"
  throw new DataExpiredError();
}
```

**Use case:**
- Annual reporting
- "How many renders in Q3?"

---

## Tier 4: Analytics Warehouse (Optional)

For serious analysis, stream events to analytics:

```typescript
// On every run completion
async function trackAnalytics(run: CompositeRun) {
  await analytics.track('render_completed', {
    shop_id: run.shopId,
    product_type: run.input.productType,
    status: run.status,
    latency_facts_ms: run.factsLatencyMs,
    latency_placement_ms: run.placementLatencyMs,
    latency_composite_ms: run.compositeLatencyMs,
    prompt_version: run.promptVersions.placement,
    model: run.models.placement,
    error_type: run.error?.stage,
  });
}
```

**Tools:**
- PostHog (event-based)
- BigQuery (SQL analysis)
- Amplitude (funnels)

**Benefits:**
- SQL queries on historical data
- Funnel analysis
- Cohort retention

---

## GCS Lifecycle Policies

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {
          "age": 7,
          "matchesPrefix": ["rooms/", "temp/"]
        }
      },
      {
        "action": {"type": "Delete"},
        "condition": {
          "age": 30,
          "matchesPrefix": ["results/"]
        }
      },
      {
        "action": {
          "type": "SetStorageClass",
          "storageClass": "COLDLINE"
        },
        "condition": {
          "age": 30,
          "matchesPrefix": ["products/"]
        }
      }
    ]
  }
}
```

| Path Pattern | Retention | Reason |
|--------------|-----------|--------|
| `rooms/` | 7 days | Temporary uploads, not needed after render |
| `temp/` | 7 days | Processing artifacts |
| `results/` | 30 days | Final images, merchant might want to download |
| `products/` | 1 year (cold storage) | Prepared assets, can regenerate if needed |

---

## Implementation

### Option 1: Simple (Start Here)

```typescript
// Keep everything for 30 days, then delete
// ~1000 runs/day * 30 days * 10KB = 300MB - totally fine

// Just add a cleanup job
async function cleanupOldRuns() {
  const cutoff = subDays(new Date(), 30);
  
  await db.compositeRun.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });
}
```

### Option 2: Tiered (Scale Later)

```typescript
// Keep full data 7 days, summaries 90 days
// Implement archive table when you hit scale issues
```

### Option 3: Export-First

```typescript
// Before deleting, offer merchant export
async function notifyBeforeArchive(runs: CompositeRun[]) {
  for (const run of runs) {
    // Email merchant: "Your data will be archived in 7 days"
    // Include link to export
  }
}
```

---

## GDPR Compliance

**Right to be forgotten:**

```typescript
async function deleteShopData(shopId: string) {
  // Delete all runs
  await db.compositeRun.deleteMany({ where: { shopId } });
  await db.compositeRunArchive.deleteMany({ where: { shopId } });
  await db.compositeRunCold.deleteMany({ where: { shopId } });
  
  // Delete GCS objects
  await storage.deletePrefix(`shops/${shopId}/`);
  
  // Analytics anonymization
  await analytics.anonymize(shopId);
}
```

**Data export:**
```typescript
async function exportShopData(shopId: string) {
  const runs = await db.compositeRun.findMany({ where: { shopId } });
  const archive = await db.compositeRunArchive.findMany({ where: { shopId } });
  
  return generateGDPRExport({ runs, archive });
}
```

---

## Cost Estimation

Assuming 1000 renders/day:

| Tier | Records | Size Each | Total | PostgreSQL Cost |
|------|---------|-----------|-------|-----------------|
| Hot (7d) | 7,000 | 10KB | 70MB | ~$0 (included) |
| Warm (90d) | 90,000 | 1KB | 90MB | ~$0 (included) |
| Cold (1y) | 365,000 | 100B | 36MB | ~$0 (included) |

**GCS Costs:**
- Images: 1000/day * 30 days retention * 2MB avg = 60GB
- At $0.02/GB = **$1.20/month**

**Conclusion:** Don't over-engineer. Start with 30-day retention, add tiers when you have data showing it's needed.

---

## Recommended Starting Point

```typescript
// Simpler is better - start with this

// Retention config
const RETENTION_DAYS = 30;

// Cleanup job (daily cron)
export async function cleanupOldData() {
  const cutoff = subDays(new Date(), RETENTION_DAYS);
  
  // 1. Delete old runs
  const { count } = await db.compositeRun.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });
  
  // 2. Log for monitoring
  logger.info(`Cleaned up ${count} old runs`);
  
  // 3. GCS cleanup is automatic via lifecycle policy
}

// If merchant needs older data, they can export before deletion
// Or you can offer "long-term storage" as a paid feature
```

Add archive tables **only when**:
- Query performance degrades
- Storage costs become significant
- You need analytics on >90 day old data
