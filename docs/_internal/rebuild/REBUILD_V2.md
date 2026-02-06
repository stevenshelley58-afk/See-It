# See It - Rebuild v2 (Quality-First Architecture)

> **Thesis v2:** This isn't over-engineered - it's under-integrated. You need the observability and control, but it should work *for* you instead of against you.

## The Real Problem

You have a 2-stage AI pipeline with black-box inputs:

```
Merchant Product Data → [LLM #1: Facts Extraction] → [LLM #2: Placement] → Composite
        │                                                    │
        ▼                                                    ▼
    Unknown quality                                   Unknown quality
    Unknown why it fails                              Unknown why it fails
```

**Without traceability:**
- Customer gets bad composite
- You can't reproduce it
- You can't see what the LLM "saw"
- You can't iterate prompts effectively
- You're flying blind

**The current system tried to solve this but got the abstraction wrong.**

---

## New Core Insight: Pipeline as a Debuggable System

Don't strip the observability - make it **first-class and actionable**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PIPELINE WITH FULL TRACE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   INPUT              STAGE 1                 STAGE 2                OUTPUT  │
│   ─────              ───────                 ──────                 ──────  │
│                                                                             │
│   Product ──────▶  Extract Facts  ──────▶  Build Placement  ───▶  Render   │
│   Image              (LLM #1)                (LLM #2)             Image     │
│   Metadata                                                                  │
│                                                                             │
│      │                 │                       │                   │        │
│      ▼                 ▼                       ▼                   ▼        │
│   ┌───────┐        ┌───────┐             ┌───────┐           ┌───────┐     │
│   │SHA-256│        │Prompt │             │Prompt │           │Final  │     │
│   │Hash   │        │Used   │             │Used   │           │Image  │     │
│   │       │        │Model  │             │Model  │           │Hash   │     │
│   └───────┘        │Output │             │Output │           └───────┘     │
│                    │Facts  │             │Coords │                         │
│                    │JSON   │             │JSON   │                         │
│                    └───────┘             └───────┘                         │
│                                                                             │
│   All linked by: Run ID + Shop ID + Timestamp + Full Context               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Simplified Architecture: 3 Layers

### Layer 1: Core Pipeline (The "What")

Single file, single responsibility: Run the pipeline, capture everything.

```typescript
// pipeline/composite-run.ts

export interface CompositeRun {
  id: string;                    // ULID, sortable by time
  shopId: string;
  assetId: string;               // Which prepared product
  roomImageKey: string;          // Where the room photo lives
  
  // Inputs (reproducibility)
  input: {
    productFacts: ProductFacts;  // From prep stage
    roomImageHash: string;       // SHA-256 of uploaded image
    merchantOverrides?: PlacementOverride;
  };
  
  // Stage 1: Fact Resolution (if needed, usually cached from prep)
  factResolution?: {
    usedCache: boolean;          // Did we use prep-extracted facts?
    resolvedFacts: ProductFacts;
    resolvedAt: Date;
  };
  
  // Stage 2: Placement Generation
  placement: {
    promptVersion: string;       // Git SHA or prompt hash
    model: string;               // gemini-2.0-flash-exp
    rawRequest: unknown;         // Full API request (for replay)
    rawResponse: unknown;        // Full API response (for debugging)
    parsedResult: PlacementSet;
    latencyMs: number;
    generatedAt: Date;
  };
  
  // Stage 3: Image Composite
  composite: {
    promptVersion: string;
    model: string;
    resultKey: string;           // GCS path to final image
    resultHash: string;          // SHA-256 of output
    latencyMs: number;
    completedAt: Date;
  };
  
  // Outcome
  status: 'pending' | 'placement_generating' | 'compositing' | 'completed' | 'failed';
  error?: {
    stage: string;
    message: string;
    retryable: boolean;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

// Single function: Run the pipeline, capture everything
export async function executeCompositeRun(
  params: RunParams,
  deps: { llm: LLMGateway; storage: Storage; logger: RunLogger }
): Promise<CompositeRun> {
  const run = await createRun(params);
  
  try {
    // Stage 1: Get facts (cached or fresh)
    const facts = await getFacts(run, deps);
    
    // Stage 2: Generate placement
    const placement = await generatePlacement(run, facts, deps);
    
    // Stage 3: Composite image
    const composite = await compositeImage(run, placement, deps);
    
    return await completeRun(run, { facts, placement, composite });
  } catch (error) {
    return await failRun(run, error);
  }
}
```

**Key insight:** One run = one traceable unit. All stages linked. All inputs/outputs captured.

---

### Layer 2: Prompt Control (The "How")

**Not** versioned prompts in the database. **Git-tracked** prompts with runtime selection.

```typescript
// prompts/registry.ts

// Each prompt is a function that takes context and returns the prompt string
// This gives you type safety and testability

export const prompts = {
  // Current production prompts
  factsExtraction: factsExtraction_v2,
  placement: placement_v3,
  composite: composite_v2,
  
  // Experimental (canary)
  factsExtraction_v3_experimental,
  placement_v4_experimental,
} as const;

// Prompt selection logic
export function selectPrompt(
  name: keyof typeof prompts,
  context: { shopId: string; isExperimental: boolean }
): PromptFn {
  // 1. Check shop override (emergency patch)
  const override = await getShopPromptOverride(context.shopId, name);
  if (override) {
    return compilePrompt(override.template);
  }
  
  // 2. Check if shop is in experimental group
  if (context.isExperimental && prompts[`${name}_experimental`]) {
    return prompts[`${name}_experimental`];
  }
  
  // 3. Use production prompt
  return prompts[name];
}

// Each prompt is just a TypeScript function
// Easy to version control, test, and review
function factsExtraction_v2(ctx: FactsContext): string {
  return `
You are analyzing a ${ctx.productType} product.
Title: ${ctx.title}

Extract the following facts...
`;
}
```

**Database schema (minimal):**

```prisma
model PromptOverride {
  id         String   @id @default(uuid())
  shopId     String
  promptName String   // "factsExtraction", "placement", etc.
  template   String   // Full prompt template
  reason     String   // Why this override exists
  createdBy  String   // Who created it
  createdAt  DateTime @default(now())
  expiresAt  DateTime? // Auto-expire experiments
  
  @@unique([shopId, promptName])
}
```

**What's gone:**
- Version tables
- Audit logs (use git history)
- Rollback chains (use git revert)
- Complex runtime config

**What stays:**
- Emergency shop-specific overrides
- Experiment capability via feature flags

---

### Layer 3: Monitor (The "Why")

**Not** a separate service. A **read model** built from the pipeline events.

```typescript
// monitor/types.ts

// The monitor doesn't write, it only reads
// It's a view of the pipeline data optimized for queries

interface RunView {
  id: string;
  shopId: string;
  status: string;
  createdAt: Date;
  
  // Quick summary
  summary: {
    productTitle: string;
    productType: string;
    latencyTotalMs: number;
    hasError: boolean;
  };
  
  // Drill-down available
  stages: {
    facts: { status: string; model: string; latencyMs: number };
    placement: { status: string; promptVersion: string; model: string; latencyMs: number };
    composite: { status: string; promptVersion: string; model: string; latencyMs: number };
  };
  
  // Artifacts for debugging
  artifacts: {
    roomImageUrl: string;      // Signed URL
    productImageUrl: string;   // Signed URL
    resultImageUrl?: string;   // Signed URL
    factsJson?: string;        // Download link
    placementJson?: string;    // Download link
  };
}

// Queries merchants can run
interface MonitorQueries {
  // List runs for a shop
  listRuns(shopId: string, filters: RunFilters): Promise<RunView[]>;
  
  // Get full details of one run
  getRun(runId: string): Promise<RunView>;
  
  // Export for analysis
  exportRuns(shopId: string, dateRange: DateRange): Promise<ExportResult>;
  
  // Quality metrics
  getQualityMetrics(shopId: string, days: number): Promise<{
    totalRuns: number;
    successRate: number;
    avgLatencyMs: number;
    errorBreakdown: Record<string, number>;
  }>;
}
```

**Key design:**
- Monitor data = Pipeline data (same database, same tables)
- Monitor API = Read-only queries against pipeline tables
- No event duplication, no sync issues

---

## Database Schema (Simplified)

**Data retention: Keep everything for now. Storage is cheap. Optimize later.**

```prisma
// ==== CORE PIPELINE ====

model CompositeRun {
  id        String   @id
  shopId    String
  assetId   String
  
  // Status tracking
  status    String   // pending | generating | compositing | completed | failed
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  // Reproducibility: Store the full input state
  inputJson Json     // { productFacts, roomImageHash, merchantOverrides }
  
  // Stage outputs (for debugging)
  factsOutput      Json?   // What the LLM extracted
  placementOutput  Json?   // Raw LLM response
  compositeOutput  Json?   // { resultKey, resultHash }
  
  // Error details
  errorStage   String?
  errorMessage String?
  
  // Timings
  factsLatencyMs      Int?
  placementLatencyMs  Int?
  compositeLatencyMs  Int?
  
  // Audit trail
  promptVersions Json    // { facts: "v2", placement: "v3", composite: "v2" }
  models         Json    // { facts: "gemini-1.5", placement: "gemini-2.0" }
  
  @@index([shopId, createdAt])
  @@index([status, createdAt]) // For worker polling
  @@map("composite_runs")
}

model ProductAsset {
  id          String @id @default(uuid())
  shopId      String
  productId   String
  
  // Prep state
  prepStatus  String   // unprepared | queued | processing | ready | failed
  
  // Prepared assets
  sourceKey      String  // GCS path to original
  preparedKey    String? // GCS path to background-removed
  
  // Cached facts (used in composite runs)
  extractedFacts Json?   // ProductFacts JSON
  extractedAt    DateTime?
  
  // If facts need regeneration
  factsVersion   String?  // Which prompt version extracted these
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([shopId, productId])
  @@index([shopId, prepStatus])
  @@map("product_assets")
}

model PrepJob {
  id        String   @id @default(uuid())
  assetId   String
  status    String   // pending | processing | completed | failed
  
  // Operations as an array (simpler than separate table)
  operations Json[]   // [{ type: "remove-bg", status: "completed", latencyMs: 1234 }, ...]
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([status, createdAt])
  @@map("prep_jobs")
}

// ==== PLATFORM ====

model Shop {
  id           String   @id @default(uuid())
  domain       String   @unique
  accessToken  String   // Encrypted
  
  // Quotas
  plan         String   // free | pro | enterprise
  quotaDaily   Int
  quotaMonthly Int
  
  // Feature flags for this shop
  features     Json     // { experimentalPrompts: false, newModel: true }
  
  createdAt    DateTime @default(now())
  
  @@map("shops")
}

// ==== PROMPT CONTROL (Minimal) ====

model PromptOverride {
  id         String    @id @default(uuid())
  shopId     String
  promptName String    // "factsExtraction", "placement", "composite"
  template   String    // Full prompt text
  reason     String    // Why this exists
  createdBy  String
  createdAt  DateTime  @default(now())
  expiresAt  DateTime?
  
  @@unique([shopId, promptName])
  @@map("prompt_overrides")
}
```

**Total tables: 5** (vs current 20+)

**Data retention policy:**
- **For now:** Keep everything. No archiving.
- **Storage cost:** ~10KB per run * 1000 runs/day * 365 days = 3.6GB/year. Negligible.
- **Optimize later:** Add archiving when you have >1M runs or storage becomes expensive.

---

## Worker Simplification

**Current:** Complex state machine, cron polling, race conditions

**New:** Queue-based with idempotency

```typescript
// workers/prep-worker.ts

import { Queue } from 'bullmq'; // or SQS, or simple polling

interface PrepJob {
  assetId: string;
  operations: PrepOperation[];
}

export async function processPrepJob(job: PrepJob) {
  // Idempotency: Check if already done
  const asset = await db.productAsset.findById(job.assetId);
  if (asset.prepStatus === 'ready') {
    return { status: 'already_complete' };
  }
  
  await db.productAsset.update(job.assetId, { prepStatus: 'processing' });
  
  try {
    for (const op of job.operations) {
      await executeOperation(op, asset);
    }
    
    await db.productAsset.update(job.assetId, { 
      prepStatus: 'ready',
      extractedFacts: await extractFacts(asset),
      extractedAt: new Date(),
    });
    
  } catch (error) {
    await db.productAsset.update(job.assetId, { 
      prepStatus: 'failed',
    });
    throw error;
  }
}

// Each operation is idempotent
async function executeOperation(op: PrepOperation, asset: ProductAsset) {
  // Check if already done (by looking at asset state)
  if (op.type === 'remove-background' && asset.preparedKey) {
    return; // Already done
  }
  
  // Do the work
  // Store result
}
```

---

## The Debug Flow (What You Actually Need)

**Scenario:** Customer complains about bad composite.

**Current flow:**
1. Dig through logs
2. Try to correlate timestamps
3. Guess which prompt version was used
4. Can't reproduce

**New flow:**
1. Find customer's run in Monitor (by shop + time range)
2. Click into Run View
3. See full pipeline:
   - Input product data
   - Extracted facts (what LLM #1 "saw")
   - Placement output (where LLM #2 said to put it)
   - Final image
4. Download raw LLM requests/responses for local testing
5. Create prompt override for that shop if needed
6. Re-run with new prompt to verify fix

**All in one view. All linked. All reproducible.**

---

## File Structure (Flat, Clear)

```
src/
├── pipeline/
│   ├── composite-run.ts       # Core run execution
│   ├── facts-extraction.ts    # LLM #1
│   ├── placement-generation.ts # LLM #2
│   └── image-composite.ts     # Final render
│
├── prompts/
│   ├── registry.ts            # Prompt selection logic
│   ├── facts-extraction/      # Git-tracked prompt versions
│   │   ├── v1.ts
│   │   ├── v2.ts              # Current
│   │   └── v3-experimental.ts
│   ├── placement/
│   └── composite/
│
├── prep/
│   ├── job-queue.ts           # Background job logic
│   ├── background-removal.ts  # PhotoRoom integration
│   └── fact-extractor.ts      # LLM for facts
│
├── monitor/
│   ├── queries.ts             # Read model queries
│   └── views.ts               # View types
│
├── platform/
│   ├── auth.ts
│   ├── storage.ts
│   ├── llm.ts                 # LLM gateway
│   └── db.ts
│
├── routes/
│   ├── admin/                 # Merchant UI
│   ├── proxy/                 # Shopper-facing (app proxy)
│   ├── external/              # API for monitoring
│   └── webhooks/              # Shopify webhooks
│
└── workers/
    ├── prep.ts
    └── render.ts
```

---

## Migration Path (Strangler Fig)

Don't rebuild everything. Replace one piece at a time.

**Phase 1: New Composite Run (Week 1)**
- Create new `CompositeRun` table with full traceability
- Route new renders through it (behind flag)
- Keep old system for fallback

**Phase 2: New Monitor (Week 2)**  
- Build monitor queries on top of new `CompositeRun` table
- Remove old monitor service

**Phase 3: Prompt Simplification (Week 3)**
- Move prompts to code + minimal overrides
- Remove prompt control tables

**Phase 4: Prep Simplification (Week 4)**
- Replace prep processor with queue-based workers
- Remove old job tables

**Phase 5: Cleanup**
- Remove deprecated tables and code

---

## What Stays vs What Goes

| Component | Current | New | Rationale |
|-----------|---------|-----|-----------|
| **Prompt versioning** | Complex DB tables | Git-tracked + minimal overrides | You need control, not bureaucracy |
| **Audit logs** | Separate table | Git history | Code changes are audited |
| **Monitor** | Separate service | Read model on same DB | Same data, simpler ops |
| **Run traceability** | Partial | Full capture of all I/O | Essential for debugging |
| **Prep processor** | Cron polling | Queue workers | Reliability |
| **Prep operations** | Complex state machine | Idempotent operations | Simplicity |
| **Composite pipeline** | 2 LLM calls in one | Same, but fully instrumented | Same functionality, better visibility |
| **Data retention** | Complex archiving | Keep everything | Storage is cheap, optimize later |

---

## Success Metrics (Revised)

| Metric | Current | Target |
|--------|---------|--------|
| Time to debug a bad composite | Hours | Minutes |
| Ability to reproduce any run | No | Yes (full input capture) |
| Emergency prompt patch | DB migration | 1-line override |
| Tables | 20+ | 5 |
| Services | 2 (app + monitor) | 1 |
| Lines of code | ~15K | ~5K |
| Confidence in changes | Low | High (tests + traceability) |
| Data retention complexity | High | None (keep everything) |

---

## The Bottom Line

**Keep:**
- Full traceability (you need this)
- Prompt control (you need this)
- Quality monitoring (you need this)
- All historical data (storage is cheap, insights are valuable)

**Delete:**
- Over-complicated abstractions
- Separate services for same data
- Database tables that track what git should track
- Archiving complexity (add when needed)

**Result:** Same observability, 1/3 the code, 1/5 the tables, no sync issues, all data preserved.
