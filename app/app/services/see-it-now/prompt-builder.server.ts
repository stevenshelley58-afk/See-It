import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "~/utils/logger.server";
import {
  PROMPT_BUILDER_SYSTEM_PROMPT,
  PROMPT_BUILDER_USER_PROMPT_TEMPLATE,
} from "~/config/prompts/prompt-builder.prompt";
import { getMaterialRulesForPrompt } from "~/config/prompts/material-behaviors.config";
import { getVariantIntentsForPrompt } from "~/config/prompts/variant-intents.config";
import type { ProductPlacementFacts, PromptPack } from "./types";

// Use an env override so we can change models without a redeploy.
// Default stays on a widely-available Gemini API model.
const PROMPT_BUILDER_MODEL =
  process.env.SEE_IT_NOW_PROMPT_BUILDER_MODEL || "gemini-2.5-flash";

export async function buildPromptPack(
  resolvedFacts: ProductPlacementFacts,
  requestId: string
): Promise<PromptPack> {
  const logContext = createLogContext("prepare", requestId, "prompt-build-start", {
    productKind: resolvedFacts.identity?.product_kind,
  });

  logger.info(logContext, "Building prompt pack");

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Get material-specific rules
  const materialPrimary = resolvedFacts.material_profile?.primary || "unknown";
  const materialRules = getMaterialRulesForPrompt(materialPrimary);

  // Get scale guardrails
  const scaleGuardrails =
    resolvedFacts.scale_guardrails ||
    "Size appropriately for the product type.";

  // Get variant intents
  const variantIntentsJson = getVariantIntentsForPrompt();

  // Build user prompt
  const userPrompt = PROMPT_BUILDER_USER_PROMPT_TEMPLATE.replace(
    "{{resolvedFactsJson}}",
    JSON.stringify(resolvedFacts, null, 2)
  )
    .replace("{{materialPrimary}}", materialPrimary)
    .replace("{{materialRules}}", materialRules)
    .replace("{{scaleGuardrails}}", scaleGuardrails)
    .replace("{{variantIntentsJson}}", variantIntentsJson);

  try {
    const result = await client.models.generateContent({
      model: PROMPT_BUILDER_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: PROMPT_BUILDER_SYSTEM_PROMPT }, { text: userPrompt }],
        },
      ],
      config: { responseMimeType: "application/json", temperature: 0.2 },
    });

    const text = (result as any)?.text || "{}";
    let pack: PromptPack;

    try {
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      pack = JSON.parse(jsonStr);
    } catch (parseErr) {
      logger.error(
        { ...logContext, stage: "parse" },
        `Failed to parse prompt pack: ${parseErr}`
      );
      throw new Error("Failed to parse prompt pack as JSON");
    }

    // Validate we have 8 variants
    if (!pack.variants || pack.variants.length !== 8) {
      logger.warn(
        { ...logContext, stage: "validate" },
        `Expected 8 variants, got ${pack.variants?.length || 0}`
      );
      // Attempt to continue if we have at least some variants
      if (!pack.variants || pack.variants.length === 0) {
        throw new Error("No variants in prompt pack");
      }
    }

    // Validate scale_guardrails is in product_context
    if (!pack.product_context.toLowerCase().includes("relative scale")) {
      logger.warn(
        { ...logContext, stage: "validate" },
        "product_context missing 'Relative scale' line"
      );
      // Inject it
      pack.product_context += `\n\nRelative scale: ${scaleGuardrails}`;
    }

    logger.info(
      { ...logContext, stage: "complete" },
      `Prompt pack built: ${pack.variants.length} variants`
    );

    return pack;
  } catch (error) {
    logger.error(logContext, "Prompt builder failed", error);
    throw error;
  }
}
