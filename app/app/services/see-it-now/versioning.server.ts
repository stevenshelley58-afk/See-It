import crypto from "crypto";
import prisma from "~/db.server";
import { logger, createLogContext } from "~/utils/logger.server";

import { EXTRACTOR_SYSTEM_PROMPT } from "~/config/prompts/extractor.prompt";
import { PROMPT_BUILDER_SYSTEM_PROMPT } from "~/config/prompts/prompt-builder.prompt";
import { GLOBAL_RENDER_STATIC } from "~/config/prompts/global-render.prompt";
import { VARIANT_INTENTS } from "~/config/prompts/variant-intents.config";
import { MATERIAL_BEHAVIORS } from "~/config/prompts/material-behaviors.config";
import { SCALE_GUARDRAIL_TEMPLATES } from "~/config/prompts/scale-guardrails.config";

function hashString(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function hashObject(obj: object): string {
  return hashString(JSON.stringify(obj));
}

interface PromptHashes {
  extractorPromptHash: string;
  builderPromptHash: string;
  globalPromptHash: string;
  variantIntentsHash: string;
  materialBehaviorsHash: string;
  scaleGuardrailsHash: string;
}

/**
 * Compute current hashes for all prompt config files
 */
export function computePromptHashes(): PromptHashes {
  return {
    extractorPromptHash: hashString(EXTRACTOR_SYSTEM_PROMPT),
    builderPromptHash: hashString(PROMPT_BUILDER_SYSTEM_PROMPT),
    globalPromptHash: hashString(GLOBAL_RENDER_STATIC),
    variantIntentsHash: hashObject(VARIANT_INTENTS),
    materialBehaviorsHash: hashObject(MATERIAL_BEHAVIORS),
    scaleGuardrailsHash: hashObject(SCALE_GUARDRAIL_TEMPLATES),
  };
}

/**
 * Get current prompt version number
 */
export async function getCurrentPromptVersion(): Promise<number> {
  const latest = await prisma.promptVersion.findFirst({
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return latest?.version || 0;
}

/**
 * Ensure a PromptVersion exists for current config
 * Creates new version if hashes have changed
 * Returns the current version number
 */
export async function ensurePromptVersion(): Promise<number> {
  const hashes = computePromptHashes();

  // Check if a version with these exact hashes exists
  const existing = await prisma.promptVersion.findFirst({
    where: {
      extractorPromptHash: hashes.extractorPromptHash,
      builderPromptHash: hashes.builderPromptHash,
      globalPromptHash: hashes.globalPromptHash,
      variantIntentsHash: hashes.variantIntentsHash,
      materialBehaviorsHash: hashes.materialBehaviorsHash,
      scaleGuardrailsHash: hashes.scaleGuardrailsHash,
    },
    select: { version: true },
  });

  if (existing) {
    return existing.version;
  }

  // Create new version
  const currentVersion = await getCurrentPromptVersion();
  const newVersion = currentVersion + 1;

  const configSnapshot = {
    extractorPrompt: EXTRACTOR_SYSTEM_PROMPT,
    builderPrompt: PROMPT_BUILDER_SYSTEM_PROMPT,
    globalPrompt: GLOBAL_RENDER_STATIC,
    variantIntents: VARIANT_INTENTS,
    materialBehaviors: MATERIAL_BEHAVIORS,
    scaleGuardrails: SCALE_GUARDRAIL_TEMPLATES,
  };

  await prisma.promptVersion.create({
    data: {
      version: newVersion,
      ...hashes,
      configSnapshot,
    },
  });

  logger.info(
    createLogContext("system", "system", "new-version", { version: newVersion }),
    `Created new prompt version: ${newVersion}`
  );

  return newVersion;
}
