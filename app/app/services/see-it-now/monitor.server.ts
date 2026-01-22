import prisma from "~/db.server";
import { logger, createLogContext } from "~/utils/logger.server";
import type { ImageMeta, ProductPlacementFacts, PromptPack } from "./types";

interface RenderRunInput {
  id: string;
  shopId: string;
  productAssetId: string;
  roomSessionId: string | null;
  requestId: string;
  promptPackVersion: number;
  model: string;
  productImageHash: string;
  productImageMeta: ImageMeta;
  roomImageHash: string;
  roomImageMeta: ImageMeta;
  resolvedFactsHash: string;
  resolvedFactsJson: ProductPlacementFacts;
  promptPackHash: string;
  promptPackJson: PromptPack;
  status: string;
}

interface VariantResultInput {
  renderRunId: string;
  variantId: string;
  finalPromptHash: string;
  status: string;
  latencyMs?: number;
  outputImageKey?: string;
  outputImageHash?: string;
  errorMessage?: string;
}

/**
 * Write a RenderRun record
 */
export async function writeRenderRun(input: RenderRunInput): Promise<void> {
  try {
    await prisma.renderRun.create({
      data: {
        id: input.id,
        shopId: input.shopId,
        productAssetId: input.productAssetId,
        roomSessionId: input.roomSessionId,
        requestId: input.requestId,
        promptPackVersion: input.promptPackVersion,
        model: input.model,
        productImageHash: input.productImageHash,
        productImageMeta: input.productImageMeta,
        roomImageHash: input.roomImageHash,
        roomImageMeta: input.roomImageMeta,
        resolvedFactsHash: input.resolvedFactsHash,
        resolvedFactsJson: input.resolvedFactsJson,
        promptPackHash: input.promptPackHash,
        promptPackJson: input.promptPackJson,
        status: input.status,
      },
    });
  } catch (error) {
    logger.error(
      createLogContext("render", input.requestId, "write-run-failed", {}),
      `Failed to write RenderRun: ${error}`
    );
    // Don't throw - monitor writes should not break renders
  }
}

/**
 * Write a VariantResult record
 */
export async function writeVariantResult(
  input: VariantResultInput
): Promise<void> {
  try {
    await prisma.variantResult.create({
      data: {
        renderRunId: input.renderRunId,
        variantId: input.variantId,
        finalPromptHash: input.finalPromptHash,
        status: input.status,
        latencyMs: input.latencyMs,
        outputImageKey: input.outputImageKey,
        outputImageHash: input.outputImageHash,
        errorMessage: input.errorMessage,
      },
    });
  } catch (error) {
    logger.error(
      createLogContext("render", "unknown", "write-variant-failed", {}),
      `Failed to write VariantResult: ${error}`
    );
    // Don't throw - monitor writes should not break renders
  }
}
