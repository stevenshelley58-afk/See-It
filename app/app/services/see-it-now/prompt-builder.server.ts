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

// Model selection comes from Prompt Control Plane (resolvedPrompt.model).

// Fail-hard: no legacy prompt pack support.

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

  // Emit builder started event (fail-hard: report the actual resolved model)
  emit({
    shopId,
    requestId: traceId,
    source: EventSource.PROMPT_BUILDER,
    type: EventType.PROMPT_BUILDER_STARTED,
    severity: Severity.INFO,
    payload: {
      productKind: resolvedFacts.identity?.product_kind,
      materialPrimary: resolvedFacts.material_profile?.primary,
      model: resolvedPrompt.model,
    },
  });

  // Build final merged provider config (what actually gets sent)
  const finalConfig = {
    responseMimeType: "application/json",
    ...resolvedPrompt.params,
  };

  // Build debug payload (must match final config)
  const debugPayload: DebugPayload = {
    promptText: resolvedPrompt.promptText,
    model: resolvedPrompt.model,
    params: {
      responseModalities: ['TEXT'],
      ...finalConfig,
    },
    images: [], // No images for placement set generation
    aspectRatioSource: 'UNKNOWN',
  };

  // Compute hash from final merged config (what actually gets sent)
  const callIdentityHash = computeCallIdentityHash({
    promptText: resolvedPrompt.promptText,
    model: resolvedPrompt.model,
    params: finalConfig,
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
      config: finalConfig,
    });

    const candidates = (result as any)?.candidates;
    const finishReason = candidates?.[0]?.finishReason ?? null;

    const providerRequestId =
      (result as any)?.response?.requestId ??
      (result as any)?.requestId ??
      (result as any)?.responseId ??
      (result as any)?.response?.id ??
      (result as any)?.id ??
      undefined;

    const usageMetadata = (result as any)?.usageMetadata;
    const tokensIn = usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = usageMetadata?.candidatesTokenCount ?? 0;
    const inCost = (tokensIn / 1_000_000) * 0.10;
    const outCost = (tokensOut / 1_000_000) * 0.40;
    const costEstimate = inCost + outCost;

    const text = (result as { text?: string })?.text || "{}";
    let placementSet: PlacementSet;

    try {
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      const parsed = JSON.parse(jsonStr);

      // Fail-hard: only canonical format is accepted
      if (!('productDescription' in parsed)) {
        throw new Error("Missing productDescription in response");
      }
      placementSet = parsed as PlacementSet;
    } catch (parseErr) {
      logger.error(
        { ...logContext, stage: "parse" },
        `Failed to parse placement set: ${parseErr}`
      );
      throw new Error("Failed to parse placement set as JSON");
    }

    // Validate we have 8 variants (fail-hard)
    if (!placementSet.variants || placementSet.variants.length !== 8) {
      throw new Error(
        `Invalid placement set: expected 8 variants, got ${placementSet.variants?.length || 0}`
      );
    }

    // Validate scale guardrails line exists (fail-hard)
    if (!placementSet.productDescription.toLowerCase().includes("relative scale")) {
      throw new Error("productDescription missing required 'Relative scale' line");
    }

    // Complete LLM call with success
    const latencyMs = Date.now() - startTime;
    const outputSummary: OutputSummary = {
      finishReason: String(finishReason ?? "STOP"),
      providerRequestId,
    };

    await completeCallSuccess({
      callId,
      tokensIn,
      tokensOut,
      costEstimate,
      latencyMs,
      providerModel: resolvedPrompt.model,
      providerRequestId,
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

// Fail-hard: no legacy exports.
