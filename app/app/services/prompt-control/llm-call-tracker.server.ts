// =============================================================================
// LLM CALL TRACKER SERVICE - CANONICAL
// The ONLY writer of llm_calls. No other code writes to this table.
// =============================================================================

import prisma from "~/db.server";
import type {
  PromptName,
  CallSummary,
  DebugPayload,
  OutputSummary,
  OwnerType,
  CallStatus,
} from "../see-it-now/types";

// =============================================================================
// Types
// =============================================================================

export interface StartCallInput {
  shopId: string;
  ownerType: OwnerType;
  ownerId: string;  // REQUIRED - no default
  variantId?: string;
  promptName: PromptName;  // REQUIRED - no default
  promptVersionId: string;
  callIdentityHash: string;  // REQUIRED - no default
  dedupeHash?: string;
  callSummary: CallSummary;  // REQUIRED
  debugPayload: DebugPayload;  // REQUIRED
}

export interface CompleteCallSuccessInput {
  callId: string;
  tokensIn: number;
  tokensOut: number;
  costEstimate: number;
  latencyMs: number;
  providerModel?: string;
  providerRequestId?: string;
  outputSummary: OutputSummary;
}

export interface CompleteCallFailureInput {
  callId: string;
  latencyMs: number;
  errorType: string;
  errorMessage: string;
  status: 'FAILED' | 'TIMEOUT';
}

// =============================================================================
// Start Call
// =============================================================================

/**
 * Create LLMCall row with status STARTED.
 * All identity fields are REQUIRED - no defaults in DB.
 *
 * @param input - Start call input with all required fields
 * @returns The call ID
 */
export async function startCall(input: StartCallInput): Promise<string> {
  // Validate required fields
  if (!input.ownerId || input.ownerId.length === 0) {
    throw new Error('ownerId is required and cannot be empty');
  }
  if (!input.callIdentityHash || input.callIdentityHash.length === 0) {
    throw new Error('callIdentityHash is required and cannot be empty');
  }

  const call = await prisma.lLMCall.create({
    data: {
      shopId: input.shopId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      variantId: input.variantId ?? null,
      promptKey: input.promptName,
      promptVersionId: input.promptVersionId,
      callIdentityHash: input.callIdentityHash,
      dedupeHash: input.dedupeHash ?? null,
      callSummary: input.callSummary,
      debugPayload: input.debugPayload,
      status: 'STARTED',
      startedAt: new Date(),
    },
  });

  return call.id;
}

// =============================================================================
// Complete Call - Success
// =============================================================================

/**
 * Update LLMCall with success status, tokens, costs, and output summary.
 *
 * @param input - Completion input for successful call
 */
export async function completeCallSuccess(
  input: CompleteCallSuccessInput
): Promise<void> {
  await prisma.lLMCall.update({
    where: { id: input.callId },
    data: {
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      latencyMs: input.latencyMs,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costEstimate: input.costEstimate,
      providerModel: input.providerModel ?? null,
      providerRequestId: input.providerRequestId ?? null,
      outputSummary: input.outputSummary,
    },
  });
}

// =============================================================================
// Complete Call - Failure
// =============================================================================

/**
 * Update LLMCall with failure status and error info.
 *
 * @param input - Completion input for failed call
 */
export async function completeCallFailure(
  input: CompleteCallFailureInput
): Promise<void> {
  await prisma.lLMCall.update({
    where: { id: input.callId },
    data: {
      status: input.status,
      finishedAt: new Date(),
      latencyMs: input.latencyMs,
      errorType: input.errorType,
      errorMessage: input.errorMessage?.slice(0, 1000), // Truncate errors
    },
  });
}

// =============================================================================
// Tracked Call Wrapper
// =============================================================================

/**
 * High-level wrapper that:
 * - Calls startCall
 * - Executes the provided async function
 * - Calls completeCallSuccess/Failure with results or error
 * - Handles timeout detection
 *
 * @returns The executor's result
 */
export async function trackedCall<T>(
  input: StartCallInput,
  executor: () => Promise<{
    result: T;
    tokensIn: number;
    tokensOut: number;
    costEstimate: number;
    providerModel?: string;
    providerRequestId?: string;
    outputSummary: OutputSummary;
  }>
): Promise<{ result: T; callId: string }> {
  const startTime = Date.now();
  const callId = await startCall(input);

  try {
    const executorResult = await executor();
    const latencyMs = Date.now() - startTime;

    await completeCallSuccess({
      callId,
      tokensIn: executorResult.tokensIn,
      tokensOut: executorResult.tokensOut,
      costEstimate: executorResult.costEstimate,
      latencyMs,
      providerModel: executorResult.providerModel,
      providerRequestId: executorResult.providerRequestId,
      outputSummary: executorResult.outputSummary,
    });

    return { result: executorResult.result, callId };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Determine if timeout
    const isTimeout =
      error instanceof Error &&
      (error.message.toLowerCase().includes('timeout') ||
        error.name === 'AbortError' ||
        error.name === 'TimeoutError');

    await completeCallFailure({
      callId,
      latencyMs,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      status: isTimeout ? 'TIMEOUT' : 'FAILED',
    });

    throw error;
  }
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Get all LLM calls for a composite run
 */
export async function getCallsForRun(runId: string) {
  return prisma.lLMCall.findMany({
    where: {
      ownerType: 'COMPOSITE_RUN',
      ownerId: runId,
    },
    orderBy: { startedAt: 'asc' },
  });
}

/**
 * Get all LLM calls for a product asset (extraction + placement)
 */
export async function getCallsForProductAsset(productAssetId: string) {
  return prisma.lLMCall.findMany({
    where: {
      ownerType: 'PRODUCT_ASSET',
      ownerId: productAssetId,
    },
    orderBy: { startedAt: 'asc' },
  });
}

/**
 * Get all LLM calls for a test run
 */
export async function getCallsForTestRun(testRunId: string) {
  return prisma.lLMCall.findMany({
    where: {
      ownerType: 'TEST_RUN',
      ownerId: testRunId,
    },
    orderBy: { startedAt: 'asc' },
  });
}

/**
 * Find a cached result by dedupe hash (within TTL)
 */
export async function findCachedByDedupeHash(
  shopId: string,
  dedupeHash: string,
  ttlMs: number = 3600000 // 1 hour default
): Promise<{ callId: string; outputSummary: OutputSummary } | null> {
  const minDate = new Date(Date.now() - ttlMs);

  const cachedCall = await prisma.lLMCall.findFirst({
    where: {
      shopId,
      dedupeHash,
      status: 'SUCCEEDED',
      createdAt: { gte: minDate },
    },
    select: {
      id: true,
      outputSummary: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!cachedCall?.outputSummary) {
    return null;
  }

  return {
    callId: cachedCall.id,
    outputSummary: cachedCall.outputSummary as OutputSummary,
  };
}

/**
 * Sum cost estimates for today's calls (for budget checking)
 */
export async function getDailyCostForShop(shopId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await prisma.lLMCall.aggregate({
    where: {
      shopId,
      startedAt: { gte: today },
      status: 'SUCCEEDED',
    },
    _sum: { costEstimate: true },
  });

  return Number(result._sum.costEstimate ?? 0);
}

