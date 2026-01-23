import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import crypto from "crypto";
import { logger, createLogContext } from "~/utils/logger.server";
import { GEMINI_IMAGE_MODEL_FAST, GEMINI_IMAGE_MODEL_PRO } from "~/config/ai-models.config";
import { StorageService } from "~/services/storage.server";
import { assembleFinalPrompt, hashPrompt } from "./prompt-assembler.server";
import {
  startRun,
  recordVariantStart,
  recordVariantResult,
  completeRun,
} from "~/services/telemetry";
import type {
  ImageMeta,
  RenderInput,
  RenderRunResult,
  VariantRenderResult,
} from "./types";

const VARIANT_TIMEOUT_MS = 45000; // 45 seconds per variant

// Env-based toggle for model selection (allows PRO for high-quality testing)
const RENDER_MODEL = process.env.SEE_IT_NOW_RENDER_MODEL === "PRO" 
  ? GEMINI_IMAGE_MODEL_PRO 
  : GEMINI_IMAGE_MODEL_FAST;

/**
 * Hash a buffer using SHA256 (first 16 chars)
 */
function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

/**
 * Render a single variant with timeout
 */
async function renderSingleVariant(
  variantId: string,
  finalPrompt: string,
  productImage: { buffer: Buffer; meta: ImageMeta; geminiUri?: string },
  roomImage: { buffer: Buffer; meta: ImageMeta; geminiUri?: string },
  logContext: ReturnType<typeof createLogContext>
): Promise<VariantRenderResult> {
  const startTime = Date.now();
  const variantLogContext = { ...logContext, variantId };

  logger.info(variantLogContext, `Rendering variant ${variantId}`);

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

  try {
    const result = await Promise.race([
      client.models.generateContent({
        model: RENDER_MODEL,
        contents: [{ role: "user", parts }],
        config: { responseModalities: ["TEXT", "IMAGE"] as any },
      }),
      timeoutPromise,
    ]);

    // Extract image from response
    let imageBase64: string | undefined;

    const candidates = (result as any)?.candidates;
    if (candidates?.[0]?.content?.parts) {
      for (const part of candidates[0].content.parts) {
        if ((part as any)?.inlineData?.data) {
          imageBase64 = (part as any).inlineData.data;
          break;
        }
      }
    }

    if (!imageBase64) {
      throw new Error("No image in response");
    }

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
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = error.message === "Timeout";

    logger.error(
      { ...variantLogContext, stage: "error" },
      `Variant ${variantId} failed: ${error.message}`
    );

    return {
      variantId,
      status: isTimeout ? "timeout" : "failed",
      latencyMs,
      errorMessage: error.message?.slice(0, 500),
    };
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
 * Render all 8 variants in parallel
 */
/**
 * Render all 8 variants in parallel with Early Return optimization
 */
export async function renderAllVariants(
  input: RenderInput
): Promise<RenderRunResult> {
  const startTime = Date.now();
  const runId = crypto.randomUUID();

  const logContext = createLogContext("render", input.requestId, "start", {
    runId,
    productAssetId: input.productAssetId,
    roomSessionId: input.roomSessionId,
  });

  logger.info(
    logContext,
    `Starting render run with ${input.promptPack.variants.length} variants`
  );

  // Write RenderRun record first
  await startRun({
    runId,
    shopId: input.shopId,
    requestId: input.requestId,
    productAssetId: input.productAssetId,
    roomSessionId: input.roomSessionId,
    promptPackVersion: input.promptPackVersion,
    model: RENDER_MODEL,
    productImageHash: input.productImage.hash,
    productImageMeta: input.productImage.meta,
    roomImageHash: input.roomImage.hash,
    roomImageMeta: input.roomImage.meta,
    resolvedFactsHash: hashPrompt(JSON.stringify(input.resolvedFacts)),
    resolvedFactsJson: input.resolvedFacts as unknown as Record<string, unknown>,
    promptPackHash: hashPrompt(JSON.stringify(input.promptPack)),
    promptPackJson: input.promptPack as unknown as Record<string, unknown>,
  });

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
      logContext
    ).then(async (result) => {
      // Handle completion
      let imageKey: string | undefined;

      if (result.status === "success" && result.imageBase64) {
        try {
          // Upload to GCS
          // Note: In a real early-return scenario, we might want to do this async
          // but for now we await it to ensure the key is ready before we count it as success
          imageKey = await uploadVariantImage(runId, result.variantId, result.imageBase64);
        } catch (err) {
          logger.error(
            { ...logContext, variantId: result.variantId },
            `Failed to upload variant image: ${err}`
          );
        }
      }

      // Record result
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
      } else if (successCount >= 4 && elapsed > 10000) {
        // Trigger early return
        resolveEarly();
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

  await Promise.race([earlyReturnPromise, safetyTimeout]);

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
