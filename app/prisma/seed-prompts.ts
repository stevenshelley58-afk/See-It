// =============================================================================
// SEED SCRIPT: Backfill existing prompts into database
// Run this once after migration to populate PromptDefinition and PromptVersion
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
import { PrismaClient } from "@prisma/client";

// Import prompts from existing config files
import {
  EXTRACTOR_SYSTEM_PROMPT,
  EXTRACTOR_USER_PROMPT_TEMPLATE,
} from "~/config/prompts/extractor.prompt.js";
import {
  PROMPT_BUILDER_SYSTEM_PROMPT,
  PROMPT_BUILDER_USER_PROMPT_TEMPLATE,
} from "~/config/prompts/prompt-builder.prompt.js";
import { GLOBAL_RENDER_STATIC } from "~/config/prompts/global-render.prompt.js";

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
// Prompt seed data from existing prompt files
// =============================================================================
interface PromptSeed {
  name: string;
  description: string;
  defaultModel: string;
  defaultParams: Record<string, unknown>;
  systemTemplate: string;
  developerTemplate: string | null;
  userTemplate: string | null;
}

const PROMPTS_TO_SEED: PromptSeed[] = [
  {
    name: "extractor",
    description:
      "LLM #1: Extract product placement facts from images and text (text+vision model)",
    defaultModel: "gemini-2.5-flash",
    defaultParams: {
      temperature: 0.3,
      top_p: 0.95,
      max_tokens: 4096,
    },
    systemTemplate: EXTRACTOR_SYSTEM_PROMPT,
    developerTemplate: null,
    userTemplate: EXTRACTOR_USER_PROMPT_TEMPLATE,
  },
  {
    name: "prompt_builder",
    description:
      "LLM #2: Generate product context and 8 placement variations (text-only model)",
    defaultModel: "gemini-2.5-flash",
    defaultParams: {
      temperature: 0.5,
      top_p: 0.95,
      max_tokens: 4096,
    },
    systemTemplate: PROMPT_BUILDER_SYSTEM_PROMPT,
    developerTemplate: null,
    userTemplate: PROMPT_BUILDER_USER_PROMPT_TEMPLATE,
  },
  {
    name: "global_render",
    description:
      "Global rendering rules prepended to all render prompts (image generation model)",
    defaultModel: "gemini-2.5-flash-image",
    defaultParams: {
      temperature: 0.3,
      top_p: 0.95,
      max_tokens: 8192,
    },
    systemTemplate: GLOBAL_RENDER_STATIC,
    developerTemplate: null,
    userTemplate: null,
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
  // Note: shopDomain is unique, so we use a special domain
  await prisma.shop.create({
    data: {
      id: SYSTEM_TENANT_ID,
      shopDomain: "system.see-it.internal",
      shopifyShopId: "0", // Placeholder - not a real Shopify shop
      accessToken: "system-internal-token", // Placeholder - never used for API calls
      plan: "system",
      monthlyQuota: 0,
      dailyQuota: 0,
      settingsJson: JSON.stringify({ isSystemTenant: true }),
    },
  });

  console.log("  [created] SYSTEM shop entry\n");
}

/**
 * Seed system prompts from existing prompt files.
 * Creates PromptDefinitions and active PromptVersions.
 */
async function seedSystemPrompts(): Promise<void> {
  console.log("Seeding system prompts...\n");

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
        defaultParams: prompt.defaultParams,
      },
    });

    // Compute template hash per PRD spec
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
        params: prompt.defaultParams,
        templateHash,
        changeNotes: "Initial version migrated from hardcoded prompts",
        createdBy: "system",
        activatedAt: new Date(),
        activatedBy: "system",
      },
    });

    console.log(`    [created] Definition + v1 ACTIVE (hash: ${templateHash})\n`);
  }

  console.log("System prompts seeded successfully!\n");
}

/**
 * Create default ShopRuntimeConfig for all existing shops that don't have one.
 * This ensures all shops have the runtime guardrails configured.
 */
async function seedShopRuntimeConfigs(): Promise<void> {
  console.log("Creating default runtime configs for existing shops...\n");

  // Get all shops that don't have a runtime config
  // Exclude the SYSTEM tenant (it doesn't need runtime config)
  const shopsWithoutConfig = await prisma.shop.findMany({
    where: {
      runtimeConfig: null,
      id: {
        not: SYSTEM_TENANT_ID,
      },
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
        maxImageBytesCap: 20_000_000, // 20MB
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
 * Verify the seed was successful by checking the data.
 */
async function verifySeed(): Promise<void> {
  console.log("Verifying seed...\n");

  // Check SYSTEM shop exists
  const systemShop = await prisma.shop.findUnique({
    where: { id: SYSTEM_TENANT_ID },
  });
  console.log(`  SYSTEM shop: ${systemShop ? "OK" : "MISSING"}`);

  // Check all prompts exist with active versions
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

  // Count runtime configs
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
  console.log("  PROMPT CONTROL PLANE - SEED SCRIPT");
  console.log("========================================\n");

  try {
    // Step 1: Ensure SYSTEM shop exists (required for foreign key)
    await ensureSystemShop();

    // Step 2: Seed system prompts
    await seedSystemPrompts();

    // Step 3: Create default runtime configs for existing shops
    await seedShopRuntimeConfigs();

    // Step 4: Verify
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
