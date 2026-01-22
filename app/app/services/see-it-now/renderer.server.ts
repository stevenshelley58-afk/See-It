import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import crypto from "crypto";
import { logger, createLogContext } from "~/utils/logger.server";
import { GEMINI_IMAGE_MODEL_FAST } from "~/config/ai-models.config";
import { StorageService } from "~/services/storage.server";
import { assembleFinalPrompt, hashPrompt } from "./prompt-assembler.server";
import { writeRenderRun, writeVariantResult } from "./monitor.server";
import prisma from "~/db.server";
import type {
  RenderInput,
  RenderRunResult,
  VariantRenderResult,
} from "./types";

const VARIANT_TIMEOUT_MS = 45000; // 45 seconds per variant

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
  productBuffer: Buffer,
  roomBuffer: Buffer,
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
  const parts: any[] = [
    // 1. Product image (first)
    {
      inlineData: {
        mimeType: "image/png",
        data: productBuffer.toString("base64"),
      },
    },
    // 2. Room image (second - last image)
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: roomBuffer.toString("base64"),
      },
    },
    // 3. Prompt (last)
    { text: finalPrompt },
  ];

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Timeout")), VARIANT_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([
      client.models.generateContent({
        model: GEMINI_IMAGE_MODEL_FAST,
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
  await writeRenderRun({
    id: runId,
    shopId: input.shopId,
    productAssetId: input.productAssetId,
    roomSessionId: input.roomSessionId,
    requestId: input.requestId,
    promptPackVersion: input.promptPackVersion,
    model: GEMINI_IMAGE_MODEL_FAST,
    productImageHash: input.productImage.hash,
    productImageMeta: input.productImage.meta,
    roomImageHash: input.roomImage.hash,
    roomImageMeta: input.roomImage.meta,
    resolvedFactsHash: hashPrompt(JSON.stringify(input.resolvedFacts)),
    resolvedFactsJson: input.resolvedFacts,
    promptPackHash: hashPrompt(JSON.stringify(input.promptPack)),
    promptPackJson: input.promptPack,
    status: "partial", // Will update when complete
  });

  // Fire all variants in parallel
  const variantPromises = input.promptPack.variants.map((variant) => {
    const finalPrompt = assembleFinalPrompt(
      input.promptPack.product_context,
      variant.variation
    );

    return renderSingleVariant(
      variant.id,
      finalPrompt,
      input.productImage.buffer,
      input.roomImage.buffer,
      logContext
    );
  });

  const results = await Promise.all(variantPromises);

  // Upload successful images and write variant results
  const finalResults: VariantRenderResult[] = [];

  for (const result of results) {
    let imageKey: string | undefined;

    if (result.status === "success" && result.imageBase64) {
      try {
        imageKey = await uploadVariantImage(runId, result.variantId, result.imageBase64);
      } catch (err) {
        logger.error(
          { ...logContext, variantId: result.variantId },
          `Failed to upload variant image: ${err}`
        );
      }
    }

    const variant = input.promptPack.variants.find(
      (v) => v.id === result.variantId
    );
    const finalPrompt = variant
      ? assembleFinalPrompt(input.promptPack.product_context, variant.variation)
      : "";

    // Write variant result
    await writeVariantResult({
      renderRunId: runId,
      variantId: result.variantId,
      finalPromptHash: hashPrompt(finalPrompt),
      status: result.status,
      latencyMs: result.latencyMs,
      outputImageKey: imageKey,
      outputImageHash: result.imageHash,
      errorMessage: result.errorMessage,
    });

    finalResults.push({
      ...result,
      imageKey,
    });
  }

  const totalDurationMs = Date.now() - startTime;
  const successCount = finalResults.filter((r) => r.status === "success").length;

  // Determine final status
  let status: "complete" | "partial" | "failed";
  if (successCount === 8) {
    status = "complete";
  } else if (successCount > 0) {
    status = "partial";
  } else {
    status = "failed";
  }

  // Update RenderRun with final status
  await prisma.renderRun.update({
    where: { id: runId },
    data: { status, totalDurationMs },
  });

  logger.info(
    { ...logContext, stage: "complete" },
    `Render run complete: ${successCount}/8 variants, ${totalDurationMs}ms, status=${status}`
  );

  return {
    runId,
    status,
    totalDurationMs,
    variants: finalResults,
  };
}
