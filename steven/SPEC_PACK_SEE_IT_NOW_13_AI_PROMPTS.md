# 13 — AI Prompts (2-LLM Pipeline Architecture)

## Purpose
This document specifies the 2-LLM pipeline architecture for See It Now prompt generation and image rendering.

---

## Architecture Overview

See It Now uses a **2-LLM pipeline** to generate hero shot visualizations:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PREPARATION PHASE                                  │
│                        (runs during product prep)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Product Data + Images                                                     │
│           │                                                                 │
│           ▼                                                                 │
│   ┌───────────────┐                                                         │
│   │   LLM #1      │  gemini-2.5-flash-preview-05-20 (text + vision)        │
│   │   Extractor   │  Analyzes product → ProductPlacementFacts JSON         │
│   └───────────────┘                                                         │
│           │                                                                 │
│           ▼                                                                 │
│   ┌───────────────┐                                                         │
│   │   Resolver    │  Deterministic merge:                                   │
│   │               │  extracted + merchantOverrides → resolvedFacts          │
│   └───────────────┘                                                         │
│           │                                                                 │
│           ▼                                                                 │
│   ┌───────────────┐                                                         │
│   │   LLM #2      │  gemini-2.5-flash-preview-05-20 (text only)            │
│   │ Prompt Builder│  resolvedFacts + rules → PromptPack (8 variants)       │
│   └───────────────┘                                                         │
│           │                                                                 │
│           ▼                                                                 │
│   Store: extractedFacts, resolvedFacts, promptPack → ProductAsset          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            RENDER PHASE                                      │
│                     (runs on customer request)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Request: room_session_id + product_id                                     │
│           │                                                                 │
│           ▼                                                                 │
│   Load: resolvedFacts, promptPack from ProductAsset                         │
│           │                                                                 │
│           ▼                                                                 │
│   ┌───────────────┐                                                         │
│   │   Assembler   │  Deterministic concatenation:                           │
│   │               │  GLOBAL_RENDER_STATIC + product_context + variation     │
│   └───────────────┘                                                         │
│           │                                                                 │
│           ▼                                                                 │
│   ┌───────────────┐                                                         │
│   │   Renderer    │  gemini-2.5-flash-image                                 │
│   │               │  8 parallel Gemini calls → 8 variant images             │
│   └───────────────┘                                                         │
│           │                                                                 │
│           ▼                                                                 │
│   Upload to GCS, log to RenderRun + VariantResult tables                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Model Configuration

### Locked Model Names

```typescript
// config/ai-models.config.ts

// Text + Vision extraction and prompt building
export const GEMINI_TEXT_MODEL = "gemini-2.5-flash-preview-05-20" as const;

// Image generation (text + image input, image output)
export const GEMINI_IMAGE_MODEL_FAST = "gemini-2.5-flash-image" as const;
export const GEMINI_IMAGE_MODEL_PRO = "gemini-3-pro-image-preview" as const;

// Background removal (local library, not Gemini)
export const MODEL_FOR_PRODUCT_PREP = "imgly-background-removal" as const;
```

### Model Usage

