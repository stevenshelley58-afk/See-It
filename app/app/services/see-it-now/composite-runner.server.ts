// =============================================================================
// CANONICAL: Composite Run Pipeline (LLM #3)
// Composites 8 variants using PlacementSet and resolved facts
// =============================================================================

import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import crypto from "crypto";
import { logger, createLogContext } from "~/utils/logger.server";
import { StorageService } from "~/services/storage.server";
import prisma from "~/db.server";
import { emit, EventSource, EventType, Severity } from "~/services/telemetry";
import { findClosestGeminiRatioLabel } from "~/services/gemini-aspect-ratio.server";
import { resolvePromptText, buildPipelineConfigSnapshot } from "../prompt-control/prompt-resolver.server";
import { startCall, completeCallSuccess, completeCallFailure } from "../prompt-control/llm-call-tracker.server";
import { computeCallIdentityHash, computeDedupeHash, computePipelineConfigHash, computeImageHash } from "./hashing.server";
import type {
  CompositeInput,
  CompositeRunResult,
  CompositeVariantResult,
  PlacementSet,
  PlacementVariant,
  ProductFacts,
  DebugPayload,
  CallSummary,
  OutputSummary,
  PreparedImage,
  WaterfallMs,
  RunTotals,
  PipelineConfigSnapshot,
  ImageMeta,
  RunStatus,
  VariantStatus,
} from "./types";

const VARIANT_TIMEOUT_MS = 45000; // 45 seconds per variant

class VariantBlockedError extends Error {
  public readonly code: "SAFETY_BLOCK" | "PROMPT_BLOCK";
  public readonly finishReason?: string | null;
  public readonly blockReason?: string | null;
  public readonly safetyRatings?: unknown;
  public readonly causeId: string;

  constructor(args: {
    code: "SAFETY_BLOCK" | "PROMPT_BLOCK";
    message: string;
    finishReason?: string | null;
    blockReason?: string | null;
    safetyRatings?: unknown;
    causeId: string;
  }) {
    super(args.message);
    this.name = "VariantBlockedError";
    this.code = args.code;
    this.finishReason = args.finishReason;
    this.blockReason = args.blockReason;
    this.safetyRatings = args.safetyRatings;
    this.causeId = args.causeId;
  }
}

class InfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfrastructureError";
  }
}

export type RenderAllVariantsMode = "wait_all";

export type RenderAllVariantsCallbacks = {
  onRunStarted?: (info: { runId: string; totalVariants: number; model: string }) => void;
  onVariantCompleted?: (result: CompositeVariantResult & { imageRef?: string }) => void;
};

// =============================================================================
// Internal Types
// =============================================================================

interface VariantRenderContext {
  runId: string;
  shopId: string;
  variant: PlacementVariant;
  productDescription: string;
  productImage: CompositeInput['productImage'];
  roomImage: CompositeInput['roomImage'];
  pipelineConfigSnapshot: PipelineConfigSnapshot;
  logContext: ReturnType<typeof createLogContext>;
}

// =============================================================================
// Render Single Variant
// =============================================================================

