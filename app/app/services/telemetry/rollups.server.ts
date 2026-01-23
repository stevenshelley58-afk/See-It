/**
 * Telemetry Rollups
 *
 * Write to RenderRun and VariantResult tables.
 * These are "fast query" tables for dashboard UI.
 *
 * CRITICAL: Never throw on hot path. Set telemetryDropped=true if writes fail.
 */

import prisma from "~/db.server";
import { emit, emitError } from "./emitter.server";
import { EventSource, EventType } from "./constants";
import type {
  StartRunInput,
  RecordVariantStartInput,
  RecordVariantResultInput,
  CompleteRunInput,
} from "./types";

/**
 * Start a new render run. Creates RenderRun with status=in_flight.
 * Returns true on success, false on failure.
 */
export async function startRun(input: StartRunInput): Promise<boolean> {
  try {
    await prisma.renderRun.create({
      data: {
        id: input.runId,
        shopId: input.shopId,
        requestId: input.requestId,
        productAssetId: input.productAssetId,
        roomSessionId: input.roomSessionId,
        promptPackVersion: input.promptPackVersion,
        model: input.model,
        traceId: input.traceId,
        productImageHash: input.productImageHash,
        productImageMeta: input.productImageMeta,
        roomImageHash: input.roomImageHash,
        roomImageMeta: input.roomImageMeta,
        resolvedFactsHash: input.resolvedFactsHash,
        resolvedFactsJson: input.resolvedFactsJson,
        promptPackHash: input.promptPackHash,
        promptPackJson: input.promptPackJson,
        status: "in_flight",
        startedAt: new Date(),
        successCount: 0,
        failCount: 0,
        timeoutCount: 0,
        telemetryDropped: false,
      },
    });

    // Emit event (fire and forget)
    emit({
      shopId: input.shopId,
      requestId: input.requestId,
      runId: input.runId,
      traceId: input.traceId,
      source: EventSource.RENDERER,
      type: EventType.RENDER_RUN_CREATED,
      payload: {
        promptPackVersion: input.promptPackVersion,
        model: input.model,
        productAssetId: input.productAssetId,
      },
    });

    return true;
  } catch (error) {
    console.error("[Rollups] Failed to start run:", error);
    emitError(
      {
        shopId: input.shopId,
        requestId: input.requestId,
        runId: input.runId,
        source: EventSource.RENDERER,
      },
      error,
      { operation: "startRun" }
    );
    return false;
  }
}

/**
 * Record that a variant has started processing.
 * Returns true on success, false on failure.
 */
export async function recordVariantStart(
  input: RecordVariantStartInput
): Promise<boolean> {
  try {
    // Emit event only - no DB record yet
    emit({
      shopId: input.shopId,
      requestId: input.requestId,
      runId: input.runId,
      variantId: input.variantId,
      source: EventSource.RENDERER,
      type: EventType.RENDER_VARIANT_STARTED,
      payload: { variantId: input.variantId },
    });

    return true;
  } catch (error) {
    console.error("[Rollups] Failed to record variant start:", error);
    return false;
  }
}

/**
 * Record a variant result. Creates VariantResult record.
 * Returns true on success, false on failure.
 */
export async function recordVariantResult(
  input: RecordVariantResultInput
): Promise<boolean> {
  try {
    await prisma.variantResult.create({
      data: {
        renderRunId: input.renderRunId,
        variantId: input.variantId,
        finalPromptHash: input.finalPromptHash,
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt || new Date(),
        latencyMs: input.latencyMs,
        providerMs: input.providerMs,
        uploadMs: input.uploadMs,
        outputImageKey: input.outputImageKey,
        outputImageHash: input.outputImageHash,
        outputArtifactId: input.outputArtifactId,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });

    // Emit event (fire and forget)
    emit({
      shopId: input.shopId,
      requestId: input.requestId,
      runId: input.renderRunId,
      variantId: input.variantId,
      source: EventSource.RENDERER,
      type: EventType.RENDER_VARIANT_COMPLETED,
      payload: {
        status: input.status,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode,
      },
    });

    return true;
  } catch (error) {
    console.error("[Rollups] Failed to record variant result:", error);

    // Try to mark telemetry dropped on the run
    markTelemetryDropped(input.renderRunId);

    return false;
  }
}

/**
 * Complete a render run. Updates status and counts.
 * Returns true on success, false on failure.
 */
export async function completeRun(input: CompleteRunInput): Promise<boolean> {
  try {
    await prisma.renderRun.update({
      where: { id: input.runId },
      data: {
        status: input.status,
        totalDurationMs: input.totalDurationMs,
        successCount: input.successCount,
        failCount: input.failCount,
        timeoutCount: input.timeoutCount,
        completedAt: new Date(),
      },
    });

    // Emit event (fire and forget)
    emit({
      shopId: input.shopId,
      requestId: input.requestId,
      runId: input.runId,
      source: EventSource.RENDERER,
      type: EventType.RENDER_RUN_COMPLETED,
      payload: {
        status: input.status,
        totalDurationMs: input.totalDurationMs,
        successCount: input.successCount,
        failCount: input.failCount,
        timeoutCount: input.timeoutCount,
      },
    });

    return true;
  } catch (error) {
    console.error("[Rollups] Failed to complete run:", error);

    // Try to mark telemetry dropped
    markTelemetryDropped(input.runId);

    return false;
  }
}

/**
 * Mark a run as having dropped telemetry. Best effort, never throws.
 */
function markTelemetryDropped(runId: string): void {
  prisma.renderRun
    .update({
      where: { id: runId },
      data: { telemetryDropped: true },
    })
    .catch((err: unknown) => {
      console.error("[Rollups] Failed to mark telemetryDropped:", err);
    });
}
