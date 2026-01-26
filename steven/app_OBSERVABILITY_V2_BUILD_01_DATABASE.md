# Step 01: Database Schema

## Context

You are working on a Shopify Remix app at this location. The app uses Prisma with PostgreSQL.

## Task

Modify the Prisma schema to add observability tables and fields.

## Instructions

1. Read the current schema at `prisma/schema.prisma`

2. Add the MonitorEvent model:

```prisma
model MonitorEvent {
  id                 String   @id @default(uuid())
  ts                 DateTime @default(now())
  shopId             String   @map("shop_id")
  requestId          String   @map("request_id")
  runId              String?  @map("run_id")
  variantId          String?  @map("variant_id")
  traceId            String?  @map("trace_id")
  spanId             String?  @map("span_id")
  parentSpanId       String?  @map("parent_span_id")
  source             String
  type               String
  severity           String
  schemaVersion      Int      @default(1) @map("schema_version")
  payload            Json     @default("{}")
  overflowArtifactId String?  @map("overflow_artifact_id")

  @@index([shopId])
  @@index([requestId])
  @@index([runId])
  @@index([type, ts])
  @@map("monitor_events")
}
```

3. Add the MonitorArtifact model:

```prisma
model MonitorArtifact {
  id             String    @id @default(uuid())
  ts             DateTime  @default(now())
  shopId         String    @map("shop_id")
  requestId      String    @map("request_id")
  runId          String?   @map("run_id")
  variantId      String?   @map("variant_id")
  type           String
  gcsKey         String    @map("gcs_key")
  contentType    String    @map("content_type")
  byteSize       Int       @map("byte_size")
  sha256         String?
  width          Int?
  height         Int?
  retentionClass String    @default("standard") @map("retention_class")
  expiresAt      DateTime? @map("expires_at")
  meta           Json?

  @@index([shopId])
  @@index([requestId])
  @@index([runId])
  @@index([type])
  @@map("monitor_artifacts")
}
```

4. Modify the existing RenderRun model - ADD these fields (do not remove existing fields):

```prisma
  // Add these fields to existing RenderRun model:
  traceId            String?   @map("trace_id")
  startedAt          DateTime  @default(now()) @map("started_at")
  completedAt        DateTime? @map("completed_at")
  successCount       Int       @default(0) @map("success_count")
  failCount          Int       @default(0) @map("fail_count")
  timeoutCount       Int       @default(0) @map("timeout_count")
  telemetryDropped   Boolean   @default(false) @map("telemetry_dropped")
```

Also add this index to RenderRun:
```prisma
  @@index([traceId])
```

5. Modify the existing VariantResult model - ADD these fields (do not remove existing fields):

```prisma
  // Add these fields to existing VariantResult model:
  startedAt          DateTime? @map("started_at")
  completedAt        DateTime? @map("completed_at")
  providerMs         Int?      @map("provider_ms")
  uploadMs           Int?      @map("upload_ms")
  errorCode          String?   @map("error_code")
  outputArtifactId   String?   @map("output_artifact_id")
```

6. After modifying the schema, create and run the migration:

```bash
npx prisma migrate dev --name add_observability_v2_tables
```

## Verification

- Migration completes without errors
- Run `npx prisma generate` to regenerate client
- No TypeScript errors

## Do Not

- Do not remove any existing fields
- Do not modify existing indexes unless adding new ones
- Do not change existing column mappings
