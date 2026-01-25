import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import crypto from "crypto";
import { logger, createLogContext } from "~/utils/logger.server";
import { GEMINI_IMAGE_MODEL_FAST, GEMINI_IMAGE_MODEL_PRO } from "~/config/ai-models.config";
import { StorageService } from "~/services/storage.server";
import prisma from "~/db.server";
import { assembleFinalPrompt, hashPrompt } from "./prompt-assembler.server";
import {
  startRun,
  recordVariantStart,
  recordVariantResult,
  completeRun,
} from "~/services/telemetry";
import {
  buildResolvedConfigSnapshot,
  trackedLLMCall,
  getRequestHash,
  findCachedRender,
  recordCacheHit,
  updateLLMCallWithOutput,
  findRecentCallForRun,
  type ResolvedConfigSnapshot,
  type CachedRenderResult,
} from "~/services/prompt-control";
import type {
  ImageMeta,
  RenderInput,
  RenderRunResult,
  VariantRenderResult,
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

function extractFinishReasonFromMessage(message: string | undefined): string | null {
  if (!message) return null;
  const m = message.match(/finishReason=([^)]+)\)/i);
  return m?.[1]?.trim() ?? null;
}

export type RenderAllVariantsMode = "early_return" | "wait_all";

export type RenderAllVariantsCallbacks = {
  /**
   * Fires after the RenderRun row is written.
   * Must never throw.
   */
  onRunStarted?: (info: { runId: string; totalVariants: number; model: string }) => void;
  /**
   * Fires after a variant has finished and (if successful) has been uploaded to GCS.
   * Must never throw.
   */
  onVariantCompleted?: (result: VariantRenderResult & { imageKey?: string }) => void;
  /**
   * Fires the first time the "early return" threshold is reached.
   * Must never throw.
   */
  onEarlyReturn?: (info: {
    runId: string;
    successCount: number;
    completedCount: number;
    elapsedMs: number;
  }) => void;
};

/**
 * Hash a buffer using SHA256 (first 16 chars)
 */
