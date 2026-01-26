# 06 — Database Schema

## Purpose
This document specifies the canonical Prisma schema for See It Now, including all models, fields, types, indexes, and invariants.

---

## Database Provider

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-1.1.x", "debian-openssl-3.0.x"]
}
```

---

## Models

### Session (Shopify Auth)

```prisma
model Session {
  id            String    @id
  shop          String
  state         String
  isOnline      Boolean   @default(false)
  scope         String?
  expires       DateTime?
  accessToken   String
  userId        BigInt?
  firstName     String?
  lastName      String?
  email         String?
  accountOwner  Boolean   @default(false)
  locale        String?
  collaborator  Boolean?  @default(false)
  emailVerified Boolean?  @default(false)
}
```

This is managed by Shopify's auth library. Do not modify manually.

---

### Shop

```prisma
model Shop {
  id            String    @id @default(uuid())
  shopDomain    String    @unique @map("shop_domain")
  shopifyShopId String    @map("shopify_shop_id")
  accessToken   String    @map("access_token")
  plan          String                            // "free" | "starter" | "pro"
  monthlyQuota  Int       @map("monthly_quota")   // Max renders per month
  dailyQuota    Int       @map("daily_quota")     // Max renders per day
  settingsJson  String?   @map("settings_json")   // JSON blob for shop settings
  createdAt     DateTime  @default(now()) @map("created_at")
  uninstalledAt DateTime? @map("uninstalled_at")

  // Relations
  productAssets    ProductAsset[]
  roomSessions     RoomSession[]
  renderJobs       RenderJob[]
  renderRuns       RenderRun[]
  usageDaily       UsageDaily[]

  @@map("shops")
}
```

---

### ProductAsset

```prisma
model ProductAsset {
  id                 String   @id @default(uuid())
  shopId             String   @map("shop_id")
  productId          String   @map("product_id")      // Shopify product ID (numeric string)
  productTitle       String?  @map("product_title")
  productType        String?  @map("product_type")
  variantId          String?  @map("variant_id")
  sourceImageId      String   @map("source_image_id")
  sourceImageUrl     String   @map("source_image_url")
  preparedImageUrl   String?  @map("prepared_image_url")  // Legacy signed URL
  preparedImageKey   String?  @map("prepared_image_key")  // GCS key (preferred)
  status             String                               // See status enum below
  enabled            Boolean  @default(false)
  prepStrategy       String   @map("prep_strategy")       // "batch" | "fallback" | "manual"
  promptVersion      Int      @map("prompt_version")
  errorMessage       String?  @map("error_message")
  retryCount         Int      @default(0) @map("retry_count")
  isDefault          Boolean  @default(false) @map("is_default")
  
  // LEGACY: See It Now fields (being replaced by 2-LLM pipeline)
  renderInstructions         String?   @map("render_instructions")
  renderInstructionsSeeItNow String?   @map("render_instructions_see_it_now")
  seeItNowVariants           Json?     @map("see_it_now_variants")  // DEPRECATED
  useGeneratedPrompt         Boolean   @default(false) @map("use_generated_prompt")
  
  // LEGACY: Placement metadata
  sceneRole              String?   @map("scene_role")
  replacementRule        String?   @map("replacement_rule")
  allowSpaceCreation     Boolean?  @map("allow_space_creation")
  placementFields        Json?     @map("placement_fields")
  fieldSource            Json?     @map("field_source")  // Track auto vs merchant
  
  // ============================================================
  // NEW: 2-LLM Pipeline Fields
  // ============================================================
  extractedFacts      Json?     @map("extracted_facts")      // LLM #1 output (ProductPlacementFacts)
  merchantOverrides   Json?     @map("merchant_overrides")   // Merchant edits (diff only)
  resolvedFacts       Json?     @map("resolved_facts")       // merged(extracted, overrides)
  promptPack          Json?     @map("prompt_pack")          // LLM #2 output (PromptPack)
  promptPackVersion   Int?      @map("prompt_pack_version")  // Links to PromptVersion.version
  extractedAt         DateTime? @map("extracted_at")         // When facts were extracted
  
  // Gemini Files API cache
  geminiFileUri         String?   @map("gemini_file_uri")
  geminiFileExpiresAt   DateTime? @map("gemini_file_expires_at")
  
  createdAt             DateTime  @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  // Relations
  shop        Shop         @relation(fields: [shopId], references: [id], onDelete: Cascade)
  renderJobs  RenderJob[]
  renderRuns  RenderRun[]

  @@index([shopId, productId])
  @@index([shopId, productId, isDefault])
  @@map("product_assets")
}
```

#### ProductAsset.status Enum

| Value | Meaning |
|-------|---------|
| `unprepared` | No background removal done |
| `preparing` | Background removal in progress |
| `processing` | Currently being processed |
| `ready` | Cutout ready, not enabled for storefront |
| `live` | Enabled for storefront use |
| `failed` | Background removal failed |

#### ProductAsset.extractedFacts Structure

See `ProductPlacementFacts` in 13_AI_PROMPTS.md

#### ProductAsset.promptPack Structure

```typescript
interface PromptPack {
  product_context: string;
  variants: Array<{
    id: string;        // "V01" through "V08"
    variation: string;
  }>;
}
```

---

### RoomSession

```prisma
model RoomSession {
  id                    String    @id @default(uuid())
  shopId                String    @map("shop_id")
  
  // Original upload
  originalRoomImageUrl  String?   @map("original_room_image_url")  // Legacy signed URL
  originalRoomImageKey  String?   @map("original_room_image_key")  // GCS key
  
  // Cleaned (object removal) - optional
  cleanedRoomImageUrl   String?   @map("cleaned_room_image_url")
  cleanedRoomImageKey   String?   @map("cleaned_room_image_key")
  
  // Canonical (normalized, authoritative)
  canonicalRoomImageKey String?   @map("canonical_room_image_key")
  canonicalRoomWidth    Int?      @map("canonical_room_width")
  canonicalRoomHeight   Int?      @map("canonical_room_height")
  canonicalRoomRatioLabel String? @map("canonical_room_ratio_label")  // e.g. "16:9"
  canonicalRoomRatioValue Float?  @map("canonical_room_ratio_value")  // e.g. 1.777
  canonicalRoomCrop     Json?     @map("canonical_room_crop")         // Crop params if applied
  canonicalCreatedAt    DateTime? @map("canonical_created_at")
  
  // Gemini Files API cache
  geminiFileUri         String?   @map("gemini_file_uri")
  geminiFileExpiresAt   DateTime? @map("gemini_file_expires_at")
  
  createdAt             DateTime  @map("created_at")
  expiresAt             DateTime  @map("expires_at")        // 24 hours from creation
  lastUsedAt            DateTime? @map("last_used_at")

  // Relations
  shop       Shop        @relation(fields: [shopId], references: [id], onDelete: Cascade)
  renderJobs RenderJob[]

  @@map("room_sessions")
}
```

---

### RenderJob (Legacy - for backwards compatibility)

```prisma
model RenderJob {
  id             String    @id @default(uuid())
  shopId         String    @map("shop_id")
  productId      String    @map("product_id")
  variantId      String?   @map("variant_id")
  productAssetId String?   @map("product_asset_id")
  roomSessionId  String?   @map("room_session_id")
  
  // Placement (not used by See It Now v2)
  placementX     Float     @map("placement_x")
  placementY     Float     @map("placement_y")
  placementScale Float     @map("placement_scale")
  
  // Configuration
  stylePreset    String?   @map("style_preset")
  quality        String?   @map("quality")
  configJson     String?   @map("config_json")
  
  // Result
  status         String
  imageUrl       String?   @map("image_url")
  imageKey       String?   @map("image_key")
  
  // Model tracking
  modelId        String?   @map("model_id")
  promptId       String?   @map("prompt_id")
  promptVersion  Int?      @map("prompt_version")
  
  // Error handling
  errorCode      String?   @map("error_code")
  errorMessage   String?   @map("error_message")
  retryCount     Int       @default(0) @map("retry_count")
  
  createdAt      DateTime  @map("created_at")
  completedAt    DateTime? @map("completed_at")

  // Relations
  shop         Shop          @relation(fields: [shopId], references: [id], onDelete: Cascade)
  productAsset ProductAsset? @relation(fields: [productAssetId], references: [id])
  roomSession  RoomSession?  @relation(fields: [roomSessionId], references: [id])

  @@map("render_jobs")
}
```

---

### PromptVersion (NEW)

Tracks prompt configuration versions for reproducibility and debugging.

```prisma
model PromptVersion {
  id             String   @id @default(uuid())
  version        Int      @unique
  globalHash     String   @map("global_hash")      // Hash of GLOBAL_RENDER_STATIC
  extractorHash  String   @map("extractor_hash")   // Hash of extractor prompt
  builderHash    String   @map("builder_hash")     // Hash of builder prompt
  configSnapshot Json     @map("config_snapshot")  // Full config at this version
  createdAt      DateTime @default(now()) @map("created_at")
  
  @@map("prompt_versions")
}
```

---

### RenderRun (NEW)

One record per See It Now render request. Provides full lineage tracking.

```prisma
model RenderRun {
  id                String   @id @default(uuid())
  shopId            String   @map("shop_id")
  productAssetId    String   @map("product_asset_id")
  roomSessionId     String   @map("room_session_id")
  requestId         String   @map("request_id")
  promptPackVersion Int      @map("prompt_pack_version")
  model             String                              // e.g. "gemini-2.5-flash-image"
  
  // Image hashes for deduplication and debugging
  productImageHash  String   @map("product_image_hash")
  productImageMeta  Json     @map("product_image_meta")   // { width, height, bytes, format }
  roomImageHash     String   @map("room_image_hash")
  roomImageMeta     Json     @map("room_image_meta")
  
  // Prompt tracking - store full snapshots for reproducibility
  resolvedFactsHash String   @map("resolved_facts_hash")
  resolvedFactsJson Json     @map("resolved_facts_json")
  promptPackHash    String   @map("prompt_pack_hash")
  promptPackJson    Json     @map("prompt_pack_json")
  
  // Results
  totalDurationMs   Int?     @map("total_duration_ms")
  status            String                              // "complete" | "partial" | "failed"
  
  createdAt         DateTime @default(now()) @map("created_at")
  
  // Relations
  shop           Shop            @relation(fields: [shopId], references: [id], onDelete: Cascade)
  productAsset   ProductAsset    @relation(fields: [productAssetId], references: [id])
  variantResults VariantResult[]
  
  @@map("render_runs")
}
```

---

### VariantResult (NEW)

One record per variant per RenderRun.

```prisma
model VariantResult {
  id              String   @id @default(uuid())
  renderRunId     String   @map("render_run_id")
  variantId       String   @map("variant_id")       // "V01" through "V08"
  finalPromptHash String   @map("final_prompt_hash")
  status          String                            // "success" | "failed" | "timeout"
  latencyMs       Int      @map("latency_ms")
  outputImageKey  String?  @map("output_image_key") // GCS key
  outputImageHash String?  @map("output_image_hash")
  errorMessage    String?  @map("error_message")
  
  createdAt       DateTime @default(now()) @map("created_at")
  
  // Relations
  renderRun RenderRun @relation(fields: [renderRunId], references: [id], onDelete: Cascade)
  
  @@map("variant_results")
}
```

---

### UsageDaily

```prisma
model UsageDaily {
  id               String   @id @default(uuid())
  shopId           String   @map("shop_id")
  date             DateTime                        // Date only (no time)
  prepRenders      Int      @default(0) @map("prep_renders")
  cleanupRenders   Int      @default(0) @map("cleanup_renders")
  compositeRenders Int      @default(0) @map("composite_renders")

  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)

  @@unique([shopId, date])
  @@map("usage_daily")
}
```

---

## Indexes

Required indexes for performance:

```prisma
// ProductAsset
@@index([shopId, productId])
@@index([shopId, productId, isDefault])

