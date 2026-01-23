# Step 13: Cleanup

## Context

You are working on a Shopify Remix app. You have instrumented the renderer to use the new telemetry module. Now clean up old files.

## Task

Delete old monitor files and update imports.

## Instructions

### 1. Delete Old Files

Delete these files:
- `app/services/see-it-now/monitor.server.ts`
- `app/routes/app.monitor.tsx` (replaced by app.monitor._index.tsx)
- `app/routes/api.monitor.run.$id.tsx` (replaced by v1 routes)

### 2. Update `app/services/see-it-now/index.ts`

Remove any remaining exports for the deleted monitor:

```typescript
// Ensure these lines are REMOVED:
// export { writeRenderRun, writeVariantResult } from "./monitor.server";
```

The file should only export:
```typescript
export * from "./types";
export { extractProductFacts } from "./extractor.server";
export { resolveProductFacts } from "./resolver.server";
export { buildPromptPack } from "./prompt-builder.server";
export { assembleFinalPrompt, hashPrompt } from "./prompt-assembler.server";
export { renderAllVariants } from "./renderer.server";
export {
  getCurrentPromptVersion,
  ensurePromptVersion,
} from "./versioning.server";
```

### 3. Check for Broken Imports

Search the codebase for any remaining imports of deleted files:

```bash
# Search for old monitor imports
grep -r "from.*monitor.server" app/
grep -r "from.*app.monitor" app/
grep -r "writeRenderRun" app/
grep -r "writeVariantResult" app/
```

Fix any broken imports found.

### 4. Keep Session Logger (For Now)

Do NOT delete `app/services/session-logger.server.ts` yet.

It may still be imported elsewhere. Search for usages:
```bash
grep -r "session-logger" app/
grep -r "logSeeItNowEvent" app/
grep -r "logSessionStep" app/
```

If there are usages outside of `app-proxy.see-it-now.render.ts`, leave them for now.

If the ONLY usage was in `app-proxy.see-it-now.render.ts` (which you removed in step 12), then you can delete the session logger.

### 5. Verify Build

```bash
# Clean build
rm -rf build/
npm run build

# Type check
npx tsc --noEmit

# Start and verify
npm run dev
```

### 6. Test Full Flow

1. Navigate to `/app/monitor` - should show runs list
2. Navigate to `/app/monitor/health` - should show health stats
3. Trigger a render from storefront
4. Run should appear in list within 2 seconds
5. Click run - should show detail with variants
6. Export should download ZIP

### 7. Commit

```bash
git add -A
git commit -m "observability v2: cleanup old monitor files"
```

## Checklist

- [ ] `app/services/see-it-now/monitor.server.ts` deleted
- [ ] `app/routes/app.monitor.tsx` deleted
- [ ] `app/routes/api.monitor.run.$id.tsx` deleted
- [ ] `app/services/see-it-now/index.ts` updated
- [ ] No broken imports
- [ ] Build succeeds
- [ ] Type check passes
- [ ] App starts
- [ ] Monitor UI works
- [ ] Render flow works
- [ ] Events logged to monitor_events table

## Do Not

- Do not delete session-logger.server.ts if it has other usages
- Do not delete any telemetry module files
- Do not delete any v1 API routes
