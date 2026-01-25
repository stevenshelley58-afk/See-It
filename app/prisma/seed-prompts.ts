// =============================================================================
// SEED SCRIPT: Canonical Prompts for See It Now Pipeline
//
// Populates PromptDefinition and PromptVersion for the 3 canonical prompts:
// - product_fact_extractor (LLM #1)
// - placement_set_generator (LLM #2)
// - composite_instruction (LLM #3)
//
// Prerequisites:
//   1. Run the migration first: npx prisma migrate dev
//   2. Generate the Prisma client: npx prisma generate
//
// Usage:
//   npm run seed:prompts
//   # or directly:
//   npx tsx prisma/seed-prompts.ts
//
// This script is idempotent - safe to run multiple times.
// =============================================================================

import { createHash } from "crypto";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// =============================================================================
// SYSTEM tenant for global fallback prompts
// =============================================================================
const SYSTEM_TENANT_ID = "SYSTEM";

/**
 * Compute templateHash = sha256(JSON.stringify({ systemTemplate, developerTemplate, userTemplate, model, params }))
 * Truncated to 16 characters for readability
 */
function computeTemplateHash(data: {
  systemTemplate: string | null;
  developerTemplate: string | null;
  userTemplate: string | null;
  model: string | null;
  params: unknown;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

// =============================================================================
// CANONICAL PROMPT TEMPLATES (Inlined - no external dependencies)
// =============================================================================

const PRODUCT_FACT_EXTRACTOR_SYSTEM = `You extract product placement facts for a photorealistic product-in-room rendering system.

Extract as much as possible from the provided text and images.
If multiple placement modes are plausible, include them with confidence scores.
If something is unknown, mark it unknown — do not guess.

CRITICAL RULES:
- Do not write marketing copy
- Do not write prompts
- Do not invent dimensions or scale
- Extract relative scale cues only when supported by evidence (title, text, tags, metafields, or obvious visual cues)

RELATIVE SCALE EXTRACTION:
Look for these keywords and capture them as relative_scale.class with evidence:
- "oversized", "large", "XL", "floor mirror", "statement piece" → oversized or large
- "petite", "tabletop", "small", "mini" → small or tiny
- Standard furniture terms without size modifiers → medium

MATERIAL EXTRACTION:
Be specific enough to drive render behavior:
- "mirror" vs "glass" vs "reclaimed teak" vs "ceramic" vs "metal"
- Note sheen: matte, satin, gloss
- Note transparency: opaque, translucent, transparent

Return ProductFacts as JSON.`;

const PRODUCT_FACT_EXTRACTOR_USER = `Product Title: {{title}}

Product Description:
{{description}}

Product Type: {{productType}}
Vendor: {{vendor}}
Tags: {{tags}}

Metafields:
{{metafields}}

Analyze the product information and images above. Return ProductFacts JSON.`;

const PLACEMENT_SET_GENERATOR_SYSTEM = `You write product context and placement variations for a product visualization system.

You will receive:
1. resolved_facts: Complete product placement facts
2. material_rules: Specific rendering rules for this product's material
3. variant_intents: The 8 variation strategies you must implement

YOUR OUTPUT:
You generate TWO things only:
1. productDescription: A paragraph describing the product for the rendering system
2. variants: An array of 8 objects, each with id and placementInstruction text

YOU DO NOT GENERATE:
- Global rules (these are hardcoded separately)
- Image handling instructions
- Aspect ratio rules
- Room preservation rules

PRODUCT DESCRIPTION REQUIREMENTS:
- Describe the product's visual identity, materials, and character
- Include the material rendering rules provided
- MUST include this exact line: "Relative scale: {scale_guardrails}"
- Keep it factual and specific, not marketing copy

PLACEMENT INSTRUCTION REQUIREMENTS:
- Each instruction describes WHERE and HOW to place the product
- Each instruction MUST include a short camera/framing clause (1-2 sentences) describing viewpoint/framing consistency
- Follow the intent and scale strategy specified for each variant ID
- V01, V04, V06 must reference a specific in-frame scale anchor
- V02 must be 15-25% smaller than V01
- V03 must be 15-25% larger than V01
- V05 must be 15-25% smaller than V04
- V07 emphasizes multiple scale references
- V08 is the conservative escape hatch

Output JSON only:
{
  "productDescription": "string",
  "variants": [
    { "id": "V01", "placementInstruction": "string" },
    { "id": "V02", "placementInstruction": "string" },
    { "id": "V03", "placementInstruction": "string" },
    { "id": "V04", "placementInstruction": "string" },
    { "id": "V05", "placementInstruction": "string" },
    { "id": "V06", "placementInstruction": "string" },
    { "id": "V07", "placementInstruction": "string" },
    { "id": "V08", "placementInstruction": "string" }
  ]
}`;

const PLACEMENT_SET_GENERATOR_USER = `RESOLVED FACTS:
{{resolvedFactsJson}}

MATERIAL RULES FOR {{materialPrimary}}:
{{materialRules}}

SCALE GUARDRAILS (must include verbatim in productDescription):
{{scaleGuardrails}}

VARIANT INTENTS:
{{variantIntentsJson}}

Generate productDescription and 8 placement instructions following the intents exactly.`;

const COMPOSITE_INSTRUCTION_SYSTEM = `You are compositing a product into a customer's room photo for ecommerce visualization.

IMAGE ROLES
- prepared_product_image: The product with transparent background. This is the exact item being sold.
- customer_room_image: The customer's real room photo. This must be preserved exactly.

MANDATORY RULES

0. COMPOSITION: Place the product from prepared_product_image into customer_room_image. The room remains the base image.

0b. LIGHTING MATCH: Match direction, softness, intensity, and color temperature of the room light. Ensure the product's contact shadow matches room cues.

0c. PHOTOGRAPHIC MATCH: Match the room photo's camera height and perspective. Match lens look and depth of field behavior to the room.

0d. PRESERVATION:
Do not redesign the product. Preserve exact geometry, proportions, materials, texture, and color.

1. ASPECT RATIO: Output must match the aspect ratio and full frame of customer_room_image exactly.

2. ROOM PRESERVATION: Change only what is required to realistically insert the product into customer_room_image. Keep everything else exactly the same — geometry, furnishings, colors, lighting, objects.

3. SINGLE COMPOSITE: Output a single photoreal image of customer_room_image with the product added naturally. Not a collage. Not a split view. Not a new room. Not a background swap.

4. SCALE DOWN, NEVER CROP: If the product would be cut off by the frame, reduce its scale slightly until the entire product is visible. Do not crop the product.

5. BACKGROUND DISCARD: The transparent background of prepared_product_image must be completely discarded. Only the product itself appears in the output.

6. IDENTITY PRESERVATION: Preserve the exact character of the product — natural patina, wood grain variations, surface imperfections, weathering marks. These are features, not flaws. Do not smooth, polish, or idealize.

7. NO INVENTED HARDWARE: For mirrors and framed items, preserve the exact frame, mounting hardware, and edge details from prepared_product_image. Do not add, remove, or modify hardware.

8. PHYSICAL REALISM: Correct perspective matching the room's camera angle. Accurate shadows based on room lighting. Proper occlusion where the product meets room surfaces. Reflections consistent with room environment (for reflective materials).

9. NO STYLIZATION: No filters, color grading, vignettes, or artistic effects. No text or logos.

Return only the final composed image.`;

const COMPOSITE_INSTRUCTION_USER = `PRODUCT DESCRIPTION:
{{productDescription}}

PLACEMENT INSTRUCTION:
{{placementInstruction}}

Compose the product into the room following the placement instruction above.`;

// =============================================================================
// Prompt seed data
// =============================================================================
interface PromptSeed {
  name: string;
  description: string;
  defaultModel: string;
  defaultParams: Record<string, unknown>;
  systemTemplate: string;
  developerTemplate: string | null;
  userTemplate: string;
}

const PROMPTS_TO_SEED: PromptSeed[] = [
  {
    name: "product_fact_extractor",
    description:
      "LLM #1: Extract product placement facts from images and text",
    defaultModel: "gemini-2.5-flash",
    defaultParams: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
    systemTemplate: PRODUCT_FACT_EXTRACTOR_SYSTEM,
    developerTemplate: null,
    userTemplate: PRODUCT_FACT_EXTRACTOR_USER,
  },
  {
    name: "placement_set_generator",
    description:
      "LLM #2: Generate productDescription and 8 placement instructions",
    defaultModel: "gemini-2.5-flash",
    defaultParams: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
    systemTemplate: PLACEMENT_SET_GENERATOR_SYSTEM,
    developerTemplate: null,
    userTemplate: PLACEMENT_SET_GENERATOR_USER,
  },
  {
    name: "composite_instruction",
    description:
      "LLM #3: Composite product into room (image generation)",
    defaultModel: "gemini-2.5-flash-preview-04-17",
    defaultParams: {
      responseModalities: ["TEXT", "IMAGE"],
    },
    systemTemplate: COMPOSITE_INSTRUCTION_SYSTEM,
    developerTemplate: null,
    userTemplate: COMPOSITE_INSTRUCTION_USER,
  },
];

// =============================================================================
// Seed Functions
// =============================================================================

/**
 * Create or find the SYSTEM shop entry.
 * This is the fallback tenant for all shops that don't have custom prompts.
 */
async function ensureSystemShop(): Promise<void> {
  console.log("Ensuring SYSTEM shop exists...\n");

  const existing = await prisma.shop.findUnique({
    where: { id: SYSTEM_TENANT_ID },
  });

  if (existing) {
    console.log("  [skip] SYSTEM shop already exists\n");
    return;
  }

  // Create the SYSTEM shop entry
  await prisma.shop.create({
    data: {
      id: SYSTEM_TENANT_ID,
      shopDomain: "system.see-it.internal",
      shopifyShopId: "0",
      accessToken: "system-internal-token",
      plan: "system",
      monthlyQuota: 0,
      dailyQuota: 0,
      settingsJson: JSON.stringify({ isSystemTenant: true }),
    },
  });

  console.log("  [created] SYSTEM shop entry\n");
}

/**
 * Seed canonical prompts.
 * Creates PromptDefinitions and active PromptVersions.
 */
async function seedCanonicalPrompts(): Promise<void> {
  console.log("Seeding canonical prompts...\n");

  for (const prompt of PROMPTS_TO_SEED) {
    console.log(`  Processing "${prompt.name}"...`);

    // Check if definition already exists (idempotent)
    const existing = await prisma.promptDefinition.findUnique({
      where: {
        shopId_name: {
          shopId: SYSTEM_TENANT_ID,
          name: prompt.name,
        },
      },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          take: 1,
        },
      },
    });

    if (existing) {
      console.log(`    [skip] Already exists (v${existing.versions[0]?.version ?? "?"})\n`);
      continue;
    }

    // Create definition
    const definition = await prisma.promptDefinition.create({
      data: {
        shopId: SYSTEM_TENANT_ID,
        name: prompt.name,
        description: prompt.description,
        defaultModel: prompt.defaultModel,
        defaultParams: prompt.defaultParams as unknown as Prisma.InputJsonValue,
      },
    });

    // Compute template hash
    const templateHash = computeTemplateHash({
      systemTemplate: prompt.systemTemplate,
      developerTemplate: prompt.developerTemplate,
      userTemplate: prompt.userTemplate,
      model: prompt.defaultModel,
      params: prompt.defaultParams,
    });

    // Create v1 as ACTIVE
    await prisma.promptVersion.create({
      data: {
        promptDefinitionId: definition.id,
        version: 1,
        status: "ACTIVE",
        systemTemplate: prompt.systemTemplate,
        developerTemplate: prompt.developerTemplate,
        userTemplate: prompt.userTemplate,
        model: prompt.defaultModel,
        params: prompt.defaultParams as unknown as Prisma.InputJsonValue,
        templateHash,
        changeNotes: "Initial version - canonical pipeline",
        createdBy: "system",
        activatedAt: new Date(),
        activatedBy: "system",
      },
    });

    console.log(`    [created] Definition + v1 ACTIVE (hash: ${templateHash})\n`);
  }

  console.log("Canonical prompts seeded successfully!\n");
}