// UsageDaily
@@unique([shopId, date])

// PromptVersion
@@unique([version])
```

---

## Invariants

### ProductAsset Invariants

1. **Single Default**: Only one ProductAsset per (shopId, productId) can have isDefault = true
2. **Status Transitions**: 
   - unprepared → preparing (only)
   - preparing → ready or failed (only)
   - ready → live (enable)
   - live → ready (disable)
3. **Live Requires Ready**: Cannot set status = "live" unless preparedImageKey is non-null
4. **Pipeline Data**: For See It Now v2 renders, resolvedFacts and promptPack must be non-null

### RenderRun Invariants

1. **Valid Status**: status must be one of: "complete", "partial", "failed"
2. **Variant Count**: Should have 8 VariantResult records (one per V01-V08)
3. **Success Criteria**: 
   - status = "complete" → all 8 variants succeeded
   - status = "partial" → 1-7 variants succeeded
   - status = "failed" → 0 variants succeeded

### PromptVersion Invariants

1. **Monotonic**: version numbers only increase
2. **Immutable**: Once created, a PromptVersion record is never modified
3. **Hash Integrity**: Hashes must match actual prompt content

---

## Cascade Deletes

All relations use onDelete: Cascade:

```
Shop delete causes deletion of:
  - ProductAsset
  - RoomSession
  - RenderJob
  - RenderRun → VariantResult
  - UsageDaily
```

---

## Migration Commands

```bash
# Generate migration from schema changes
npx prisma migrate dev --name migration_name_here

# Apply migrations in production
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

---

## JSON Field Types Reference

| Model | Field | TypeScript Type |
|-------|-------|-----------------|
| ProductAsset | extractedFacts | ProductPlacementFacts |
| ProductAsset | merchantOverrides | Partial<ProductPlacementFacts> |
| ProductAsset | resolvedFacts | ProductPlacementFacts |
| ProductAsset | promptPack | PromptPack |
| ProductAsset | placementFields | PlacementFields (legacy) |
| RenderRun | productImageMeta | ImageMeta |
| RenderRun | roomImageMeta | ImageMeta |
| RenderRun | resolvedFactsJson | ProductPlacementFacts |
| RenderRun | promptPackJson | PromptPack |
| PromptVersion | configSnapshot | object |

See 13_AI_PROMPTS.md for full interface definitions.