function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function stableJsonSha256_16(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/**
 * Tracking context for prompt control integration
 */
interface RenderTrackingContext {
  shopId: string;
  renderRunId: string;
  promptVersionId: string | null;
  resolutionHash: string;
  productImageUrl?: string;
  roomImageUrl?: string;
}

/**
 * Render a single variant with timeout and LLM call tracking
 */
async function renderSingleVariant(
  variantId: string,
  finalPrompt: string,
  productImage: { buffer: Buffer; meta: ImageMeta; geminiUri?: string },
  roomImage: { buffer: Buffer; meta: ImageMeta; geminiUri?: string },
  logContext: ReturnType<typeof createLogContext>,
  trackingContext?: RenderTrackingContext
): Promise<VariantRenderResult> {
  const startTime = Date.now();
  const variantLogContext = { ...logContext, variantId };

  logger.info(variantLogContext, `Rendering variant ${variantId}`);

  const roomWidth = roomImage.meta?.width;
  const roomHeight = roomImage.meta?.height;
  const aspectRatio = findClosestGeminiRatioLabel(roomWidth, roomHeight);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Build contents array
  // Order: [prepared_product_image, customer_room_image, final_prompt]
  // customer_room_image MUST be last image for aspect ratio adoption
  const parts: any[] = [];

  const productMime = `image/${productImage.meta.format === "jpeg" ? "jpeg" : productImage.meta.format}`;
  const roomMime = `image/${roomImage.meta.format === "jpeg" ? "jpeg" : roomImage.meta.format}`;

  // 1. Product image
  if (productImage.geminiUri) {
    parts.push({
      fileData: {
        mimeType: productMime,
        fileUri: productImage.geminiUri,
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

  // 2. Room image
  if (roomImage.geminiUri) {
    parts.push({
      fileData: {
        mimeType: roomMime,
        fileUri: roomImage.geminiUri,
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

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Timeout")), VARIANT_TIMEOUT_MS);
  });

  // Build image refs for tracking
  const imageRefs: string[] = [];
  if (trackingContext?.productImageUrl) {
    imageRefs.push(trackingContext.productImageUrl);
  } else if (productImage.geminiUri) {
    imageRefs.push(productImage.geminiUri);
  }
  if (trackingContext?.roomImageUrl) {
    imageRefs.push(trackingContext.roomImageUrl);
  } else if (roomImage.geminiUri) {
    imageRefs.push(roomImage.geminiUri);
  }

  // ==========================================================================
  // DEDUPLICATION: Check cache before making LLM call
  // ==========================================================================
  if (trackingContext) {
    // Compute hash of finalPrompt for variant-specific deduplication
    const finalPromptHash = crypto.createHash("sha256").update(finalPrompt).digest("hex").slice(0, 16);

    const requestHash = getRequestHash(
      "global_render",
      trackingContext.resolutionHash,
      imageRefs,
      finalPromptHash // Include variant-specific prompt content
    );

    try {
      const cached = await findCachedRender(trackingContext.shopId, requestHash);

      if (cached) {
        const cacheLatencyMs = Date.now() - startTime;

        logger.info(
          { ...variantLogContext, stage: "cache-hit", originalCallId: cached.originalCallId },
          `Cache hit for variant ${variantId} - returning cached result from ${cached.cachedAt.toISOString()}`
        );

        // Record cache hit for observability
        await recordCacheHit({
          shopId: trackingContext.shopId,
          renderRunId: trackingContext.renderRunId,
          promptName: "global_render",
          promptVersionId: trackingContext.promptVersionId,
          model: BASE_RENDER_MODEL,
          resolutionHash: trackingContext.resolutionHash,
          requestHash,
          originalCallId: cached.originalCallId,
        });

        return {
          variantId,
          status: "success",
          latencyMs: cacheLatencyMs,
          imageKey: cached.outputImageKey, // Return cached imageKey directly
          imageHash: cached.outputImageHash ?? undefined,
          // No imageBase64 - caller will see imageKey is set and skip upload
        };
      }
    } catch (cacheErr) {
      // Cache lookup failed - log and continue with normal render
      logger.warn(
        { ...variantLogContext, stage: "cache-error" },
        `Cache lookup failed (continuing with LLM call): ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`
      );
    }
  }

  // Define the LLM call executor
  const executeGeminiCall = async () => {
    logger.info(
      { ...variantLogContext, stage: "aspect-ratio", roomWidth, roomHeight, aspectRatio },
      `Variant ${variantId} aspect ratio resolved: ${aspectRatio ?? "none"}`
    );

    const callOnce = async (model: string) => {
      const config: any = { responseModalities: ["TEXT", "IMAGE"] as any };
      if (aspectRatio) {
        config.imageConfig = { aspectRatio };
      }

      const result = await Promise.race([
        client.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config,
        }),
        timeoutPromise,
      ]);

      const candidates = (result as any)?.candidates;
      const finishReason = candidates?.[0]?.finishReason ?? null;
      const safetyRatings =
        candidates?.[0]?.safetyRatings ?? (result as any)?.promptFeedback?.safetyRatings ?? undefined;
      const promptBlockReason = (result as any)?.promptFeedback?.blockReason ?? null;

      if (promptBlockReason) {
        const upper = String(promptBlockReason).toUpperCase();
        const code = upper.includes("SAFETY") ? "SAFETY_BLOCK" : "PROMPT_BLOCK";
        throw new VariantBlockedError({
          code,
          // Message is persisted to LLMCall.errorMessage via trackedLLMCall; keep it informative but safe.
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

      // Extract usage metadata if available
      const usageMetadata = (result as any)?.usageMetadata;
      const tokensIn = usageMetadata?.promptTokenCount ?? undefined;
      const tokensOut = usageMetadata?.candidatesTokenCount ?? undefined;

      // Estimate cost (rough estimate based on Gemini pricing)
      let costEstimate: number | undefined;
      if (tokensIn !== undefined || tokensOut !== undefined) {
        const inCost = ((tokensIn ?? 0) / 1_000_000) * 0.10;
        const outCost = ((tokensOut ?? 0) / 1_000_000) * 0.40;
        costEstimate = inCost + outCost;
      }

      return {
        imageBase64,
        usage: { tokensIn, tokensOut, cost: costEstimate },
        providerModel: model,
        providerMeta: {
          finishReason,
          blockReason: promptBlockReason,
          safetyRatings,
          aspectRatio,
          roomWidth,
          roomHeight,
        },
      };
    };

    // Interactive default: FAST by default; PRO only on defined fallback condition (retry after FAST failure).
    const baseModel = BASE_RENDER_MODEL;
    const allowFallbackToPro = baseModel === GEMINI_IMAGE_MODEL_FAST;

    try {
      const first = await callOnce(baseModel);
      return {
        result: first,
        usage: first.usage,
        providerModel: first.providerModel,
        outputPreview: first.imageBase64 ? `[IMAGE:${first.imageBase64.length} bytes]` : undefined,
      };
    } catch (err: any) {
      const isTimeout = err?.message === "Timeout" || err?.name === "TimeoutError";
      const isBlocked = err instanceof VariantBlockedError;
      if (allowFallbackToPro && !isTimeout && !isBlocked) {
        logger.warn(
          { ...variantLogContext, stage: "model-fallback", from: baseModel, to: GEMINI_IMAGE_MODEL_PRO },
          `Variant ${variantId} retrying with PRO after FAST failure: ${err?.message ?? String(err)}`
        );
        const second = await callOnce(GEMINI_IMAGE_MODEL_PRO);
        return {
          result: second,
          usage: second.usage,
          providerModel: second.providerModel,
          outputPreview: second.imageBase64 ? `[IMAGE:${second.imageBase64.length} bytes]` : undefined,
        };
      }
      throw err;
    }
  };

  try {
    let geminiResult: {
      imageBase64: string;
      providerModel: string;
      providerMeta?: any;
    };

    // If we have tracking context, wrap the call with trackedLLMCall
    if (trackingContext) {
      // Build a provider-style request summary for debugging (no raw base64 stored).
      const productMime = `image/${productImage.meta.format === "jpeg" ? "jpeg" : productImage.meta.format}`;
      const roomMime = `image/${roomImage.meta.format === "jpeg" ? "jpeg" : roomImage.meta.format}`;
      const inputPayload = {
        kind: "see-it-now.global_render",
        variantId,
        promptName: "global_render",
        // These are what we *intend* to call with (actual used model may be PRO if fallback kicks in)
        baseModel: BASE_RENDER_MODEL,
        imageRefs,
        images: [
          productImage.geminiUri
            ? {
                role: "prepared_product_image",
                source: "fileData",
                mimeType: productMime,
                fileUri: productImage.geminiUri,
              }
            : {
                role: "prepared_product_image",
                source: "inlineData",
                mimeType: productMime,
                byteLength: productImage.buffer.byteLength,
                sha256_16: hashBuffer(productImage.buffer),
              },
          roomImage.geminiUri
            ? {
                role: "customer_room_image",
                source: "fileData",
                mimeType: roomMime,
                fileUri: roomImage.geminiUri,
              }
            : {
                role: "customer_room_image",
                source: "inlineData",
                mimeType: roomMime,
                byteLength: roomImage.buffer.byteLength,
                sha256_16: hashBuffer(roomImage.buffer),
              },
        ],
        roomMeta: roomImage.meta,
        productMeta: productImage.meta,
        aspectRatio,
        // This is the full text prompt we send (this is what you need when renders are bad)
        finalPrompt,
        finalPromptLength: finalPrompt.length,
        finalPromptSha256_16: stableJsonSha256_16(finalPrompt),
        // What we'll pass to Gemini (minus raw base64)
        geminiRequest: {
          model: BASE_RENDER_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                productImage.geminiUri
                  ? { fileData: { mimeType: productMime, fileUri: productImage.geminiUri } }
                  : { inlineData: { mimeType: productMime, byteLength: productImage.buffer.byteLength, sha256_16: hashBuffer(productImage.buffer) } },
                roomImage.geminiUri
                  ? { fileData: { mimeType: roomMime, fileUri: roomImage.geminiUri } }
                  : { inlineData: { mimeType: roomMime, byteLength: roomImage.buffer.byteLength, sha256_16: hashBuffer(roomImage.buffer) } },
                { text: finalPrompt },
              ],
            },
          ],
          config: {
            responseModalities: ["TEXT", "IMAGE"],
            ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
          },
        },
      };

      geminiResult = await trackedLLMCall(
        {
          shopId: trackingContext.shopId,
          renderRunId: trackingContext.renderRunId,
          variantResultId: undefined, // We could add this if needed
          promptName: "global_render",
          promptVersionId: trackingContext.promptVersionId,
          model: BASE_RENDER_MODEL,
          messages: [{ role: "user", content: finalPrompt }],
          params: {
            responseModalities: ["TEXT", "IMAGE"],
            ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
          },
          imageRefs,
          resolutionHash: trackingContext.resolutionHash,
          inputPayload,
        },
        executeGeminiCall
      );
    } else {
      // Safety net: execute without tracking if somehow trackingContext is undefined
      // This should not happen in normal operation - all code paths now create a tracking context
      logger.error(
        { ...variantLogContext, stage: "tracking-missing" },
        "UNEXPECTED: No tracking context available - LLM call will not be tracked"
      );
      const result = await executeGeminiCall();
      geminiResult = result.result;
    }

    const imageBase64 = geminiResult.imageBase64;
    const latencyMs = Date.now() - startTime;

    logger.info(
      { ...variantLogContext, stage: "complete" },
      `Variant ${variantId} rendered in ${latencyMs}ms`
    );

    return {
      variantId,
      status: "success",
      latencyMs,
      imageBase64,
      imageHash: hashBuffer(Buffer.from(imageBase64, "base64")),
      // Additive metadata for callers/persistence (does not change existing consumers)
      providerModel: geminiResult.providerModel,
      providerMeta: geminiResult.providerMeta,
    } as any;
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = error.message === "Timeout";
    const isBlocked = error instanceof VariantBlockedError;
    const inferredFinishReason = !isBlocked
      ? extractFinishReasonFromMessage(error instanceof Error ? error.message : undefined)
      : null;

    logger.error(
      {
        ...variantLogContext,
        stage: "error",
        errorCode: isTimeout ? "TIMEOUT" : isBlocked ? error.code : "PROVIDER_ERROR",
        finishReason: isBlocked ? error.finishReason : inferredFinishReason ?? undefined,
        blockReason: isBlocked ? error.blockReason : undefined,
        causeId: isBlocked ? error.causeId : undefined,
      },
      `Variant ${variantId} failed: ${error.message}`
    );

    return {
      variantId,
      status: isTimeout ? "timeout" : "failed",
      latencyMs,
      // Keep client-facing message user-safe (do not leak internal block reasons)
      errorMessage: isBlocked
        ? "Your request was blocked by safety filters. Please try a different prompt."
        : isTimeout
          ? "The render timed out. Please try again."
          : "The render failed. Please try again.",
      // Additive structured error (keeps existing consumers working via errorMessage)
      error: {
        code: isTimeout ? "TIMEOUT" : isBlocked ? error.code : "PROVIDER_ERROR",
        message: isBlocked
          ? "Your request was blocked by safety filters. Please try a different prompt."
          : isTimeout
            ? "The render timed out. Please try again."
            : "The render failed. Please try again.",
        requestId: logContext.requestId,
        variantId,
        finishReason: isBlocked ? error.finishReason ?? null : inferredFinishReason ?? undefined,
        blockReason: isBlocked ? error.blockReason ?? null : undefined,
        causeId: isBlocked ? error.causeId : undefined,
      },
    } as any;
  }
}

/**
 * Upload a variant result to GCS
 */
async function uploadVariantImage(
  runId: string,
  variantId: string,
  imageBase64: string
): Promise<string> {
  const buffer = Buffer.from(imageBase64, "base64");

  // Convert to JPEG for storage
  const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();

  const key = `see-it-now/${runId}/${variantId}.jpg`;
  await StorageService.uploadBuffer(jpegBuffer, key, "image/jpeg");

  return key;
}

/**
 * Render all 8 variants in parallel with Early Return optimization
 * Integrates with Prompt Control Plane for LLM call tracking and config snapshots
 */
export async function renderAllVariants(
  input: RenderInput,
  options?: {
    mode?: RenderAllVariantsMode;
  } & RenderAllVariantsCallbacks
): Promise<RenderRunResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const mode: RenderAllVariantsMode = options?.mode ?? "early_return";

  const logContext = createLogContext("render", input.requestId, "start", {
    runId,
    productAssetId: input.productAssetId,
    roomSessionId: input.roomSessionId,
  });

  logger.info(
    logContext,
    `Starting render run with ${input.promptPack.variants.length} variants (baseModel=${BASE_RENDER_MODEL})`
  );

  // ==========================================================================
  // PROMPT CONTROL PLANE: Build resolved config snapshot
  // ==========================================================================
  let configSnapshot: ResolvedConfigSnapshot | null = null;
  let trackingContext: RenderTrackingContext | undefined;

  try {
    // Build variables for prompt resolution
    const variables: Record<string, string> = {
      "product.title": input.resolvedFacts.identity?.title || "",
      "product.kind": input.resolvedFacts.identity?.product_kind || "",
      "product.category": input.resolvedFacts.identity?.category_path?.join(" > ") || "",
      "product.material": input.resolvedFacts.material_profile?.primary || "",
      "product.weight": input.resolvedFacts.weight_class || "",
      "product.placement_modes": input.resolvedFacts.placement?.allowed_modes?.map(m => m.mode).join(", ") || "",
      "product.constraints": input.resolvedFacts.placement?.constraints?.join("; ") || "",
      "product.scale_guardrails": input.resolvedFacts.scale_guardrails || "",
    };

    configSnapshot = await buildResolvedConfigSnapshot({
      shopId: input.shopId,
      promptNames: ["global_render"],
      variables,
    });

    logger.info(
      { ...logContext, stage: "prompt-control" },
      `Built config snapshot: prompts=${Object.keys(configSnapshot.prompts).join(",")}, blocked=${Object.keys(configSnapshot.blockedPrompts).join(",") || "none"}`
    );

    // Check for blocked prompts
    if (Object.keys(configSnapshot.blockedPrompts).length > 0) {
      logger.warn(
        { ...logContext, stage: "prompt-control" },
        `Blocked prompts: ${JSON.stringify(configSnapshot.blockedPrompts)}`
      );
    }

    // Build tracking context for renderSingleVariant
    const globalRenderPrompt = configSnapshot.prompts["global_render"];
    if (globalRenderPrompt) {
      trackingContext = {
        shopId: input.shopId,
        renderRunId: runId,
        promptVersionId: globalRenderPrompt.promptVersionId,
        resolutionHash: globalRenderPrompt.resolutionHash,
        productImageUrl: input.productImage.geminiUri,
        roomImageUrl: input.roomImage.geminiUri,
      };
    } else {
      // Prompt not found in snapshot - might be blocked or not defined
      // Still create tracking context with minimal info
      logger.warn(
        { ...logContext, stage: "prompt-control-missing" },
        `global_render prompt not found in snapshot (blocked: ${JSON.stringify(configSnapshot.blockedPrompts["global_render"] || "no")})`
      );

      trackingContext = {
        shopId: input.shopId,
        renderRunId: runId,
        promptVersionId: null,
        resolutionHash: "prompt-not-found:global_render",
        productImageUrl: input.productImage.geminiUri,
        roomImageUrl: input.roomImage.geminiUri,
      };
    }
  } catch (err) {
    // Log warning but create minimal tracking context so LLM calls are still recorded
    logger.warn(
      { ...logContext, stage: "prompt-control-error" },
      `Failed to build config snapshot (continuing with degraded tracking): ${err instanceof Error ? err.message : String(err)}`
    );

    // Create minimal tracking context - ensures LLM calls are still logged
    // even when prompt resolution fails. This maintains observability.
    trackingContext = {
      shopId: input.shopId,
      renderRunId: runId,
      promptVersionId: null, // Unknown due to resolution failure
      resolutionHash: "unresolved:" + (err instanceof Error ? err.message : "unknown").slice(0, 50),
      productImageUrl: input.productImage.geminiUri,
      roomImageUrl: input.roomImage.geminiUri,
    };

    logger.info(
      { ...logContext, stage: "prompt-control-fallback" },
      `Created fallback tracking context for shopId=${input.shopId}, runId=${runId}`
    );
  }

  // ==========================================================================
  // Write RenderRun record with resolved config snapshot
  // ==========================================================================
  await startRun({
    runId,
    shopId: input.shopId,
    requestId: input.requestId,
    productAssetId: input.productAssetId,
    roomSessionId: input.roomSessionId,
    promptPackVersion: input.promptPackVersion,
    model: BASE_RENDER_MODEL,
    productImageHash: input.productImage.hash,
    productImageMeta: input.productImage.meta,
    roomImageHash: input.roomImage.hash,
    roomImageMeta: input.roomImage.meta,
    resolvedFactsHash: hashPrompt(JSON.stringify(input.resolvedFacts)),
    resolvedFactsJson: input.resolvedFacts as unknown as Record<string, unknown>,
    promptPackHash: hashPrompt(JSON.stringify(input.promptPack)),
    promptPackJson: input.promptPack as unknown as Record<string, unknown>,
  });

  // Store resolved config snapshot on the RenderRun (if available)
  if (configSnapshot) {
    try {
      await prisma.renderRun.update({
        where: { id: runId },
        data: {
          resolvedConfigSnapshot: configSnapshot as unknown as Record<string, unknown>,
        },
      });
    } catch (err) {
      logger.warn(
        { ...logContext, stage: "prompt-control-snapshot" },
        `Failed to store config snapshot: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Inform caller that run exists (never block/throw)
  if (options?.onRunStarted) {
    try {
      options.onRunStarted({
        runId,
        totalVariants: input.promptPack.variants.length,
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
  const totalVariants = input.promptPack.variants.length;

  // Create a resolver for early return
  let resolveEarly: (value: void | PromiseLike<void>) => void;
  const earlyReturnPromise = new Promise<void>((resolve) => {
    resolveEarly = resolve;
  });

  // Create a resolver for "all done" (used by streaming mode)
  let resolveAllDone: (value: void | PromiseLike<void>) => void;
  const allDonePromise = new Promise<void>((resolve) => {
    resolveAllDone = resolve;
  });

  let earlyReturnFired = false;

  // Fire all variants in parallel
  input.promptPack.variants.forEach((variant) => {
    // Record variant start (fire-and-forget)
    recordVariantStart({
      runId,
      variantId: variant.id,
      requestId: input.requestId,
      shopId: input.shopId,
    });

    const finalPrompt = assembleFinalPrompt(
      input.promptPack.product_context,
      variant.variation
    );

    renderSingleVariant(
      variant.id,
      finalPrompt,
      input.productImage, // Pass full object (buffer + geminiUri)
      input.roomImage,    // Pass full object
      logContext,
      trackingContext     // Pass tracking context for LLM call tracking
    ).then(async (result) => {
      // Handle completion
      let imageKey: string | undefined = result.imageKey; // Preserve cached imageKey if present

      if (result.status === "success" && result.imageBase64 && !result.imageKey) {
        // Only upload if we have imageBase64 and no cached imageKey
        try {
          // Upload to GCS
          // Note: In a real early-return scenario, we might want to do this async
          // but for now we await it to ensure the key is ready before we count it as success
          imageKey = await uploadVariantImage(runId, result.variantId, result.imageBase64);

          // =======================================================================
          // DEDUPLICATION: Update LLMCall with outputImageKey for future cache hits
          // =======================================================================
          if (trackingContext && imageKey) {
            try {
              // Rebuild imageRefs (same logic as renderSingleVariant)
              const imageRefs: string[] = [];
              if (trackingContext.productImageUrl) {
                imageRefs.push(trackingContext.productImageUrl);
              } else if (input.productImage.geminiUri) {
                imageRefs.push(input.productImage.geminiUri);
              }
              if (trackingContext.roomImageUrl) {
                imageRefs.push(trackingContext.roomImageUrl);
              } else if (input.roomImage.geminiUri) {
                imageRefs.push(input.roomImage.geminiUri);
              }

              // Compute the same requestHash used for tracking
              const finalPromptHash = crypto.createHash("sha256")
                .update(finalPrompt)
                .digest("hex")
                .slice(0, 16);
              const requestHash = getRequestHash(
                "global_render",
                trackingContext.resolutionHash,
                imageRefs,
                finalPromptHash
              );

              // Find the LLMCall and update it with the imageKey
              const callId = await findRecentCallForRun(runId, requestHash);
              if (callId) {
                await updateLLMCallWithOutput(callId, imageKey, undefined, {
                  outputImageHash: result.imageHash,
                  seeItNow: {
                    variantId: result.variantId,
                    providerModel: (result as any).providerModel,
                    providerMeta: (result as any).providerMeta,
                  },
                });
                logger.debug(
                  { ...logContext, variantId: result.variantId, callId },
                  `Updated LLMCall with outputImageKey for cache`
                );
              }
            } catch (cacheUpdateErr) {
              // Non-fatal: cache update failure shouldn't block the render
              logger.warn(
                { ...logContext, variantId: result.variantId },
                `Failed to update LLMCall with imageKey (non-fatal): ${cacheUpdateErr instanceof Error ? cacheUpdateErr.message : String(cacheUpdateErr)}`
              );
            }
          }
        } catch (err) {
          logger.error(
            { ...logContext, variantId: result.variantId },
            `Failed to upload variant image: ${err}`
          );
        }
      }

      // Record result (imageKey may come from cache or fresh upload)
      const finalResult = { ...result, imageKey };
      results.push(finalResult);

      completedCount++;
      if (result.status === "success") {
        successCount++;
      }

      const elapsed = Date.now() - startTime;

      // Early Return Check:
      // Condition: (4+ successes AND >10s elapsed) OR (All completed)
      // Check for completion
      if (completedCount === totalVariants) {
        resolveEarly();
        resolveAllDone();
      } else if (successCount >= 4 && elapsed > 10000) {
        // Trigger early return
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
                `onEarlyReturn callback failed: ${
                  e instanceof Error ? e.message : String(e)
                }`
              );
            }
          }
        }
      }

      // Notify caller (never block/throw)
      if (options?.onVariantCompleted) {
        try {
          const maybePromise = options.onVariantCompleted(finalResult);
          Promise.resolve(maybePromise).catch((e) => {
            logger.warn(
              { ...logContext, stage: "callback-error", variantId: result.variantId },
              `onVariantCompleted callback async failure: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
          });
        } catch (e) {
          logger.warn(
            { ...logContext, stage: "callback-error", variantId: result.variantId },
            `onVariantCompleted callback failed: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
        }
      }

      // Persist to DB
      const v = input.promptPack.variants.find(v => v.id === result.variantId);
      const p = v ? assembleFinalPrompt(input.promptPack.product_context, v.variation) : "";

      await recordVariantResult({
        renderRunId: runId,
        variantId: result.variantId,
        finalPromptHash: hashPrompt(p),
        requestId: input.requestId,
        shopId: input.shopId,
        status: result.status,
        latencyMs: result.latencyMs,
        outputImageKey: imageKey,
        outputImageHash: result.imageHash,
        errorCode: result.status === "timeout" ? "TIMEOUT" : result.status === "failed" ? "PROVIDER_ERROR" : undefined,
        errorMessage: result.errorMessage,
      }).catch(e => console.error("Failed to write variant result", e));

    });
  });

  // Wait for Early Return condition or All Complete
  // We also set a hard safety timeout of 60s (just in case)
  const safetyTimeout = new Promise<void>(r => setTimeout(r, 60000));

  await Promise.race([
    mode === "wait_all" ? allDonePromise : earlyReturnPromise,
    safetyTimeout,
  ]);

  const totalDurationMs = Date.now() - startTime;

  // Determine final status
  let status: "complete" | "partial" | "failed";
  if (successCount === totalVariants) {
    status = "complete";
  } else if (successCount > 0) {
    status = "partial";
  } else {
    status = "failed";
  }

  // Update RenderRun with final status
  await completeRun({
    runId,
    requestId: input.requestId,
    shopId: input.shopId,
    status,
    totalDurationMs,
    successCount,
    failCount: results.filter((r) => r.status === "failed").length,
    timeoutCount: results.filter((r) => r.status === "timeout").length,
  });

  // ==========================================================================
  // PROMPT CONTROL PLANE: Calculate and store run totals
  // ==========================================================================
  try {
    // Fetch LLM call records for this run to calculate totals
    const llmCalls = await prisma.lLMCall.findMany({
      where: { renderRunId: runId },
      select: {
        status: true,
        tokensIn: true,
        tokensOut: true,
        costEstimate: true,
        latencyMs: true,
      },
    });

    if (llmCalls.length > 0) {
      // Calculate totals
      let tokensIn = 0;
      let tokensOut = 0;
      let costEstimate = 0;
      let callsSucceeded = 0;
      let callsFailed = 0;
      let callsTimeout = 0;
      const latencies: number[] = [];

      for (const call of llmCalls) {
        if (call.tokensIn) tokensIn += call.tokensIn;
        if (call.tokensOut) tokensOut += call.tokensOut;
        if (call.costEstimate) costEstimate += Number(call.costEstimate);
        if (call.latencyMs) latencies.push(call.latencyMs);

        switch (call.status) {
          case "SUCCEEDED":
            callsSucceeded++;
            break;
          case "FAILED":
            callsFailed++;
            break;
          case "TIMEOUT":
            callsTimeout++;
            break;
        }
      }

      // Calculate inference timing stats
      const sortedLatencies = latencies.sort((a, b) => a - b);
      const inferenceMs = sortedLatencies.reduce((a, b) => a + b, 0);
      const inferenceP50 = sortedLatencies.length > 0
        ? sortedLatencies[Math.floor(sortedLatencies.length * 0.5)]
        : undefined;
      const inferenceP95 = sortedLatencies.length > 0
        ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)]
        : undefined;

      // Build waterfall timing (rough estimates)
      const waterfallMs = {
        download_ms: 0, // Would need to track this separately
        prompt_build_ms: 0, // Would need to track this separately
        inference_ms: inferenceMs,
        inference_p50_ms: inferenceP50,
        inference_p95_ms: inferenceP95,
        upload_ms: 0, // Would need to track this separately
        total_ms: totalDurationMs,
      };

      // Build run totals
      const runTotals = {
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_estimate: costEstimate,
        calls_total: llmCalls.length,
        calls_succeeded: callsSucceeded,
        calls_failed: callsFailed,
        calls_timeout: callsTimeout,
      };

      // Update RenderRun with totals
      await prisma.renderRun.update({
        where: { id: runId },
        data: {
          waterfallMs: waterfallMs as unknown as Record<string, unknown>,
          runTotals: runTotals as unknown as Record<string, unknown>,
        },
      });

      logger.info(
        { ...logContext, stage: "prompt-control-totals" },
        `Updated run totals: calls=${llmCalls.length}, tokens_in=${tokensIn}, tokens_out=${tokensOut}, cost=$${costEstimate.toFixed(4)}`
      );
    }
  } catch (err) {
    // Log but don't fail - totals are informational
    logger.warn(
      { ...logContext, stage: "prompt-control-totals-error" },
      `Failed to calculate run totals: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  logger.info(
    { ...logContext, stage: "complete" },
    `Render run returning early/complete: ${successCount}/${totalVariants} successes (completed: ${completedCount}), ${totalDurationMs}ms, status=${status}`
  );

  return {
    runId,
    status,
    totalDurationMs,
    variants: results,
  };
}
