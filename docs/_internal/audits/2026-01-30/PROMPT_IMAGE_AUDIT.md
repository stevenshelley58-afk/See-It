# Prompt and Image Data Flow Audit

**Audit Date:** 2026-01-30  
**Sample Product:** https://www.bhm.com.au/products/detailed-sundar-mirror-bleach-chalky-bleach

---

## Executive Summary

This audit traces how product data, prompts, and images flow through the "See It Now" pipeline from product input to monitor display. Critical attention is paid to ensuring what is sent to the AI model matches what is recorded in telemetry and displayed in the monitor.

### Data Flow Stages

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA FLOW PIPELINE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STAGE 1: Product Facts Extraction (LLM #1)                                │
│  ├── Input: Shopify product data (title, description, images)              │
│  ├── Service: extractor.server.ts → extractProductFacts()                  │
│  ├── Prompt: Resolved from DB using 'product_fact_extractor'               │
│  ├── Variables: { shopifyProductJson, sourceImagesCount }                  │
│  └── Output: ProductFacts JSON                                             │
│                                                                             │
│  STAGE 2: Fact Resolution & Override                                       │
│  ├── Input: extractedFacts + merchantOverrides                             │
│  ├── Service: resolver.server.ts → resolveProductFacts()                   │
│  └── Output: resolvedFacts (deep merged)                                   │
│                                                                             │
│  STAGE 3: Placement Set Generation (LLM #2)                                │
│  ├── Input: resolvedFacts                                                  │
│  ├── Service: prompt-builder.server.ts → buildPlacementSet()               │
│  ├── Prompt: Resolved using 'placement_set_generator'                      │
│  ├── Variables: { resolvedFactsJson, materialRules, scaleGuardrails,       │
│  │              variantIntentsJson }                                       │
│  └── Output: PlacementSet { productDescription, variants[] }               │
│                                                                             │
│  STAGE 4: Composite Rendering (LLM #3) - Per Variant                       │
│  ├── Input: placementSet, preparedProductImage, roomImage                  │
│  ├── Service: composite-runner.server.ts → renderSingleVariant()           │
│  ├── Prompt: Resolved using 'composite_instruction'                        │
│  ├── Variables: { productDescription, placementInstruction }               │
│  ├── Images: [productImage(order:0), roomImage(order:1)]                   │
│  └── Output: Generated composite image                                     │
│                                                                             │
│  STAGE 5: Monitoring & Display                                             │
│  ├── Storage: LLMCall table with debugPayload                              │
│  ├── Storage: CompositeRun with snapshots                                  │
│  └── Display: Monitor UI showing calls, events, images                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Critical Data Paths to Verify

### PATH 1: Prompt Resolution → Model Call → debugPayload

**Question:** Does the prompt text sent to the model match what's stored in debugPayload?

**Stage 2 (Placement Set Generation) Flow:**

```typescript
// File: app/app/services/see-it-now/prompt-builder.server.ts:52-58
const resolvedPrompt = await resolvePromptText(shopId, 'placement_set_generator', {
  resolvedFactsJson: JSON.stringify(resolvedFacts, null, 2),  // VARIABLE
  materialPrimary,
  materialRules,
  scaleGuardrails,
  variantIntentsJson,
});

// File: app/app/services/see-it-now/prompt-builder.server.ts:74-90
const finalConfig = {
  responseMimeType: "application/json",
  ...resolvedPrompt.params,
};

// Build debug payload (must match final config)
const debugPayload: DebugPayload = {
  promptText: resolvedPrompt.promptText,  // STORED
  model: resolvedPrompt.model,
  params: {
    responseModalities: ['TEXT'],
    ...finalConfig,
  },
  images: [], // No images for placement set generation
  aspectRatioSource: 'UNKNOWN',
};

// File: app/app/services/see-it-now/prompt-builder.server.ts:121-131
const result = await client.models.generateContent({
  model: resolvedPrompt.model,
  contents: [
    {
      role: "user",
      parts: [{ text: resolvedPrompt.promptText }],  // ACTUALLY SENT
    },
  ],
  config: finalConfig,  // ACTUALLY SENT
});
```

**VERIFICATION CHECK:**
- ✅ `debugPayload.promptText` equals `resolvedPrompt.promptText`
- ✅ `debugPayload.params` equals `finalConfig` (with responseModalities added)
- ✅ The actual API call uses `resolvedPrompt.promptText` and `finalConfig`

**Stage 4 (Composite Rendering) Flow:**

```typescript
// File: app/app/services/see-it-now/composite-runner.server.ts:115-118
const resolvedPrompt = await resolvePromptText(shopId, 'composite_instruction', {
  productDescription: productDescription,      // VARIABLE
  placementInstruction: variant.placementInstruction,  // VARIABLE
});

const finalPrompt = resolvedPrompt.promptText;

// File: app/app/services/see-it-now/composite-runner.server.ts:122-169
const parts: any[] = [];
// 1. Product image
parts.push({ inlineData: { mimeType: productMime, data: productImage.buffer.toString("base64") } });
// 2. Room image (MUST be last for aspect ratio)
parts.push({ inlineData: { mimeType: roomMime, data: roomImage.buffer.toString("base64") } });
// 3. Prompt (last)
parts.push({ text: finalPrompt });

// File: app/app/services/see-it-now/composite-runner.server.ts:191-211
const finalConfig: any = {
  responseModalities: ["TEXT", "IMAGE"] as any,
  ...(resolvedPrompt.params ?? {}),
};
if (aspectRatio) {
  const existing = finalConfig.imageConfig && typeof finalConfig.imageConfig === "object"
    ? finalConfig.imageConfig
    : {};
  finalConfig.imageConfig = { ...existing, aspectRatio };
}

const debugPayload: DebugPayload = {
  promptText: finalPrompt,  // STORED
  model: resolvedPrompt.model,
  params: finalConfig,  // STORED
  images: preparedImages,
  aspectRatioSource: aspectRatio ? 'ROOM_IMAGE_LAST' : 'UNKNOWN',
};

// File: app/app/services/see-it-now/composite-runner.server.ts:257-264
const result = await Promise.race([
  client.models.generateContent({
    model: resolvedPrompt.model,
    contents: [{ role: "user", parts }],  // ACTUALLY SENT (includes finalPrompt)
    config: finalConfig,  // ACTUALLY SENT
  }),
  timeoutPromise,
]);
```

**VERIFICATION CHECK:**
- ✅ `debugPayload.promptText` equals `finalPrompt` equals `resolvedPrompt.promptText`
- ⚠️ **ISSUE IDENTIFIED:** `debugPayload.params` includes `responseModalities: ["TEXT", "IMAGE"]` but the actual content parts include images inline. Need to verify this is the correct representation.
- ✅ Images are correctly ordered: product (0), room (1)
- ✅ Room image is last for aspect ratio adoption

---

### PATH 2: Template Variables → Rendered Prompt

**Question:** Are all template variables correctly substituted?

**Template Rendering Logic:**

```typescript
// File: app/app/services/prompt-control/prompt-resolver.server.ts:150-162
export function renderTemplate(
  template: string | null,
  variables: Record<string, unknown>
): string | null {
  if (!template) return null;

  // Match {{word}} or {{word.word.word}} patterns
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, path: string) => {
    // Handle dot-separated paths like "product.title"
    const value = resolveDotPath(variables, path);
    return value ?? match; // Keep original if not found
  });
}

// File: app/app/services/prompt-control/prompt-resolver.server.ts:176-196
export function resolveDotPath(obj: Record<string, unknown>, path: string): string | undefined {
  // 1. Check flat key first (handles { "product.title": "value" })
  if (path in obj) {
    const value = obj[path];
    if (value === null || value === undefined) return undefined;
    return String(value);
  }

  // 2. Fall back to nested path traversal (handles { product: { title: "value" } })
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  if (current === null || current === undefined) return undefined;
  return String(current);
}
```

**CRITICAL VERIFICATION NEEDED:**

For `placement_set_generator` prompt, variables are:
```typescript
{
  resolvedFactsJson: JSON.stringify(resolvedFacts, null, 2),
  materialPrimary,
  materialRules,
  scaleGuardrails,
  variantIntentsJson,
}
```

**Question:** Does the template in the database use:
- `{{resolvedFactsJson}}` or `{{facts}}` or `{{product}}`?
- `{{materialPrimary}}` or `{{material.primary}}`?

**If the template uses variables that don't match the passed variables, they will NOT be substituted!**

---

### PATH 3: Image Hashing and Tracking

**Question:** Are image hashes computed consistently and stored correctly?

**Image Hash Computation:**

```typescript
// File: app/app/services/see-it-now/hashing.server.ts:96-100
export function computeImageHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// File: app/app/services/see-it-now/composite-runner.server.ts:172-189
const preparedImages: PreparedImage[] = [
  {
    role: 'prepared_product_image',
    ref: productImage.ref,
    hash: productImage.hash,  // Pre-computed hash
    mimeType: productMime,
    inputMethod: productInputMethod,
    orderIndex: 0,
  },
  {
    role: 'customer_room_image',
    ref: roomImage.ref,
    hash: roomImage.hash,  // Pre-computed hash
    mimeType: roomMime,
    inputMethod: roomInputMethod,
    orderIndex: 1,
  },
];
```

**VERIFICATION CHECK:**
- ✅ Image hashes are pre-computed before calling `renderSingleVariant()`
- ✅ Hashes are stored in `debugPayload.images`
- ✅ Hashes are used in `computeDedupeHash()` for caching

**Question:** Where are `productImage.hash` and `roomImage.hash` computed?

---

### PATH 4: Hash Computations for Identity

**Multiple Hash Types:**

```typescript
// File: app/app/services/see-it-now/hashing.server.ts

// 1. Pipeline Config Hash - identifies the full prompt configuration
export function computePipelineConfigHash(snapshot: PipelineConfigSnapshot): string {
  const hashable = {
    prompts: Object.fromEntries(
      Object.entries(snapshot.prompts).map(([name, prompt]) => [
        name,
        {
          versionId: prompt.versionId,
          model: prompt.model,
          params: prompt.params
        }
      ])
    ),
    runtimeConfig: snapshot.runtimeConfig
    // NOTE: resolvedAt explicitly excluded
  };
  return sha256(canonicalize(hashable));
}

// 2. Call Identity Hash - identifies the call without images (for deduplication)
export function computeCallIdentityHash(input: {
  promptText: string;
  model: string;
  params: Record<string, unknown>;
}): string {
  return sha256(canonicalize(input));
}

// 3. Dedupe Hash - includes images for caching
export function computeDedupeHash(input: {
  callIdentityHash: string;
  images: PreparedImage[];
}): string {
  const imageDescriptors = input.images.map(img => ({
    role: img.role,
    hash: img.hash,
    mimeType: img.mimeType,
    inputMethod: img.inputMethod,
    orderIndex: img.orderIndex
  }));
  return sha256(canonicalize({
    callIdentityHash: input.callIdentityHash,
    images: imageDescriptors
  }));
}
```

**VERIFICATION CHECK:**
- ✅ All hashes use `canonicalize()` for deterministic serialization
- ✅ `canonicalize()` sorts object keys alphabetically
- ✅ `canonicalize()` preserves array order
- ✅ `computeCallIdentityHash` excludes images (correct for text-only dedupe)
- ✅ `computeDedupeHash` includes image hashes with orderIndex

---

### PATH 5: Prompt Resolution from Database

**Question:** How are prompts resolved and what could go wrong?

```typescript
// File: app/app/services/prompt-control/prompt-resolver.server.ts:725-758
export async function resolvePromptText(
  shopId: string,
  promptName: PromptName,
  variables: Record<string, string>
): Promise<{
  promptText: string;
  versionId: string;
  model: string;
  params: Record<string, unknown>;
}> {
  const runtimeConfig = await loadRuntimeConfig(shopId);

  const result = await resolvePrompt({
    shopId,
    promptName,
    variables,
    runtimeConfig,
  });

  if (!result.resolved) {
    throw new Error(`Failed to resolve prompt ${promptName}: ${result.blockReason}`);
  }

  // Build prompt text from messages
  const promptText = result.resolved.messages
    .map(m => m.content)
    .join('\n\n');

  return {
    promptText,
    versionId: result.resolved.promptVersionId ?? '',
    model: result.resolved.model,
    params: result.resolved.params,
  };
}
```

**Critical Issue:** The function `resolvePromptText()` joins messages with `\n\n`, but when building the actual API call in `prompt-builder.server.ts`, it sends only the prompt text as a single user message. **This is consistent.**

However, in `composite-runner.server.ts`, the prompt text is appended to parts array:
```typescript
parts.push({ text: finalPrompt });
```

This means the final prompt sent to the model is just the text content, not wrapped in a "user" role message structure. **This is the correct behavior for the Gemini API.**

---

## Potential Issues Identified

### ISSUE 1: Variable Name Mismatch

**Risk Level:** HIGH  
**Evidence:** Template variables must exactly match what's passed to `resolvePromptText()`

**Scenario:**
- Template in DB: `"Product: {{productName}}"`
- Variables passed: `{ product_description: "Mirror" }`
- Result: Variable NOT substituted, prompt contains literal `{{productName}}`

**Check Required:** Compare template variables in DB with variables passed in code.

**Code Locations:**
- Template definitions: Database `PromptVersion` table
- Variable passing: `prompt-builder.server.ts:52-58`, `composite-runner.server.ts:115-118`

### ISSUE 2: Prompt Text Construction Mismatch

**Risk Level:** MEDIUM  
**Evidence:** Different prompt construction between stages

**In Stage 2 (prompt-builder.server.ts):**
```typescript
contents: [
  {
    role: "user",
    parts: [{ text: resolvedPrompt.promptText }],
  },
],
```

**In Stage 4 (composite-runner.server.ts):**
```typescript
contents: [{ role: "user", parts }],
// where parts includes images AND text at the end
```

Both are correct for their respective use cases, but the debugPayload structure differs.

### ISSUE 3: CRITICAL - Image Hash Inconsistency

**Risk Level:** CRITICAL  
**Evidence:** Different hash functions used in different parts of the code

**Problem Found:**

1. **In `app-proxy.see-it-now.stream.ts:34-35`:**
```typescript
function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}
```
This creates a **16-character truncated hash**.

2. **In `hashing.server.ts:99-100`:**
```typescript
export function computeImageHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
```
This creates a **64-character full hash**.

3. **In `composite-runner.server.ts:435`:**
```typescript
return { key, hash: computeImageHash(jpegBuffer) };
```
Uses the **64-character hash** for variant images.

**Impact:**
- `productImage.hash` and `roomImage.hash` stored in CompositeRun: **16 chars**
- `CompositeVariant.imageHash` stored after generation: **64 chars**
- `debugPayload.images[].hash`: **16 chars**

**This means the same image has DIFFERENT hash values in different tables!**

**Impact on deduplication:**
The `computeDedupeHash()` function uses `image.hash` from `PreparedImage[]`. If this hash is computed differently at different stages, the deduplication will fail to match identical images.

**Fix Required:**
Standardize on ONE hash function throughout the codebase. Either:
1. Use full 64-char hash everywhere (recommended for collision resistance)
2. Use 16-char truncated hash everywhere (if storage is concern)

### ISSUE 4: Hash Computed on Potentially Different Buffers

**Risk Level:** HIGH  
**Evidence:** Hash computed before potential image transformations

**Scenario:**
1. Hash is computed on the original downloaded buffer
2. Image may be resized/converted before being sent to Gemini
3. The hash stored doesn't represent what was actually sent

**Example flow:**
```typescript
// In stream.ts:538-540
buffer: imageData.buffer,
hash: hashBuffer(imageData.buffer),  // Hash of original

// In composite-runner.ts:127-148
// Same buffer is sent to Gemini (good)
parts.push({
  inlineData: {
    mimeType: productMime,
    data: productImage.buffer.toString("base64"),  // Same buffer!
  },
});
```

**VERIFICATION:** Currently the same buffer is used for both hashing and sending. **This is correct.**

### ISSUE 4: Aspect Ratio Source Tracking

**Risk Level:** LOW  
**Evidence:** debugPayload tracks aspectRatioSource but need to verify it's accurate

```typescript
aspectRatioSource: aspectRatio ? 'ROOM_IMAGE_LAST' : 'UNKNOWN'
```

This is set correctly based on whether aspectRatio was determined from room image.

### ISSUE 5: Template Variable Mismatch Risk

**Risk Level:** HIGH  
**Evidence:** Template variables must exactly match code variables

**Problem:** The code passes specific variable names to `resolvePromptText()`, but the templates in the database must use the exact same variable names. If they don't match, variables won't be substituted.

**Variables passed for 'placement_set_generator':**
```typescript
{
  resolvedFactsJson: JSON.stringify(resolvedFacts, null, 2),
  materialPrimary,
  materialRules,
  scaleGuardrails,
  variantIntentsJson,
}
```

**Variables passed for 'composite_instruction':**
```typescript
{
  productDescription,
  placementInstruction,
}
```

**Risk:** If the template uses `{{facts}}` instead of `{{resolvedFactsJson}}`, the variable won't be substituted.

**Detection:** Look for unreplaced `{{variable}}` patterns in the stored `debugPayload.promptText`.

**Action Required:**
1. Query the database for actual template content
2. Verify all `{{variables}}` in templates match the code
3. Add validation to warn about unreplaced variables

---

## Test Scenario: Detailed Sundar Mirror

**Product URL:** https://www.bhm.com.au/products/detailed-sundar-mirror-bleach-chalky-bleach

**Expected Product Data:**
```json
{
  "title": "Detailed Sundar Mirror - Bleach/Chalky Bleach",
  "product_type": "Mirror",
  "tags": ["reclaimed_teak", "mirror", "wall_hanging"],
  "description": "Hand-carved reclaimed teak mirror with distressed finish..."
}
```

**Expected Facts Extraction:**
```json
{
  "identity": {
    "title": "Detailed Sundar Mirror - Bleach/Chalky Bleach",
    "product_kind": "mirror",
    "category_path": ["Home", "Decor", "Mirrors"],
    "style_cues": ["distressed", "reclaimed", "hand-carved"]
  },
  "material_profile": {
    "primary": "reclaimed_teak",
    "sheen": "matte",
    "transparency": "opaque"
  },
  "placement": {
    "allowed_modes": [{"mode": "wall_mounted", "confidence": 0.95}],
    "support_surfaces": ["wall"]
  },
  "relative_scale": {
    "class": "medium"
  }
}
```

**Verification Steps for This Product:**

1. **Facts Extraction:**
   - Check extracted facts match expected material (reclaimed_teak)
   - Check product_kind is "mirror"
   - Check placement modes include "wall_mounted"

2. **Placement Set Generation:**
   - Verify materialRules includes reclaimed_teak rules
   - Check prompt includes correct material behavior
   - Verify placement instructions are appropriate for mirrors

3. **Composite Rendering:**
   - Verify 8 variants are generated
   - Check each variant has distinct placement
   - Verify mirror is always wall-mounted (never on floor)

4. **Monitor Display:**
   - Check extracted facts are visible
   - Verify placement set shows 8 variants
   - Confirm LLM calls show correct prompts

---

## Action Items

### Immediate Actions Required

1. **Verify Template Variables Match**
   - Query DB for template content of 'placement_set_generator' and 'composite_instruction'
   - Compare variable names in templates with variable names passed in code
   - Document any mismatches

2. **Trace Image Hash Computation**
   - Find where `productImage.hash` is computed
   - Verify same buffer is used for hashing and API call

3. **Test with Sample Product**
   - Run full pipeline with Detailed Sundar Mirror
   - Capture debugPayload at each stage
   - Compare stored vs expected values

4. **Verify Monitor Display**
   - Check that monitor shows correct extracted facts
   - Verify placement set is displayed correctly
   - Confirm LLM call prompts match what was sent

### Verification Commands

```bash
# Query prompt templates from database
psql $DATABASE_URL -c "
  SELECT name, system_template, user_template 
  FROM prompt_definitions 
  WHERE name IN ('placement_set_generator', 'composite_instruction', 'product_fact_extractor');
"

# Check active versions
psql $DATABASE_URL -c "
  SELECT pd.name, pv.version, pv.user_template
  FROM prompt_definitions pd
  JOIN prompt_versions pv ON pd.id = pv.prompt_definition_id
  WHERE pv.status = 'ACTIVE' 
  AND pd.name IN ('placement_set_generator', 'composite_instruction');
"
```

---

## Summary of Key Risks

| Risk | Severity | Likelihood | Detection |
|------|----------|------------|-----------|
| Template variable names don't match code | HIGH | MEDIUM | Check DB vs code |
| **Image hash inconsistency (16 vs 64 char)** | **CRITICAL** | **CONFIRMED** | **Code audit found issue** |
| Prompt text stored ≠ prompt text sent | CRITICAL | LOW | Code review shows match |
| debugPayload params ≠ actual params | MEDIUM | LOW | Code review shows match |
| Image order incorrect in composite | MEDIUM | LOW | Code review shows correct |
| Unreplaced template variables | HIGH | MEDIUM | Check debugPayload for {{}} |

**Next Step:** Execute the test scenario with the sample product to verify actual behavior matches expected behavior.