async function renderSingleVariant(
  ctx: VariantRenderContext
): Promise<CompositeVariantResult> {
  const startTime = Date.now();
  const { runId, shopId, variant, productDescription, productImage, roomImage, pipelineConfigSnapshot, logContext } = ctx;
  const variantLogContext = { ...logContext, variantId: variant.id };

  logger.info(variantLogContext, `Rendering variant ${variant.id}`);

  const roomWidth = roomImage.meta?.width;
  const roomHeight = roomImage.meta?.height;
  const aspectRatio = findClosestGeminiRatioLabel(roomWidth, roomHeight);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Resolve composite_instruction prompt from DB
  const resolvedPrompt = await resolvePromptText(shopId, 'composite_instruction', {
    productDescription: productDescription,
    placementInstruction: variant.placementInstruction,
  });

  const finalPrompt = resolvedPrompt.promptText;

  // Build content parts
  // Order: [prepared_product_image, customer_room_image, prompt]
  // customer_room_image MUST be last image for aspect ratio adoption
  const parts: any[] = [];

  const productMime = `image/${productImage.meta.format === "jpeg" ? "jpeg" : productImage.meta.format}`;
  const roomMime = `image/${roomImage.meta.format === "jpeg" ? "jpeg" : roomImage.meta.format}`;

  // Determine input method for product image
  const productInputMethod = productImage.ref.startsWith('https://generativelanguage.googleapis.com/') ? 'FILES_API' : 'INLINE';
  const roomInputMethod = roomImage.ref.startsWith('https://generativelanguage.googleapis.com/') ? 'FILES_API' : 'INLINE';

  // 1. Product image
  if (productInputMethod === 'FILES_API') {
    parts.push({
      fileData: {
        mimeType: productMime,
        fileUri: productImage.ref,
      },
    });
  } else {
    parts.push({
      inlineData: {
        mimeType: productMime,
        data: productImage.buffer.toString("base64"),
      },
    });
  }

  // 2. Room image (MUST be last for aspect ratio)
  if (roomInputMethod === 'FILES_API') {
    parts.push({
      fileData: {
        mimeType: roomMime,
        fileUri: roomImage.ref,
      },
    });
  } else {
    parts.push({
      inlineData: {
        mimeType: roomMime,
        data: roomImage.buffer.toString("base64"),
      },
    });
  }

  // 3. Prompt (last)
  parts.push({ text: finalPrompt });

  // Build PreparedImages for debug payload
  const preparedImages: PreparedImage[] = [
    {
      role: 'prepared_product_image',
      ref: productImage.ref,
      hash: productImage.hash,
      mimeType: productMime,
      inputMethod: productInputMethod,
      orderIndex: 0,
    },
    {
      role: 'customer_room_image',
      ref: roomImage.ref,
      hash: roomImage.hash,
      mimeType: roomMime,
      inputMethod: roomInputMethod,
      orderIndex: 1,
    },
  ];

  // Build final merged provider config (what actually gets sent)
  const finalConfig: any = {
    responseModalities: ["TEXT", "IMAGE"] as any,
    ...(resolvedPrompt.params ?? {}),
  };
  if (aspectRatio) {
    const existing =
      finalConfig.imageConfig && typeof finalConfig.imageConfig === "object"
        ? finalConfig.imageConfig
        : {};
    finalConfig.imageConfig = { ...existing, aspectRatio };
  }

  // Build DebugPayload (must match final config)
  const debugPayload: DebugPayload = {
    promptText: finalPrompt,
    model: resolvedPrompt.model,
    params: finalConfig,
    images: preparedImages,
    aspectRatioSource: aspectRatio ? 'ROOM_IMAGE_LAST' : 'UNKNOWN',
  };

  // Compute hashes from final merged config (what actually gets sent)
  const callIdentityHash = computeCallIdentityHash({
    promptText: finalPrompt,
    model: resolvedPrompt.model,
    params: finalConfig,
  });
  const dedupeHash = computeDedupeHash({
    callIdentityHash,
    images: preparedImages,
  });

  // Build CallSummary
  const callSummary: CallSummary = {
    promptName: 'composite_instruction',
    model: resolvedPrompt.model,
    imageCount: 2,
    promptPreview: finalPrompt.slice(0, 200),
  };

  // Start LLM call tracking
  const callId = await startCall({
    shopId,
    ownerType: 'COMPOSITE_RUN',
    ownerId: runId,
    variantId: variant.id,
    promptName: 'composite_instruction',
    promptVersionId: resolvedPrompt.versionId,
    callIdentityHash,
    dedupeHash,
    callSummary,
    debugPayload,
  });

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Timeout")), VARIANT_TIMEOUT_MS);
  });

  try {
    logger.info(
      { ...variantLogContext, stage: "aspect-ratio", roomWidth, roomHeight, aspectRatio },
      `Variant ${variant.id} aspect ratio resolved: ${aspectRatio ?? "none"}`
    );

    const result = await Promise.race([
      client.models.generateContent({
        model: resolvedPrompt.model,
        contents: [{ role: "user", parts }],
        config: finalConfig,
      }),
      timeoutPromise,
    ]);

    const candidates = (result as any)?.candidates;
    const finishReason = candidates?.[0]?.finishReason ?? null;
    const safetyRatings = candidates?.[0]?.safetyRatings ?? (result as any)?.promptFeedback?.safetyRatings ?? undefined;
    const promptBlockReason = (result as any)?.promptFeedback?.blockReason ?? null;

    if (promptBlockReason) {
      const upper = String(promptBlockReason).toUpperCase();
      const code = upper.includes("SAFETY") ? "SAFETY_BLOCK" : "PROMPT_BLOCK";
      throw new VariantBlockedError({
        code,
        message: `Blocked by safety filters (code=${code}, finishReason=${String(finishReason ?? "")}, blockReason=${String(promptBlockReason)})`,
        finishReason,
        blockReason: promptBlockReason,
        safetyRatings,
        causeId: crypto.randomUUID().slice(0, 8),
      });
    }

    // Extract image from response
    let imageBase64: string | undefined;
    if (candidates?.[0]?.content?.parts) {
      for (const part of candidates[0].content.parts) {
        if ((part as any)?.inlineData?.data) {
          imageBase64 = (part as any).inlineData.data;
          break;
        }
      }
    }

    if (!imageBase64) {
      const frUpper = String(finishReason ?? "").toUpperCase();
      if (frUpper.includes("SAFETY") || frUpper.includes("BLOCK")) {
        throw new VariantBlockedError({
          code: "SAFETY_BLOCK",
          message: `Blocked by safety filters (code=SAFETY_BLOCK, finishReason=${String(finishReason ?? "")})`,
          finishReason,
          blockReason: null,
          safetyRatings,
          causeId: crypto.randomUUID().slice(0, 8),
        });
      }
      const reasonSuffix = finishReason ? ` (finishReason=${String(finishReason)})` : "";
      throw new Error(`No image in response${reasonSuffix}`);
    }

    const providerRequestId =
      (result as any)?.response?.requestId ??
      (result as any)?.requestId ??
      (result as any)?.responseId ??
      (result as any)?.response?.id ??
      (result as any)?.id ??
      undefined;

    // Extract usage metadata
    const usageMetadata = (result as any)?.usageMetadata;
    const tokensIn = usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = usageMetadata?.candidatesTokenCount ?? 0;

    // Estimate cost (rough estimate based on Gemini pricing)
    const inCost = (tokensIn / 1_000_000) * 0.10;
    const outCost = (tokensOut / 1_000_000) * 0.40;
    const costEstimate = inCost + outCost;

    const latencyMs = Date.now() - startTime;

    // Upload variant image (fail-hard: upload must succeed)
    let uploaded: { key: string; hash: string };
    try {
      uploaded = await uploadVariantImage(runId, variant.id, imageBase64);
    } catch (e) {
      throw new InfrastructureError(
        `Failed to upload variant image (variantId=${variant.id}): ${e instanceof Error ? e.message : String(e)}`
      );
    }

    const outputSummary: OutputSummary = {
      finishReason: String(finishReason ?? "STOP"),
      safetyRatings: safetyRatings
        ? safetyRatings.map((r: any) => ({
            category: r.category,
            probability: r.probability,
          }))
        : undefined,
      imageRef: uploaded.key,
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
      { ...variantLogContext, stage: "complete" },
      `Variant ${variant.id} rendered in ${latencyMs}ms`
    );

    return {
      variantId: variant.id,
      status: "SUCCESS",
      latencyMs,
      imageRef: uploaded.key,
      imageHash: uploaded.hash,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = error.message === "Timeout";
    const isBlocked = error instanceof VariantBlockedError;
    const isInfrastructure = error instanceof InfrastructureError;

    // Complete LLM call with failure
    await completeCallFailure({
      callId,
      latencyMs,
      errorType: error.name ?? 'UnknownError',
      errorMessage: error.message ?? String(error),
      status: isTimeout ? 'TIMEOUT' : 'FAILED',
    });

    logger.error(
      {
        ...variantLogContext,
        stage: "error",
        errorCode: isTimeout ? "TIMEOUT" : isBlocked ? error.code : "PROVIDER_ERROR",
      },
      `Variant ${variant.id} failed: ${error.message}`
    );

    if (isInfrastructure) {
      throw error;
    }

    return {
      variantId: variant.id,
      status: isTimeout ? 'TIMEOUT' : 'FAILED',
      latencyMs,
      errorCode: isTimeout ? "TIMEOUT" : isBlocked ? error.code : "PROVIDER_ERROR",
      errorMessage: isBlocked
        ? "Your request was blocked by safety filters. Please try a different prompt."
        : isTimeout
          ? "The render timed out. Please try again."
          : "The render failed. Please try again.",
    };
  }
}

