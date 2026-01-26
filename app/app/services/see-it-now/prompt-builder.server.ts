// =============================================================================
// CANONICAL: Placement Set Generator (LLM #2)
// Generates PlacementSet from resolved ProductFacts
// =============================================================================

import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "~/utils/logger.server";
import { getMaterialRulesForPrompt } from "~/config/prompts/material-behaviors.config";
import { getVariantIntentsForPrompt } from "~/config/prompts/variant-intents.config";
import type { ProductFacts, PlacementSet, PlacementVariant, DebugPayload, CallSummary, OutputSummary } from "./types";
import { emit, EventSource, EventType, Severity } from "~/services/telemetry";
import { resolvePromptText } from "../prompt-control/prompt-resolver.server";
import { startCall, completeCallSuccess, completeCallFailure } from "../prompt-control/llm-call-tracker.server";
import { computeCallIdentityHash } from "./hashing.server";

// Use an env override so we can change models without a redeploy.
const PROMPT_BUILDER_MODEL = process.env.SEE_IT_NOW_PROMPT_BUILDER_MODEL || "gemini-2.5-flash";

// Legacy type for backward compatibility
interface LegacyPromptPack {
  product_context: string;
  variants: Array<{ id: string; variation: string }>;
}

function transformLegacyToCanonical(legacy: LegacyPromptPack): PlacementSet {
  return {
    productDescription: legacy.product_context,
    variants: legacy.variants.map(v => ({
      id: v.id,
      placementInstruction: v.variation,
    })),
  };
}

export interface BuildPlacementSetInput {
  resolvedFacts: ProductFacts;
  productAssetId: string;
  shopId: string;
  traceId: string;
}

