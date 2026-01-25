// =============================================================================
// CANONICAL: Composite Run Pipeline (LLM #3)
// Composites 8 variants using PlacementSet and resolved facts
// =============================================================================

import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import crypto from "crypto";
import { logger, createLogContext } from "~/utils/logger.server";
import { GEMINI_IMAGE_MODEL_FAST, GEMINI_IMAGE_MODEL_PRO } from "~/config/ai-models.config";
import { StorageService } from "~/services/storage.server";
import prisma from "~/db.server";
import { emit, EventSource, EventType, Severity } from "~/services/telemetry";
import { resolvePromptText, buildPipelineConfigSnapshot } from "../prompt-control/prompt-resolver.server";
import { startCall, completeCallSuccess, completeCallFailure } from "../prompt-control/llm-call-tracker.server";
import { computeCallIdentityHash, computeDedupeHash, computePipelineConfigHash, computeImageHash } from "./hashing.server";
import type {
  RenderInput,
  RenderRunResult,
  VariantRenderResult,
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

// Env-based toggle for model selection (allows forcing PRO for testing)
const BASE_RENDER_MODEL =
  process.env.SEE_IT_NOW_RENDER_MODEL === "PRO"
    ? GEMINI_IMAGE_MODEL_PRO
    : GEMINI_IMAGE_MODEL_FAST;

// Gemini-compatible aspect ratios (label values per Gemini docs)
const GEMINI_SUPPORTED_RATIOS: Array<{ label: string; value: number }> = [
  { label: "1:1", value: 1.0 },
  { label: "4:5", value: 0.8 },
  { label: "5:4", value: 1.25 },
  { label: "3:4", value: 0.75 },
  { label: "4:3", value: 4 / 3 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 1.5 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
];

function findClosestGeminiRatioLabel(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const inputRatio = width / height;
  let closest = GEMINI_SUPPORTED_RATIOS[0];
  let minDiff = Math.abs(inputRatio - closest.value);
  for (const r of GEMINI_SUPPORTED_RATIOS) {
    const diff = Math.abs(inputRatio - r.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = r;
    }
  }
  return closest.label;
}

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

export type RenderAllVariantsMode = "early_return" | "wait_all";

export type RenderAllVariantsCallbacks = {
  onRunStarted?: (info: { runId: string; totalVariants: number; model: string }) => void;
  onVariantCompleted?: (result: VariantRenderResult & { imageRef?: string }) => void;
  onEarlyReturn?: (info: {
    runId: string;
    successCount: number;
    completedCount: number;
    elapsedMs: number;
  }) => void;
};

// =============================================================================
// Internal Types
// =============================================================================

interface VariantRenderContext {
  runId: string;
  shopId: string;
  variant: PlacementVariant;
  productDescription: string;
  productImage: RenderInput['productImage'];
  roomImage: RenderInput['roomImage'];
  pipelineConfigSnapshot: PipelineConfigSnapshot;
  logContext: ReturnType<typeof createLogContext>;
}

// =============================================================================
// Render Single Variant
// =============================================================================

async function renderSingleVariant(
  ctx: VariantRenderContext
): Promise<VariantRenderResult> {
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

  // Build DebugPayload
  const debugPayload: DebugPayload = {
    promptText: finalPrompt,
    model: resolvedPrompt.model,
    params: {
      responseModalities: ['TEXT', 'IMAGE'],
      aspectRatio: aspectRatio ?? undefined,
    },
    images: preparedImages,
    aspectRatioSource: aspectRatio ? 'ROOM_IMAGE_LAST' : 'UNKNOWN',
  };

  // Compute hashes
  const callIdentityHash = computeCallIdentityHash({
    promptText: finalPrompt,
    model: resolvedPrompt.model,
    params: resolvedPrompt.params,
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

    const config: any = { responseModalities: ["TEXT", "IMAGE"] as any };
    if (aspectRatio) {
      config.imageConfig = { aspectRatio };
    }

    const result = await Promise.race([
      client.models.generateContent({
        model: resolvedPrompt.model,
        contents: [{ role: "user", parts }],
        config,
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

    // Extract usage metadata
    const usageMetadata = (result as any)?.usageMetadata;
    const tokensIn = usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = usageMetadata?.candidatesTokenCount ?? 0;

    // Estimate cost (rough estimate based on Gemini pricing)
    const inCost = (tokensIn / 1_000_000) * 0.10;
    const outCost = (tokensOut / 1_000_000) * 0.40;
    const costEstimate = inCost + outCost;

    const latencyMs = Date.now() - startTime;
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const imageHash = computeImageHash(imageBuffer);

    // Complete LLM call with success
    const outputSummary: OutputSummary = {
      finishReason: String(finishReason ?? 'STOP'),
      safetyRatings: safetyRatings ? safetyRatings.map((r: any) => ({
        category: r.category,
        probability: r.probability,
      })) : undefined,
    };

    await completeCallSuccess({
      callId,
      tokensIn,
      tokensOut,
      costEstimate,
      latencyMs,
      providerModel: resolvedPrompt.model,
      outputSummary,
    });

    logger.info(
      { ...variantLogContext, stage: "complete" },
      `Variant ${variant.id} rendered in ${latencyMs}ms`
    );

    return {
      variantId: variant.id,
      status: 'SUCCESS',
      latencyMs,
      imageHash,
      // Carry the base64 for upload (not stored in result, just for internal use)
      _imageBase64: imageBase64,
    } as VariantRenderResult & { _imageBase64?: string };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = error.message === "Timeout";
    const isBlocked = error instanceof VariantBlockedError;

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
  input: RenderInput,
  options?: {
    mode?: RenderAllVariantsMode;
  } & RenderAllVariantsCallbacks
): Promise<RenderRunResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const mode: RenderAllVariantsMode = options?.mode ?? "early_return";

  const logContext = createLogContext("render", input.traceId, "start", {
    runId,
    productAssetId: input.productAssetId,
    roomSessionId: input.roomSessionId,
  });

  logger.info(
    logContext,
    `Starting render run with ${input.placementSet.variants.length} variants (baseModel=${BASE_RENDER_MODEL})`
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
      model: BASE_RENDER_MODEL,
    },
  });

  // ==========================================================================
  // Build Pipeline Config Snapshot
  // ==========================================================================
  const pipelineConfigSnapshot = await buildPipelineConfigSnapshot(input.shopId);
  const pipelineConfigHash = computePipelineConfigHash(pipelineConfigSnapshot);

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

  // Inform caller that run exists
  if (options?.onRunStarted) {
    try {
      options.onRunStarted({
        runId,
        totalVariants: input.placementSet.variants.length,
        model: BASE_RENDER_MODEL,
      });
    } catch (e) {
      logger.warn(
        { ...logContext, stage: "callback-error" },
        `onRunStarted callback failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Track results
  const results: VariantRenderResult[] = [];
  let successCount = 0;
  let completedCount = 0;
  const totalVariants = input.placementSet.variants.length;

  // Create resolvers for early return and all done
  let resolveEarly: (value: void | PromiseLike<void>) => void;
  const earlyReturnPromise = new Promise<void>((resolve) => {
    resolveEarly = resolve;
  });

  let resolveAllDone: (value: void | PromiseLike<void>) => void;
  const allDonePromise = new Promise<void>((resolve) => {
    resolveAllDone = resolve;
  });

  let earlyReturnFired = false;

  // Fire all variants in parallel
  for (const variant of input.placementSet.variants) {
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

    renderSingleVariant(ctx).then(async (result) => {
      let imageRef: string | undefined;
      let imageHash: string | undefined = result.imageHash;

      // Upload if successful
      if (result.status === 'SUCCESS' && (result as any)._imageBase64) {
        try {
          const uploaded = await uploadVariantImage(runId, result.variantId, (result as any)._imageBase64);
          imageRef = uploaded.key;
          imageHash = uploaded.hash;
        } catch (err) {
          logger.error(
            { ...logContext, variantId: result.variantId },
            `Failed to upload variant image: ${err}`
          );
        }
      }

      // Write CompositeVariant record
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
      }).catch((e: unknown) => {
        logger.error(
          { ...logContext, variantId: result.variantId },
          `Failed to write variant result: ${e instanceof Error ? e.message : String(e)}`
        );
      });

      // Update result with imageRef
      const finalResult: VariantRenderResult = {
        ...result,
        imageRef,
        imageHash,
      };
      results.push(finalResult);

      completedCount++;
      if (result.status === 'SUCCESS') {
        successCount++;
      }

      const elapsed = Date.now() - startTime;

      // Check for completion
      if (completedCount === totalVariants) {
        resolveEarly();
        resolveAllDone();
      } else if (successCount >= 4 && elapsed > 10000) {
        resolveEarly();
        if (!earlyReturnFired) {
          earlyReturnFired = true;
          if (options?.onEarlyReturn) {
            try {
              options.onEarlyReturn({
                runId,
                successCount,
                completedCount,
                elapsedMs: elapsed,
              });
            } catch (e) {
              logger.warn(
                { ...logContext, stage: "callback-error" },
                `onEarlyReturn callback failed: ${e instanceof Error ? e.message : String(e)}`
              );
            }
          }
        }
      }

      // Notify caller
      if (options?.onVariantCompleted) {
        try {
          options.onVariantCompleted(finalResult);
        } catch (e) {
          logger.warn(
            { ...logContext, stage: "callback-error", variantId: result.variantId },
            `onVariantCompleted callback failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    });
  }

  // Wait for early return or all complete
  const safetyTimeout = new Promise<void>(r => setTimeout(r, 60000));

  await Promise.race([
    mode === "wait_all" ? allDonePromise : earlyReturnPromise,
    safetyTimeout,
  ]);

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
      failCount: results.filter(r => r.status === 'FAILED').length,
      timeoutCount: results.filter(r => r.status === 'TIMEOUT').length,
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
      failCount: results.filter(r => r.status === 'FAILED').length,
      timeoutCount: results.filter(r => r.status === 'TIMEOUT').length,
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

// =============================================================================
// Legacy Export for backward compatibility
// =============================================================================

/** @deprecated Use PlacementSet type instead of PromptPack */
export interface LegacyPromptPack {
  product_context: string;
  variants: Array<{ id: string; variation: string }>;
}

/** @deprecated Use RenderInput instead */
export interface LegacyRenderInput {
  shopId: string;
  productAssetId: string;
  roomSessionId: string;
  requestId: string;
  productImage: {
    buffer: Buffer;
    hash: string;
    meta: ImageMeta;
    geminiUri?: string;
  };
  roomImage: {
    buffer: Buffer;
    hash: string;
    meta: ImageMeta;
    geminiUri?: string;
  };
  resolvedFacts: ProductFacts;
  promptPack: LegacyPromptPack;
  promptPackVersion?: string;
}

/** @deprecated Use renderAllVariants with RenderInput instead */
export async function renderAllVariantsLegacy(
  input: LegacyRenderInput,
  options?: {
    mode?: RenderAllVariantsMode;
  } & RenderAllVariantsCallbacks
): Promise<RenderRunResult> {
  // Transform legacy input to canonical
  const canonicalInput: RenderInput = {
    shopId: input.shopId,
    productAssetId: input.productAssetId,
    roomSessionId: input.roomSessionId,
    traceId: input.requestId,
    productImage: {
      buffer: input.productImage.buffer,
      hash: input.productImage.hash,
      meta: input.productImage.meta,
      ref: input.productImage.geminiUri || `inline:${input.productImage.hash}`,
    },
    roomImage: {
      buffer: input.roomImage.buffer,
      hash: input.roomImage.hash,
      meta: input.roomImage.meta,
      ref: input.roomImage.geminiUri || `inline:${input.roomImage.hash}`,
    },
    resolvedFacts: input.resolvedFacts,
    placementSet: {
      productDescription: input.promptPack.product_context,
      variants: input.promptPack.variants.map(v => ({
        id: v.id,
        placementInstruction: v.variation,
      })),
    },
  };

  return renderAllVariants(canonicalInput, options);
}

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
