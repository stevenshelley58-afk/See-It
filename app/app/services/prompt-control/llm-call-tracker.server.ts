// =============================================================================
// LLM CALL TRACKER SERVICE
// One row per model call with proper instrumentation
// =============================================================================

import { createHash } from "crypto";
import prisma from "~/db.server";
import type { CallStatus, LLMCall } from "@prisma/client";
import type { PromptMessage } from "./prompt-resolver.server";

// =============================================================================
// Types
// =============================================================================

export interface StartLLMCallInput {
  shopId: string;
  renderRunId?: string;
  variantResultId?: string;
  testRunId?: string;
  promptName: string;
  promptVersionId: string | null;
  model: string;
  messages: PromptMessage[];
  params: Record<string, unknown>;
  imageRefs: string[];
  resolutionHash: string; // From resolver
}

export interface CompleteLLMCallInput {
  callId: string;
  status: "SUCCEEDED" | "FAILED" | "TIMEOUT";
  tokensIn?: number;
  tokensOut?: number;
  costEstimate?: number;
  errorType?: string;
  errorMessage?: string;
  providerRequestId?: string;
  providerModel?: string;
  outputPreview?: string;
}

export interface PromptStats {
  totalCalls: number;
  successRate: number;
  latencyP50: number | null;
  latencyP95: number | null;
  avgCost: number | null;
}

// Legacy type aliases for backward compatibility
export type StartCallInput = StartLLMCallInput;
export type CompleteCallInput = CompleteLLMCallInput;

// =============================================================================
// Hashing
// =============================================================================

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/**
 * Compute request hash for deduplication
 * CRITICAL: Sort imageRefs for stable hashing
 *
 * @param promptName - Name of the prompt
 * @param resolutionHash - Hash from prompt resolution
 * @param imageRefs - Array of image references (URIs)
 * @param promptContentHash - Optional hash of the actual prompt content (for variant-specific deduplication)
 */
function computeRequestHash(
  promptName: string,
  resolutionHash: string,
  imageRefs: string[],
  promptContentHash?: string
): string {
  const sortedImageRefs = [...imageRefs].sort();
  return sha256(JSON.stringify({
    promptName,
    resolutionHash,
    imageRefs: sortedImageRefs,
    // Include prompt content hash if provided (for variant-specific deduplication)
    ...(promptContentHash && { promptContentHash })
  }));
}

// =============================================================================
// Start Call
// =============================================================================

/**
 * Create LLMCall row with status STARTED
 * Store inputRef: { messageCount, imageCount, preview (first 500 chars), resolutionHash }
 * Returns the call ID
 */
export async function startLLMCall(input: StartLLMCallInput): Promise<string> {
  // Build input reference (truncated for storage, not full content)
  // preview: first 500 chars of combined message content for debugging
  const allContent = input.messages.map((m) => m.content).join("\n");

  // Compute prompt content hash for variant-specific deduplication
  const promptContentHash = sha256(allContent);

  const requestHash = computeRequestHash(
    input.promptName,
    input.resolutionHash,
    input.imageRefs,
    promptContentHash // Include actual prompt content for per-variant uniqueness
  );
  const inputRef = {
    messageCount: input.messages.length,
    imageCount: input.imageRefs.length,
    preview: allContent.slice(0, 500),
    resolutionHash: input.resolutionHash,
  };

  const call = await prisma.lLMCall.create({
    data: {
      shopId: input.shopId,
      renderRunId: input.renderRunId ?? null,
      variantResultId: input.variantResultId ?? null,
      testRunId: input.testRunId ?? null,
      promptName: input.promptName,
      promptVersionId: input.promptVersionId,
      model: input.model,
      resolutionHash: input.resolutionHash,
      requestHash,
      status: "STARTED",
      startedAt: new Date(),
      inputRef,
    },
  });

  return call.id;
}

// =============================================================================
// Complete Call
// =============================================================================

/**
 * Update LLMCall with:
 * - status (SUCCEEDED, FAILED, or TIMEOUT)
 * - finishedAt, latencyMs (calculated from startedAt)
 * - tokensIn, tokensOut, costEstimate
 * - errorType, errorMessage (if failed)
 * - providerRequestId, providerModel
 * - outputRef: { preview (first 500 chars), length }
 */
export async function completeLLMCall(input: CompleteLLMCallInput): Promise<void> {
  const finishedAt = new Date();

  // Get started time for latency calculation
  const startedCall = await prisma.lLMCall.findUnique({
    where: { id: input.callId },
    select: { startedAt: true },
  });

  const latencyMs = startedCall
    ? finishedAt.getTime() - startedCall.startedAt.getTime()
    : null;

  // Build output reference (truncated)
  // outputRef: { preview (first 500 chars), length }
  const outputRef = input.outputPreview
    ? { preview: input.outputPreview.slice(0, 500), length: input.outputPreview.length }
    : null;

  await prisma.lLMCall.update({
    where: { id: input.callId },
    data: {
      status: input.status as CallStatus,
      finishedAt,
      latencyMs,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      costEstimate: input.costEstimate ?? null,
      errorType: input.errorType ?? null,
      errorMessage: input.errorMessage?.slice(0, 1000) ?? null, // Truncate errors
      providerRequestId: input.providerRequestId ?? null,
      providerModel: input.providerModel ?? null,
      outputRef,
    },
  });
}