export async function buildPlacementSet(args: BuildPlacementSetInput): Promise<PlacementSet> {
  const { resolvedFacts, productAssetId, shopId, traceId } = args;
  const logContext = createLogContext("prepare", traceId, "placement-set-build-start", {
    productKind: resolvedFacts.identity?.product_kind,
  });

  logger.info(logContext, "Building placement set");

  // Emit builder started event
  emit({
    shopId,
    requestId: traceId,
    source: EventSource.PROMPT_BUILDER,
    type: EventType.PROMPT_BUILDER_STARTED,
    severity: Severity.INFO,
    payload: {
      productKind: resolvedFacts.identity?.product_kind,
      materialPrimary: resolvedFacts.material_profile?.primary,
      model: PROMPT_BUILDER_MODEL,
    },
  });

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Get material-specific rules
  const materialPrimary = resolvedFacts.material_profile?.primary || "unknown";
  const materialRules = getMaterialRulesForPrompt(materialPrimary);

  // Get scale guardrails
  const scaleGuardrails = resolvedFacts.scale_guardrails || "Size appropriately for the product type.";

  // Get variant intents
  const variantIntentsJson = getVariantIntentsForPrompt();

  // Resolve prompt from DB
  const resolvedPrompt = await resolvePromptText(shopId, 'placement_set_generator', {
    resolvedFactsJson: JSON.stringify(resolvedFacts, null, 2),
    materialPrimary,
    materialRules,
    scaleGuardrails,
    variantIntentsJson,
  });

  // Build debug payload
  const debugPayload: DebugPayload = {
    promptText: resolvedPrompt.promptText,
    model: resolvedPrompt.model,
    params: {
      responseModalities: ['TEXT'],
      temperature: 0.2,
      ...resolvedPrompt.params,
    },
    images: [], // No images for placement set generation
    aspectRatioSource: 'UNKNOWN',
  };

  // Compute hash
  const callIdentityHash = computeCallIdentityHash({
    promptText: resolvedPrompt.promptText,
    model: resolvedPrompt.model,
    params: resolvedPrompt.params,
  });

  // Build call summary
  const callSummary: CallSummary = {
    promptName: 'placement_set_generator',
    model: resolvedPrompt.model,
    imageCount: 0,
    promptPreview: resolvedPrompt.promptText.slice(0, 200),
  };

  // Start LLM call tracking
  const callId = await startCall({
    shopId,
    ownerType: 'PRODUCT_ASSET',
    ownerId: productAssetId,
    promptName: 'placement_set_generator',
    promptVersionId: resolvedPrompt.versionId,
    callIdentityHash,
    callSummary,
    debugPayload,
  });

  const startTime = Date.now();

  try {
    const result = await client.models.generateContent({
      model: resolvedPrompt.model,
      contents: [
        {
          role: "user",
          parts: [{ text: resolvedPrompt.promptText }],
        },
      ],
      config: { responseMimeType: "application/json", temperature: 0.2 },
    });

    const text = (result as { text?: string })?.text || "{}";
    let placementSet: PlacementSet;

    try {
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      const parsed = JSON.parse(jsonStr);

      // Handle both old (product_context/variation) and new (productDescription/placementInstruction) formats
      if ('product_context' in parsed) {
        // Legacy format - transform to canonical
        placementSet = transformLegacyToCanonical(parsed as LegacyPromptPack);
      } else if ('productDescription' in parsed) {
        // New format - use directly
        placementSet = parsed as PlacementSet;
      } else {
        throw new Error("Missing productDescription or product_context in response");
      }
    } catch (parseErr) {
      logger.error(
        { ...logContext, stage: "parse" },
        `Failed to parse placement set: ${parseErr}`
      );
      throw new Error("Failed to parse placement set as JSON");
    }

    // Validate we have 8 variants
    if (!placementSet.variants || placementSet.variants.length !== 8) {
      logger.warn(
        { ...logContext, stage: "validate" },
        `Expected 8 variants, got ${placementSet.variants?.length || 0}`
      );
      // Attempt to continue if we have at least some variants
      if (!placementSet.variants || placementSet.variants.length === 0) {
        throw new Error("No variants in placement set");
      }
    }

    // Validate scale_guardrails is in productDescription
    if (!placementSet.productDescription.toLowerCase().includes("relative scale")) {
      logger.warn(
        { ...logContext, stage: "validate" },
        "productDescription missing 'Relative scale' line"
      );
      // Inject it
      placementSet.productDescription += `\n\nRelative scale: ${scaleGuardrails}`;
    }

    // Complete LLM call with success
    const latencyMs = Date.now() - startTime;
    const outputSummary: OutputSummary = {
      finishReason: 'STOP',
    };

    await completeCallSuccess({
      callId,
      tokensIn: 0, // TODO: Extract from response
      tokensOut: 0,
      costEstimate: 0,
      latencyMs,
      providerModel: resolvedPrompt.model,
      outputSummary,
    });

    logger.info(
      { ...logContext, stage: "complete" },
      `Placement set built: ${placementSet.variants.length} variants`
    );

    // Emit builder completed event
    emit({
      shopId,
      requestId: traceId,
      source: EventSource.PROMPT_BUILDER,
      type: EventType.PROMPT_BUILDER_COMPLETED,
      severity: Severity.INFO,
      payload: {
        variantCount: placementSet.variants.length,
        hasProductDescription: !!placementSet.productDescription,
      },
    });

    return placementSet;
  } catch (error) {
    // Complete LLM call with failure
    const latencyMs = Date.now() - startTime;
    await completeCallFailure({
      callId,
      latencyMs,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      status: 'FAILED',
    });

    logger.error(logContext, "Placement set builder failed", error);
    throw error;
  }
}

// =============================================================================
// Legacy Export for backward compatibility
// =============================================================================

/** @deprecated Use buildPlacementSet instead */
export async function buildPromptPack(
  resolvedFacts: ProductFacts,
  requestId: string,
  shopId?: string
): Promise<PlacementSet> {
  return buildPlacementSet({
    resolvedFacts,
    productAssetId: 'legacy-' + requestId,
    shopId: shopId || 'SYSTEM',
    traceId: requestId,
  });
}