| Use Case | Model |
|----------|-------|
| Product fact extraction (LLM #1) | gemini-2.5-flash-preview-05-20 |
| Prompt pack building (LLM #2) | gemini-2.5-flash-preview-05-20 |
| Hero shot generation | gemini-2.5-flash-image |
| Upscale/enhance | gemini-3-pro-image-preview |
| Background removal | @imgly/background-removal-node |

---

## LLM #1: Product Fact Extractor

### Purpose
Extract structured placement facts from product data and images.

### Input
```typescript
interface ExtractionInput {
  title: string;
  description: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  metafields: Record<string, string>;
  imageUrls: string[];  // 1-3 product images
}
```

### Output: ProductPlacementFacts
```typescript
interface ProductPlacementFacts {
  identity: {
    title: string;
    product_kind: string | null;
    category_path: string[];
    style_cues: string[];
  };

  dimensions_cm: {
    h: number | null;
    w: number | null;
    d: number | null;
    diameter: number | null;
    thickness: number | null;
  };

  weight_class: "very_heavy" | "heavy" | "medium" | "light" | "unknown";
  deformability: "rigid" | "semi_rigid" | "flexible_drape" | "unknown";

  placement: {
    allowed_modes: Array<{ mode: string; confidence: number; evidence: string | null }>;
    support_surfaces: Array<{ surface: string; confidence: number; evidence: string | null }>;
    constraints: string[];
    do_not_do: string[];
  };

  orientation: {
    constraint: "upright_only" | "can_rotate_slightly" | "free_rotation" | "unknown";
    notes: string | null;
  };

  scale: {
    priority: "strict_true_to_dimensions" | "prefer_true_to_dimensions" | "flexible_if_no_reference";
    notes: string | null;
  };

  relative_scale: {
    class: "tiny" | "small" | "medium" | "large" | "oversized" | "architectural" | "unknown";
    evidence: string | null;
    comparisons: Array<{ to: string; confidence: number; evidence: string | null }>;
  };

  material_profile: {
    primary: "reclaimed_teak" | "painted_wood" | "glass" | "mirror" | "ceramic" | "metal" | "stone" | "fabric" | "leather" | "mixed" | "unknown";
    sheen: "matte" | "satin" | "gloss" | "unknown";
    transparency: "opaque" | "translucent" | "transparent" | "unknown";
    notes: string | null;
  };

  render_behavior: {
    surface: Array<{ kind: string; strength: string | null; notes: string | null }>;
    lighting: Array<{ kind: string; notes: string | null }>;
    interaction_rules: string[];
    cropping_policy: "never_crop_product" | "allow_small_crop" | "allow_crop_if_needed";
  };

  scale_guardrails: string | null;
  affordances: string[];
  unknowns: string[];
}
```

### Location
- Prompt: `config/prompts/extractor.prompt.ts`
- Schema: `config/schemas/product-facts.schema.ts`
- Service: `services/see-it-now/extractor.server.ts`

---

## Resolver

### Purpose
Merge extractedFacts with merchantOverrides to produce resolvedFacts.

### Logic
```typescript
function resolveProductFacts(
  extractedFacts: ProductPlacementFacts,
  merchantOverrides: Partial<ProductPlacementFacts> | null
): ProductPlacementFacts {
  if (!merchantOverrides) return extractedFacts;
  return deepMerge(extractedFacts, merchantOverrides);
}
```

Merchant overrides are stored as a **diff only** - only the fields the merchant changed.

### Location
- Service: `services/see-it-now/resolver.server.ts`

---

## LLM #2: Prompt Builder

### Purpose
Generate product_context and 8 variant-specific prompts from resolvedFacts.

### Input
- resolvedFacts: ProductPlacementFacts
- Material rules (from material-behaviors.config.ts)
- Variant intents (V01-V08 from variant-intents.config.ts)
- Scale guardrails (from scale-guardrails.config.ts)

### Output: PromptPack
```typescript
interface PromptPack {
  product_context: string;    // ~200-400 words describing the product
  variants: PromptPackVariant[];  // Exactly 8 variants (V01-V08)
}

interface PromptPackVariant {
  id: string;        // "V01" through "V08"
  variation: string; // The specific prompt for this variant
}
```

### Location
- Prompt: `config/prompts/prompt-builder.prompt.ts`
- Service: `services/see-it-now/prompt-builder.server.ts`

---

## Variant Intents (V01-V08)

The 8-variant "controlled bracket" systematically explores placement and scale:

| ID | Intent | Placement Mode | Scale Strategy |
|----|--------|----------------|----------------|
| V01 | Primary expected placement, best-guess scale | primary | best-guess |
| V02 | Same placement as V01, conservative scale | primary | smaller (15-25%) |
| V03 | Same placement as V01, bold scale | primary | larger (15-25%) |
| V04 | Secondary valid placement, best-guess scale | secondary | best-guess |
| V05 | Secondary placement, conservative scale | secondary | smaller (15-25%) |
| V06 | Alternative room anchor point, best-guess scale | alternative | best-guess |
| V07 | Context-heavy framing for strong scale cues | primary | context-heavy |
| V08 | Escape hatch: maximum realism, conservative scale | primary | conservative |

### Location
- Config: `config/prompts/variant-intents.config.ts`

---

## Material Behaviors

Material-specific rendering rules applied during prompt building:

| Material | Special Rules |
|----------|---------------|
| mirror | Must show reflection of room |
| glass | Handle transparency, show through |
| reclaimed_teak | Preserve natural patina, grain variations |
| painted_wood | Maintain paint finish without adding wear |
| ceramic | Show subtle glaze reflections |
| metal | Handle specular highlights |
| stone | Preserve texture, natural variations |
| fabric | Handle soft shadows, draping |
| leather | Show material texture |

### Location
- Config: `config/prompts/material-behaviors.config.ts`

---

## Scale Guardrails

Scale templates based on relative_scale class:

| Scale Class | Guardrail Template |
|-------------|-------------------|
| architectural | "This is an architectural-scale piece. Should claim significant visual space. Never scale down for convenience." |
| oversized | "This is oversized furniture. Should dominate the composition. Use ceiling height as primary reference." |
| large | "This is large furniture. Use doorways, sofas, and other furniture as scale references." |
| medium | "This is medium-sized furniture or decor. Scale relative to nearby furniture." |
| small | "This is small decor or homeware. Should remain modestly scaled. Use tabletops and shelves as references." |
| tiny | "This is a tiny decorative item. Keep proportionally small. Do not enlarge to fill space." |

### Location
- Config: `config/prompts/scale-guardrails.config.ts`

---

## Global Render Static

Hardcoded mandatory rules that are NEVER generated by an LLM:

```typescript
// config/prompts/global-render.prompt.ts

export const GLOBAL_RENDER_STATIC = `You are compositing a product into a customer's room photo for ecommerce visualization.

IMAGE ROLES
- prepared_product_image: The product with transparent background. This is the exact item being sold.
- customer_room_image: The customer's real room photo. This must be preserved exactly.

MANDATORY RULES

1. ASPECT RATIO: Output must match the aspect ratio and full frame of customer_room_image exactly.

2. ROOM PRESERVATION: Change only what is required to realistically insert the product into customer_room_image. Keep everything else exactly the same.

3. SINGLE COMPOSITE: Output a single photoreal image of customer_room_image with the product added naturally. Not a collage. Not a split view.

4. SCALE DOWN, NEVER CROP: If the product would be cut off by the frame, reduce its scale slightly until the entire product is visible.

5. BACKGROUND DISCARD: The transparent background of prepared_product_image must be completely discarded.

6. IDENTITY PRESERVATION: Preserve the exact character of the product — natural patina, wood grain variations, surface imperfections.

7. NO INVENTED HARDWARE: For mirrors and framed items, preserve exact frame and mounting hardware.

8. PHYSICAL REALISM: Correct perspective, accurate shadows, proper occlusion, consistent reflections.

9. NO STYLIZATION: No filters, color grading, vignettes, or artistic effects.

Return only the final composed image.`;
```

---

## Final Prompt Assembly

Deterministic concatenation (NO LLM):

```typescript
function assembleFinalPrompt(
  productContext: string,
  variation: string
): string {
  return [
    GLOBAL_RENDER_STATIC,
    "",
    "Product context:",
    productContext,
    "",
    "Variation:",
    variation,
  ].join("\n\n");
}
```

### Location
- Service: `services/see-it-now/prompt-assembler.server.ts`

---

## Renderer

### Purpose
Execute 8 parallel Gemini image generation calls.

### API Call
```typescript
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

const parts = [
  { inlineData: { mimeType: "image/png", data: productBase64 } },
  { inlineData: { mimeType: "image/jpeg", data: roomBase64 } },
  { text: finalPrompt },
];

const result = await model.generateContent({
  contents: [{ role: "user", parts }],
  generationConfig: {
    responseModalities: ["TEXT", "IMAGE"],
  },
});
```

### Image Order
1. Product cutout (PNG with transparency) — FIRST
2. Room photo (JPEG) — SECOND (determines aspect ratio)
3. Prompt text — LAST

### Location
- Service: `services/see-it-now/renderer.server.ts`

---

## Database Storage

### ProductAsset Fields (New)
```prisma
model ProductAsset {
  // ... existing fields ...
  
  // 2-LLM Pipeline Fields
  extractedFacts      Json?     @map("extracted_facts")      // LLM #1 output
  merchantOverrides   Json?     @map("merchant_overrides")   // Merchant edits (diff only)
  resolvedFacts       Json?     @map("resolved_facts")       // merged(extracted, overrides)
  promptPack          Json?     @map("prompt_pack")          // LLM #2 output
  promptPackVersion   Int?      @map("prompt_pack_version")
  extractedAt         DateTime? @map("extracted_at")
}
```

### RenderRun Table (New)
```prisma
model RenderRun {
  id                String   @id @default(uuid())
  shopId            String   @map("shop_id")
  productAssetId    String   @map("product_asset_id")
  roomSessionId     String   @map("room_session_id")
  requestId         String   @map("request_id")
  promptPackVersion Int      @map("prompt_pack_version")
  model             String
  
  // Image hashes for deduplication
  productImageHash  String   @map("product_image_hash")
  productImageMeta  Json     @map("product_image_meta")
  roomImageHash     String   @map("room_image_hash")
  roomImageMeta     Json     @map("room_image_meta")
  
  // Prompt tracking
  resolvedFactsHash String   @map("resolved_facts_hash")
  resolvedFactsJson Json     @map("resolved_facts_json")
  promptPackHash    String   @map("prompt_pack_hash")
  promptPackJson    Json     @map("prompt_pack_json")
  
  // Results
  totalDurationMs   Int?     @map("total_duration_ms")
  status            String   // "complete" | "partial" | "failed"
  
  createdAt         DateTime @default(now()) @map("created_at")
  
  // Relations
  shop           Shop           @relation(fields: [shopId], references: [id])
  productAsset   ProductAsset   @relation(fields: [productAssetId], references: [id])
  variantResults VariantResult[]
  
  @@map("render_runs")
}
```

### VariantResult Table (New)
```prisma
model VariantResult {
  id              String   @id @default(uuid())
  renderRunId     String   @map("render_run_id")
  variantId       String   @map("variant_id")  // "V01" through "V08"
  finalPromptHash String   @map("final_prompt_hash")
  status          String   // "success" | "failed" | "timeout"
  latencyMs       Int      @map("latency_ms")
  outputImageKey  String?  @map("output_image_key")
  outputImageHash String?  @map("output_image_hash")
  errorMessage    String?  @map("error_message")
  
  createdAt       DateTime @default(now()) @map("created_at")
  
  renderRun RenderRun @relation(fields: [renderRunId], references: [id])
  
  @@map("variant_results")
}
```

### PromptVersion Table (New)
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

## GCS Storage Layout

```
see-it-now/{runId}/{variantId}.jpg
```

Example:
```
see-it-now/550e8400-e29b-41d4-a716-446655440000/V01.jpg
see-it-now/550e8400-e29b-41d4-a716-446655440000/V02.jpg
...
see-it-now/550e8400-e29b-41d4-a716-446655440000/V08.jpg
```

---

## Error Handling

### Partial Success
If some variants succeed and others fail:
- Return successful variants
- Log failed variants to VariantResult
- Status = "partial" if 1-7 succeed
- Status = "failed" if 0 succeed

### Timeouts
- Per-variant timeout: 45 seconds
- Total render timeout: None (parallel execution)

---

## File Locations

```
app/
├── config/
│   ├── prompts/
│   │   ├── global-render.prompt.ts      # GLOBAL_RENDER_STATIC
│   │   ├── extractor.prompt.ts          # LLM #1 system prompt
│   │   ├── prompt-builder.prompt.ts     # LLM #2 system prompt
│   │   ├── variant-intents.config.ts    # V01-V08 definitions
│   │   ├── material-behaviors.config.ts # Material-specific rules
│   │   └── scale-guardrails.config.ts   # Scale templates
│   └── schemas/
│       └── product-facts.schema.ts      # JSON schema for extraction
├── services/
│   └── see-it-now/
│       ├── index.ts                     # Exports
│       ├── types.ts                     # TypeScript interfaces
│       ├── extractor.server.ts          # LLM #1
│       ├── resolver.server.ts           # Merge logic
│       ├── prompt-builder.server.ts     # LLM #2
│       ├── prompt-assembler.server.ts   # Deterministic assembly
│       ├── renderer.server.ts           # Parallel Gemini calls
│       ├── monitor.server.ts            # DB logging
│       └── versioning.server.ts         # Prompt version tracking
└── routes/
    ├── app-proxy.see-it-now.render.ts   # /apps/see-it/see-it-now/render
    ├── app.monitor.tsx                  # Admin monitor UI
    └── api.monitor.run.$id.tsx          # Monitor API
```

---

## Upscale Prompt (Unchanged)

Used when user clicks Share with upscale=true:

```
Enhance this interior photograph to professional quality.
Improve sharpness, detail, and color accuracy while maintaining the exact composition.
Do not change the placement of any objects.
```

Model: gemini-3-pro-image-preview