// =============================================================================
// Tracked Call Wrapper
// =============================================================================

/**
 * High-level wrapper that:
 * - Calls startLLMCall
 * - Executes the provided async function
 * - Calls completeLLMCall with results or error
 * - Handles timeout detection (check error message for "timeout" or AbortError)
 * Returns the executor's result
 */
export async function trackedLLMCall<T>(
  input: StartLLMCallInput,
  executor: () => Promise<{
    result: T;
    usage?: {
      tokensIn?: number;
      tokensOut?: number;
      cost?: number;
    };
    providerRequestId?: string;
    providerModel?: string;
    outputPreview?: string;
  }>
): Promise<T> {
  const callId = await startLLMCall(input);

  try {
    const { result, usage, providerRequestId, providerModel, outputPreview } = await executor();

    await completeLLMCall({
      callId,
      status: "SUCCEEDED",
      tokensIn: usage?.tokensIn,
      tokensOut: usage?.tokensOut,
      costEstimate: usage?.cost,
      providerRequestId,
      providerModel,
      outputPreview,
    });

    return result;
  } catch (error) {
    // Determine if timeout (check error message for "timeout" or AbortError)
    const isTimeout =
      error instanceof Error &&
      (error.message.toLowerCase().includes("timeout") ||
        error.name === "AbortError" ||
        error.name === "TimeoutError");

    await completeLLMCall({
      callId,
      status: isTimeout ? "TIMEOUT" : "FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

// =============================================================================
// Request Hash (exported for cache lookups)
// =============================================================================

/**
 * Compute request hash for deduplication (exported for external use)
 * CRITICAL: Sort imageRefs for stable hashing
 *
 * @param promptName - Name of the prompt
 * @param resolutionHash - Hash from prompt resolution
 * @param imageRefs - Array of image references (URIs)
 * @param promptContentHash - Optional hash of actual prompt content (for variant-specific deduplication)
 */
export function getRequestHash(
  promptName: string,
  resolutionHash: string,
  imageRefs: string[],
  promptContentHash?: string
): string {
  return computeRequestHash(promptName, resolutionHash, imageRefs, promptContentHash);
}

// =============================================================================
// Cache Lookup for Deduplication
// =============================================================================

/**
 * Default cache TTL: 1 hour
 * Cached results older than this will not be returned
 */
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface CachedRenderResult {
  outputImageKey: string;
  outputImageHash: string | null;
  originalCallId: string;
  cachedAt: Date;
}

/**
 * Find a cached successful render result by request hash
 * Returns the output image key if found within TTL, null otherwise
 *
 * @param shopId - Shop ID for scoping
 * @param requestHash - Hash computed from promptName + resolutionHash + imageRefs
 * @param ttlMs - Cache TTL in milliseconds (default: 1 hour)
 */
export async function findCachedRender(
  shopId: string,
  requestHash: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS
): Promise<CachedRenderResult | null> {
  const minDate = new Date(Date.now() - ttlMs);

  // Query for a successful LLM call with matching request hash
  // The outputImageKey is stored in outputRef after successful upload
  const cachedCall = await prisma.lLMCall.findFirst({
    where: {
      shopId,
      requestHash,
      status: "SUCCEEDED",
      createdAt: { gte: minDate },
    },
    select: {
      id: true,
      createdAt: true,
      outputRef: true,
    },
    orderBy: { createdAt: "desc" }, // Most recent first
  });

  if (!cachedCall?.outputRef) {
    return null;
  }

  // Extract outputImageKey from outputRef JSON
  const outputRef = cachedCall.outputRef as { outputImageKey?: string; outputImageHash?: string } | null;
  if (!outputRef?.outputImageKey) {
    return null;
  }

  return {
    outputImageKey: outputRef.outputImageKey,
    outputImageHash: outputRef.outputImageHash ?? null,
    originalCallId: cachedCall.id,
    cachedAt: cachedCall.createdAt,
  };
}

/**
 * Record a cache hit - creates a minimal LLM call record indicating the result was served from cache
 * This ensures we have visibility into cache utilization and cost savings
 */
export async function recordCacheHit(input: {
  shopId: string;
  renderRunId?: string;
  variantResultId?: string;
  promptName: string;
  promptVersionId: string | null;
  model: string;
  resolutionHash: string;
  requestHash: string;
  originalCallId: string;
}): Promise<string> {
  const call = await prisma.lLMCall.create({
    data: {
      shopId: input.shopId,
      renderRunId: input.renderRunId ?? null,
      variantResultId: input.variantResultId ?? null,
      promptName: input.promptName,
      promptVersionId: input.promptVersionId,
      model: input.model,
      resolutionHash: input.resolutionHash,
      requestHash: input.requestHash,
      status: "SUCCEEDED",
      startedAt: new Date(),
      finishedAt: new Date(),
      latencyMs: 0, // Cache hit = 0 latency
      tokensIn: 0,  // No tokens used
      tokensOut: 0,
      costEstimate: 0, // No cost
      inputRef: {
        cacheHit: true,
        originalCallId: input.originalCallId,
      },
      outputRef: {
        cacheHit: true,
        originalCallId: input.originalCallId,
      },
    },
  });

  return call.id;
}

/**
 * Update an LLMCall with the output image key after upload
 * This enables future cache lookups to retrieve the rendered image
 */
export async function updateLLMCallWithOutput(
  callId: string,
  outputImageKey: string,
  variantResultId?: string,
  extraOutputRef?: Record<string, unknown>
): Promise<void> {
  // Merge into existing outputRef so we don't erase preview/metadata
  const existing = await prisma.lLMCall.findUnique({
    where: { id: callId },
    select: { outputRef: true },
  });

  const mergedOutputRef = {
    ...(typeof existing?.outputRef === "object" && existing.outputRef ? (existing.outputRef as Record<string, unknown>) : {}),
    ...(extraOutputRef ?? {}),
    outputImageKey, // Store directly for easy cache retrieval
  };

  await prisma.lLMCall.update({
    where: { id: callId },
    data: {
      variantResultId: variantResultId ?? undefined,
      outputRef: {
        ...mergedOutputRef,
      },
    },
  });
}

/**
 * Find the most recent LLMCall for a renderRun (for linking to variant results)
 */
export async function findRecentCallForRun(
  renderRunId: string,
  requestHash: string
): Promise<string | null> {
  const call = await prisma.lLMCall.findFirst({
    where: {
      renderRunId,
      requestHash,
      status: "SUCCEEDED",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return call?.id ?? null;
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Get all LLM calls for a render run
 */
export async function getCallsForRun(renderRunId: string): Promise<LLMCall[]> {
  return prisma.lLMCall.findMany({
    where: { renderRunId },
    orderBy: { startedAt: "asc" },
  });
}

/**
 * Get all LLM calls for a test run
 */
export async function getCallsForTestRun(testRunId: string): Promise<LLMCall[]> {
  return prisma.lLMCall.findMany({
    where: { testRunId },
    orderBy: { startedAt: "asc" },
  });
}

/**
 * Calculate stats: totalCalls, successRate, latencyP50, latencyP95, avgCost
 * Use SQL aggregation for efficiency
 */
export async function getPromptCallStats(
  shopId: string,
  promptName: string,
  since: Date
): Promise<PromptStats> {
  // Use SQL aggregation for efficiency
  const [countResult, latencyResult, costResult] = await Promise.all([
    // Count stats
    prisma.lLMCall.groupBy({
      by: ["status"],
      where: {
        shopId,
        promptName,
        startedAt: { gte: since },
      },
      _count: { id: true },
    }),
    // Get all latencies for percentile calculation
    prisma.lLMCall.findMany({
      where: {
        shopId,
        promptName,
        startedAt: { gte: since },
        latencyMs: { not: null },
      },
      select: { latencyMs: true },
      orderBy: { latencyMs: "asc" },
    }),
    // Cost aggregation
    prisma.lLMCall.aggregate({
      where: {
        shopId,
        promptName,
        startedAt: { gte: since },
        status: "SUCCEEDED",
        costEstimate: { not: null },
      },
      _avg: { costEstimate: true },
    }),
  ]);

  // Calculate totals from grouped counts
  let totalCalls = 0;
  let succeeded = 0;
  for (const group of countResult) {
    const count = group._count.id;
    totalCalls += count;
    if (group.status === "SUCCEEDED") {
      succeeded = count;
    }
  }

  // Calculate percentiles from sorted latencies
  const latencies = latencyResult
    .map((r) => r.latencyMs)
    .filter((l): l is number => l !== null);

  const latencyP50 =
    latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : null;
  const latencyP95 =
    latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : null;

  return {
    totalCalls,
    successRate: totalCalls > 0 ? (succeeded / totalCalls) * 100 : 0,
    latencyP50,
    latencyP95,
    avgCost: costResult._avg.costEstimate
      ? Number(costResult._avg.costEstimate)
      : null,
  };
}

/**
 * Sum costEstimate for today's calls
 * Used for budget checking
 */
export async function getDailyCostForShop(shopId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await prisma.lLMCall.aggregate({
    where: {
      shopId,
      startedAt: { gte: today },
      status: "SUCCEEDED",
    },
    _sum: { costEstimate: true },
  });

  return Number(result._sum.costEstimate ?? 0);
}