/**
 * Create default ShopRuntimeConfig for all existing shops that don't have one.
 */
async function seedShopRuntimeConfigs(): Promise<void> {
  console.log("Creating default runtime configs for existing shops...\n");

  const shopsWithoutConfig = await prisma.shop.findMany({
    where: {
      runtimeConfig: null,
      id: { not: SYSTEM_TENANT_ID },
    },
    select: {
      id: true,
      shopDomain: true,
    },
  });

  if (shopsWithoutConfig.length === 0) {
    console.log("  [skip] All shops already have runtime configs\n");
    return;
  }

  for (const shop of shopsWithoutConfig) {
    console.log(`  Creating config for ${shop.shopDomain}...`);

    await prisma.shopRuntimeConfig.create({
      data: {
        shopId: shop.id,
        maxConcurrency: 5,
        forceFallbackModel: null,
        modelAllowList: [],
        maxTokensOutputCap: 8192,
        maxImageBytesCap: 20_000_000,
        dailyCostCap: 50.0,
        disabledPromptNames: [],
        updatedBy: "system",
      },
    });

    console.log("    [created]\n");
  }

  console.log(`Created runtime configs for ${shopsWithoutConfig.length} shops\n`);
}

/**
 * Verify the seed was successful.
 */
async function verifySeed(): Promise<void> {
  console.log("Verifying seed...\n");

  const systemShop = await prisma.shop.findUnique({
    where: { id: SYSTEM_TENANT_ID },
  });
  console.log(`  SYSTEM shop: ${systemShop ? "OK" : "MISSING"}`);

  for (const prompt of PROMPTS_TO_SEED) {
    const definition = await prisma.promptDefinition.findUnique({
      where: {
        shopId_name: {
          shopId: SYSTEM_TENANT_ID,
          name: prompt.name,
        },
      },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          take: 1,
        },
      },
    });

    const status = definition?.versions[0]
      ? `OK (v${definition.versions[0].version}, hash: ${definition.versions[0].templateHash})`
      : "MISSING";
    console.log(`  ${prompt.name}: ${status}`);
  }

  const configCount = await prisma.shopRuntimeConfig.count();
  const shopCount = await prisma.shop.count({
    where: { id: { not: SYSTEM_TENANT_ID } },
  });
  console.log(`  Runtime configs: ${configCount}/${shopCount} shops\n`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log("\n========================================");
  console.log("  CANONICAL PIPELINE - PROMPT SEED");
  console.log("========================================\n");

  try {
    await ensureSystemShop();
    await seedCanonicalPrompts();
    await seedShopRuntimeConfigs();
    await verifySeed();

    console.log("========================================");
    console.log("  SEED COMPLETE!");
    console.log("========================================\n");
  } catch (error) {
    console.error("\n[ERROR] Seed failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
