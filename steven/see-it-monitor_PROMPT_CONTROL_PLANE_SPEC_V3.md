# Prompt Control Plane - Implementation Spec v3
## All 7 bugs fixed

---

## Summary of Fixes

### ✅ Fix 1: Stop recomputing templateHash in resolver
- `templateHash` now comes from `activeVersion.templateHash` directly
- Only `resolutionHash` is computed (for actual rendered call identity)

### ✅ Fix 2: Version auto-increment is transactional
- `createVersion()` uses `Serializable` isolation transaction
- Reads `MAX(version)` and inserts `max + 1` atomically
- No race conditions under concurrent edits

### ✅ Fix 3: Active version uniqueness is transactional
- `activateVersion()` uses `Serializable` isolation transaction
- Archives current active, then activates new version atomically
- One ACTIVE per definition guaranteed

### ✅ Fix 4: requestHash sorts imageRefs
- `computeRequestHash()` now does `[...imageRefs].sort()` before hashing
- Same images in different order = same hash

### ✅ Fix 5: Template rendering supports dot paths
- Regex changed to `/\{\{([\w.]+)\}\}/g`
- `resolveDotPath()` handles `{{product.title}}` safely

### ✅ Fix 6: System tenant fallback in resolver
- Resolution order: shop → SYSTEM_TENANT_ID → error
- `SYSTEM_TENANT_ID = "SYSTEM"` constant exported

### ✅ Fix 7: Runtime config loaded once
- `loadRuntimeConfig()` called once in `buildResolvedConfigSnapshot()`
- Passed as parameter to `resolvePrompt()`, not re-fetched

### ✅ Bonus A: Blocked prompts recorded
- `ResolvedConfigSnapshot.blockedPrompts: Record<promptName, reason>`

### ✅ Bonus B: promptVersionId always stored
- Even if override is applied, we store `activeVersion.id`
- `inputRef` includes `resolutionHash` for distinguishing

---

## File Structure

```
app/services/prompt-control/
├── index.ts                       # Main exports
├── prompt-resolver.server.ts      # Resolution logic
├── prompt-version-manager.server.ts # CRUD with transactions
└── llm-call-tracker.server.ts     # Call instrumentation

prisma/
├── schema-prompt-control-v2.prisma # Schema additions
└── seed-prompts.ts                 # Backfill script
```

---

## Usage Example

```typescript
import {
  buildResolvedConfigSnapshot,
  trackedLLMCall,
  createVersion,
  activateVersion,
} from "~/services/prompt-control";

// 1. Build snapshot at start of render run
const snapshot = await buildResolvedConfigSnapshot({
  shopId: "shop_123",
  promptNames: ["extractor", "prompt_builder", "global_render"],
  variables: {
    title: "Reclaimed Teak Coffee Table",
    description: "...",
    "product.title": "Reclaimed Teak Coffee Table", // dot paths work!
  },
});

// 2. Check for blocked prompts
if (Object.keys(snapshot.blockedPrompts).length > 0) {
  console.log("Blocked:", snapshot.blockedPrompts);
}

// 3. Use resolved prompt for LLM call
const extractorPrompt = snapshot.prompts["extractor"];

const result = await trackedLLMCall(
  {
    shopId: "shop_123",
    renderRunId: "run_456",
    promptName: "extractor",
    promptVersionId: extractorPrompt.promptVersionId,
    model: extractorPrompt.model,
    messages: extractorPrompt.messages,
    params: extractorPrompt.params,
    imageRefs: ["gs://bucket/product.png"],
    resolutionHash: extractorPrompt.resolutionHash,
  },
  async () => {
    // Your actual LLM call here
    const response = await callGemini(extractorPrompt.messages, extractorPrompt.params);
    return {
      result: response.text,
      usage: {
        tokensIn: response.usageMetadata?.promptTokenCount,
        tokensOut: response.usageMetadata?.candidatesTokenCount,
        cost: calculateCost(response),
      },
      providerModel: response.modelVersion,
    };
  }
);

// 4. Create new version (race-safe)
const newVersion = await createVersion({
  shopId: "shop_123",
  promptName: "extractor",
  systemTemplate: "Updated system prompt...",
  userTemplate: "Updated user template...",
  model: "gemini-2.5-flash",
  params: { temperature: 0.4 },
  changeNotes: "Improved extraction accuracy",
  createdBy: "steven@labcast.com.au",
});

// 5. Activate version (race-safe)
await activateVersion({
  shopId: "shop_123",
  promptName: "extractor",
  versionId: newVersion.id,
  activatedBy: "steven@labcast.com.au",
});
```

---

## Next Steps

1. **Add schema to prisma/schema.prisma** - Merge the schema-prompt-control-v2.prisma
2. **Run migration** - `npx prisma migrate dev --name add_prompt_control`
3. **Run seed script** - `npx tsx prisma/seed-prompts.ts`
4. **Update render pipeline** - Replace hardcoded prompts with `resolvePrompt()`
5. **Build API routes** - For the monitor app
6. **Build UI** - Prompts list, detail, controls pages