// =============================================================================
// Upload Variant Image
// =============================================================================

async function uploadVariantImage(
  runId: string,
  variantId: string,
  imageBase64: string
): Promise<{ key: string; hash: string }> {
  const buffer = Buffer.from(imageBase64, "base64");

  // Convert to JPEG for storage
  const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();

  const key = `see-it-now/${runId}/${variantId}.jpg`;
  await StorageService.uploadBuffer(jpegBuffer, key, "image/jpeg");

  return { key, hash: computeImageHash(jpegBuffer) };
}

// =============================================================================
// Main Entry Point: Render All Variants
// =============================================================================

export async function renderAllVariants(
  input: CompositeInput,
  options?: {
    mode?: RenderAllVariantsMode;
  } & RenderAllVariantsCallbacks
): Promise<CompositeRunResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const mode: RenderAllVariantsMode = options?.mode ?? "wait_all";
  if (mode !== "wait_all") {
    throw new Error(`Unsupported render mode (fail-hard): ${mode}`);
  }

  const logContext = createLogContext("render", input.traceId, "start", {
    runId,
    productAssetId: input.productAssetId,
    roomSessionId: input.roomSessionId,
  });

  // ==========================================================================
  // Build Pipeline Config Snapshot
  // ==========================================================================
  const PIPELINE_PROMPT_KEYS = [
    "product_fact_extractor",
    "placement_set_generator",
    "composite_instruction",
  ];
  const pipelineConfigSnapshot = await buildPipelineConfigSnapshot(
    input.shopId,
    PIPELINE_PROMPT_KEYS
  );
  const pipelineConfigHash = computePipelineConfigHash(pipelineConfigSnapshot);

  const compositeModel = pipelineConfigSnapshot.prompts["composite_instruction"]?.model;
  if (!compositeModel) {
    throw new Error("Missing composite_instruction model in pipeline config snapshot");
  }

  logger.info(
    logContext,
    `Starting render run with ${input.placementSet.variants.length} variants (model=${compositeModel})`
  );

  // Emit composite started event
  emit({
    shopId: input.shopId,
    requestId: input.traceId,
    source: EventSource.COMPOSITE_RUNNER,
    type: EventType.COMPOSITE_RUN_CREATED,
    severity: Severity.INFO,
    payload: {
      runId,
      variantCount: input.placementSet.variants.length,
      model: compositeModel,
    },
  });

  // ==========================================================================
  // Create CompositeRun record
  // ==========================================================================
  await prisma.compositeRun.create({
    data: {
      id: runId,
      shopId: input.shopId,
      productAssetId: input.productAssetId,
      roomSessionId: input.roomSessionId,
      traceId: input.traceId,
      preparedProductImageRef: input.productImage.ref,
      preparedProductImageHash: input.productImage.hash,
      roomImageRef: input.roomImage.ref,
      roomImageHash: input.roomImage.hash,
      resolvedFactsSnapshot: input.resolvedFacts as any,
      placementSetSnapshot: input.placementSet as any,
      pipelineConfigSnapshot: pipelineConfigSnapshot as any,
      pipelineConfigHash,
      status: 'RUNNING',
    },
  });

  const totalVariants = input.placementSet.variants.length;

  // Inform caller that run exists (fail-hard: callback errors abort run)
  if (options?.onRunStarted) {
    options.onRunStarted({
      runId,
      totalVariants,
      model: compositeModel,
    });
  }

  // Fire all variants in parallel and wait for all to complete (no early return).
  const totalTimeoutMs =
    pipelineConfigSnapshot.runtimeConfig?.timeouts?.totalMs ?? 60000;

  const variantTasks = input.placementSet.variants.map(async (variant) => {
    const ctx: VariantRenderContext = {
      runId,
      shopId: input.shopId,
      variant,
      productDescription: input.placementSet.productDescription,
      productImage: input.productImage,
      roomImage: input.roomImage,
      pipelineConfigSnapshot,
      logContext,
    };

    const result = await renderSingleVariant(ctx);

    const imageRef = result.imageRef;
    const imageHash = result.imageHash;

    if (result.status === "SUCCESS" && !imageRef) {
      throw new InfrastructureError(`Missing imageRef for successful variant ${result.variantId}`);
    }

    // Write CompositeVariant record (fail-hard: DB write must succeed)
    await prisma.compositeVariant.create({
      data: {
        runId,
        variantId: result.variantId,
        status: result.status,
        imageRef,
        imageHash,
        latencyMs: result.latencyMs,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      },
    });

    const finalResult: CompositeVariantResult = {
      ...result,
      imageRef,
      imageHash,
    };

    // Notify caller (fail-hard: callback errors abort run)
    if (options?.onVariantCompleted) {
      await options.onVariantCompleted(finalResult);
    }

    return finalResult;
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Composite run timed out after ${totalTimeoutMs}ms`));
    }, totalTimeoutMs);
  });

  let results: CompositeVariantResult[];
  try {
    results = await Promise.race([Promise.all(variantTasks), timeoutPromise]);
  } catch (error) {
    const totalDurationMs = Date.now() - startTime;
    await prisma.compositeRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        totalDurationMs,
      },
    });
    emit({
      shopId: input.shopId,
      requestId: input.traceId,
      source: EventSource.COMPOSITE_RUNNER,
      type: EventType.COMPOSITE_RUN_COMPLETED,
      severity: Severity.INFO,
      payload: {
        runId,
        status: "FAILED",
        successCount: 0,
        failCount: 0,
        timeoutCount: 0,
        totalDurationMs,
      },
    });
    throw error;
  }

  const successCount = results.filter(r => r.status === "SUCCESS").length;
  const failCount = results.filter(r => r.status === "FAILED").length;
  const timeoutCount = results.filter(r => r.status === "TIMEOUT").length;

  const totalDurationMs = Date.now() - startTime;

  // Determine final status
  let status: RunStatus;
  if (successCount === totalVariants) {
    status = 'COMPLETE';
  } else if (successCount > 0) {
    status = 'PARTIAL';
  } else {
    status = 'FAILED';
  }

  // Calculate run totals
  const llmCalls = await prisma.lLMCall.findMany({
    where: {
      ownerType: 'COMPOSITE_RUN',
      ownerId: runId,
    },
    select: {
      status: true,
      tokensIn: true,
      tokensOut: true,
      costEstimate: true,
      latencyMs: true,
    },
  });

  let tokensIn = 0;
  let tokensOut = 0;
  let costEstimate = 0;
  let callsFailed = 0;
  const latencies: number[] = [];

  for (const call of llmCalls) {
    if (call.tokensIn) tokensIn += call.tokensIn;
    if (call.tokensOut) tokensOut += call.tokensOut;
    if (call.costEstimate) costEstimate += Number(call.costEstimate);
    if (call.latencyMs) latencies.push(call.latencyMs);
    if (call.status === 'FAILED' || call.status === 'TIMEOUT') {
      callsFailed++;
    }
  }

  const runTotals: RunTotals = {
    tokensIn,
    tokensOut,
    costEstimate,
    callsTotal: llmCalls.length,
    callsFailed,
  };

  // Calculate waterfall timing
  const sortedLatencies = latencies.sort((a, b) => a - b);
  const inferenceMs = sortedLatencies.reduce((a, b) => a + b, 0);

  const waterfallMs: WaterfallMs = {
    prep: 0, // Would need to track separately
    render: inferenceMs,
    upload: 0, // Would need to track separately
    total: totalDurationMs,
  };

  // Update CompositeRun with final status
  await prisma.compositeRun.update({
    where: { id: runId },
    data: {
      status,
      completedAt: new Date(),
      totalDurationMs,
      successCount,
      failCount,
      timeoutCount,
      waterfallMs: waterfallMs as any,
      runTotals: runTotals as any,
    },
  });

  // Emit composite completed event
  emit({
    shopId: input.shopId,
    requestId: input.traceId,
    source: EventSource.COMPOSITE_RUNNER,
    type: EventType.COMPOSITE_RUN_COMPLETED,
    severity: Severity.INFO,
    payload: {
      runId,
      status,
      successCount,
      failCount,
      timeoutCount,
      totalDurationMs,
    },
  });

  logger.info(
    { ...logContext, stage: "complete" },
    `Render run complete: ${successCount}/${totalVariants} successes, ${totalDurationMs}ms, status=${status}`
  );

  return {
    runId,
    status,
    totalDurationMs,
    variants: results,
    waterfallMs,
    runTotals,
  };
}

// Fail-hard: no legacy exports/backward-compat adapters.

// =============================================================================
// New Canonical Export Names
// =============================================================================

export type RunCompositeMode = RenderAllVariantsMode;
export type RunCompositeCallbacks = RenderAllVariantsCallbacks;

/**
 * Run composite pipeline for all variants.
 * This is the canonical entry point (renamed from renderAllVariants).
 */
export const runComposite = renderAllVariants;
