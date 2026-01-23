# Step 12: Instrumentation

## Context

You are working on a Shopify Remix app. You have created the telemetry module and UI. Now instrument the renderer to use the new telemetry module.

## Task

Replace the old monitor calls in renderer.server.ts with the new telemetry module.

## Instructions

### 1. Modify `app/services/see-it-now/renderer.server.ts`

**Remove these imports:**
```typescript
// DELETE THIS LINE:
import { writeRenderRun, writeVariantResult } from "./monitor.server";
```

**Add these imports:**
```typescript
import {
  startRun,
  recordVariantStart,
  recordVariantResult,
  completeRun,
  emit,
  EventSource,
  EventType,
} from "~/services/telemetry";
```

**Replace the writeRenderRun call with startRun:**

Before:
```typescript
await writeRenderRun({
  id: runId,
  shopId: input.shopId,
  // ... etc
});
```

After:
```typescript
await startRun({
  runId,
  shopId: input.shopId,
  requestId: input.requestId,
  productAssetId: input.productAssetId,
  roomSessionId: input.roomSessionId,
  promptPackVersion: input.promptPackVersion,
  model: GEMINI_IMAGE_MODEL_FAST,
  productImageHash: input.productImage.hash,
  productImageMeta: input.productImage.meta,
  roomImageHash: input.roomImage.hash,
  roomImageMeta: input.roomImage.meta,
  resolvedFactsHash: hashPrompt(JSON.stringify(input.resolvedFacts)),
  resolvedFactsJson: input.resolvedFacts as Record<string, unknown>,
  promptPackHash: hashPrompt(JSON.stringify(input.promptPack)),
  promptPackJson: input.promptPack as Record<string, unknown>,
});
```

**Add recordVariantStart before each variant renders:**

Before the renderSingleVariant call:
```typescript
recordVariantStart({
  runId,
  variantId: variant.id,
  requestId: input.requestId,
  shopId: input.shopId,
});
```

**Replace writeVariantResult with recordVariantResult:**

Before:
```typescript
await writeVariantResult({
  renderRunId: runId,
  variantId: result.variantId,
  // ... etc
});
```

After:
```typescript
await recordVariantResult({
  renderRunId: runId,
  variantId: result.variantId,
  finalPromptHash: hashPrompt(finalPrompt),
  requestId: input.requestId,
  shopId: input.shopId,
  status: result.status,
  latencyMs: result.latencyMs,
  outputImageKey: imageKey,
  outputImageHash: result.imageHash,
  errorCode: result.status === "timeout" ? "TIMEOUT" : result.status === "failed" ? "PROVIDER_ERROR" : undefined,
  errorMessage: result.errorMessage,
});
```

**Replace the prisma.renderRun.update with completeRun:**

Before:
```typescript
await prisma.renderRun.update({
  where: { id: runId },
  data: { status, totalDurationMs },
});
```

After:
```typescript
await completeRun({
  runId,
  requestId: input.requestId,
  shopId: input.shopId,
  status,
  totalDurationMs,
  successCount,
  failCount: results.filter((r) => r.status === "failed").length,
  timeoutCount: results.filter((r) => r.status === "timeout").length,
});
```

**Remove the direct prisma import if no longer needed:**
```typescript
// DELETE if not used elsewhere:
import prisma from "~/db.server";
```

### 2. Modify `app/routes/app-proxy.see-it-now.render.ts`

**Remove session logger calls:**
```typescript
// DELETE THESE:
import { logSeeItNowEvent } from "~/services/session-logger.server";

// DELETE ALL logSeeItNowEvent() calls
```

**Add telemetry emit at the start:**
```typescript
import { emit, EventSource, EventType } from "~/services/telemetry";

// At the start of the render flow (after auth):
emit({
  shopId: shop.id,
  requestId,
  source: EventSource.APP_PROXY,
  type: EventType.SF_RENDER_REQUESTED,
  payload: {
    productId: product_id,
    roomSessionId: room_session_id,
  },
});
```

### 3. Modify `app/services/see-it-now/index.ts`

**Remove monitor exports:**
```typescript
// DELETE THIS LINE:
export { writeRenderRun, writeVariantResult } from "./monitor.server";
```

## Verification

1. Build succeeds: `npm run build`
2. App starts: `npm run dev`
3. Trigger a render from the storefront
4. Check `/app/monitor` - new run should appear
5. Click run - variants should show with data
6. Check `monitor_events` table - events should be logged

## Test Commands

```bash
# Build check
npm run build

# Type check
npx tsc --noEmit

# Start and test manually
npm run dev
```

## Do Not

- Do not delete monitor.server.ts yet (cleanup step)
- Do not modify other pipeline files yet (prep, prompt builder)
- Do not remove the hashPrompt function - it's still needed
