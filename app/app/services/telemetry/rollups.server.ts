/**
 * Telemetry Rollups
 *
 * Write to RenderRun and VariantResult tables.
 * These are "fast query" tables for dashboard UI.
 *
 * CRITICAL: Never throw on hot path. Log errors but return false.
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
 * Start a new render run. Creates RenderRun with status=RUNNING.
 * Returns true on success, false on failure.
 */
export async function startRun(input: StartRunInput): Promise<boolean> {
  try {
    await prisma.renderRun.create({
      data: {
        id: input.runId,
        shopId: input.shopId,
        productAssetId: input.productAssetId,
        roomSessionId: input.roomSessionId,
        traceId: input.traceId,
        preparedProductImageRef: input.preparedProductImageRef,
        preparedProductImageHash: input.preparedProductImageHash,
        roomImageRef: input.roomImageRef,
        roomImageHash: input.roomImageHash,
        resolvedFactsSnapshot: input.resolvedFactsSnapshot,
        placementSetSnapshot: input.placementSetSnapshot,
        pipelineConfigSnapshot: input.pipelineConfigSnapshot,
        pipelineConfigHash: input.pipelineConfigHash,
        status: "RUNNING",
        successCount: 0,
        failCount: 0,
        timeoutCount: 0,
      },
    });

    // Emit event (fire and forget)
    emit({
      shopId: input.shopId,
      requestId: input.traceId, // Use traceId as requestId for events
      runId: input.runId,
      traceId: input.traceId,
      source: EventSource.RENDERER,
      type: EventType.RENDER_RUN_CREATED,
      payload: {
        pipelineConfigHash: input.pipelineConfigHash,
        productAssetId: input.productAssetId,
      },
    });

    return true;
  } catch (error) {
    console.error("[Rollups] Failed to start run:", error);
    emitError(
      {
        shopId: input.shopId,
        requestId: input.traceId,
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
      requestId: input.traceId,
      runId: input.runId,
      variantId: input.variantId,
      traceId: input.traceId,
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
        runId: input.runId,
        variantId: input.variantId,
        status: input.status,
        latencyMs: input.latencyMs,
        imageRef: input.imageRef,
        imageHash: input.imageHash,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });

    // Emit event (fire and forget)
    emit({
      shopId: input.shopId,
      requestId: input.traceId,
      runId: input.runId,
      variantId: input.variantId,
      traceId: input.traceId,
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
      requestId: input.traceId,
      runId: input.runId,
      traceId: input.traceId,
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
    return false;
  }
}
