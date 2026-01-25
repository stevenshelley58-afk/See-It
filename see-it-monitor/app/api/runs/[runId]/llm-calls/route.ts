// =============================================================================
// GET /api/runs/[runId]/llm-calls
// Fetches all LLM calls for a specific render run
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  jsonError,
  jsonSuccess,
  requireAuth,
  getAuthSession,
} from "@/lib/api-utils";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

/**
 * GET /api/runs/[runId]/llm-calls
 * Fetches all LLM calls for a specific render run
 *
 * Note: This route verifies the authenticated user has access to the
 * shop that owns the render run, rather than having the shopId in the URL.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { runId } = await context.params;
  const reveal = request.nextUrl.searchParams.get("_reveal") === "true";

  if (!runId) {
    return jsonError(400, "bad_request", "Run ID is required");
  }

  // Verify authentication
  const authResult = requireAuth(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  const { session } = authResult;

  try {
    // First, find the run's shopId.
    // The canonical schema does NOT store a renderRunId column on LLMCall.
    // Instead, the run is referenced via (ownerType, ownerId).
    const firstCall = await prisma.lLMCall.findFirst({
      where: { ownerType: "COMPOSITE_RUN", ownerId: runId },
      select: { shopId: true },
    });

    if (!firstCall) {
      return jsonError(404, "not_found", "Render run not found or has no LLM calls");
    }

    // Verify the user has access to this shop
    if (!session.hasFullAccess && !session.allowedShops.includes(firstCall.shopId)) {
      return jsonError(403, "forbidden", "Access denied to this render run");
    }

    // Fetch all LLM calls for this run
    const llmCalls = await prisma.lLMCall.findMany({
      where: {
        ownerType: "COMPOSITE_RUN",
        ownerId: runId,
      },
      orderBy: {
        startedAt: "asc",
      },
      select: {
        id: true,
        promptKey: true,
        promptVersionId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        latencyMs: true,
        tokensIn: true,
        tokensOut: true,
        costEstimate: true,
        errorType: true,
        errorMessage: true,
        providerRequestId: true,
        providerModel: true,
        callIdentityHash: true,
        dedupeHash: true,
        callSummary: true,
        debugPayload: reveal, // sensitive; only return when explicitly revealed
        outputSummary: true,
      },
    });

    // Map canonical DB fields to the monitor API contract in lib/types.ts
    const serializedCalls = llmCalls.map((call) => {
      const callSummary = (call.callSummary ?? {}) as Record<string, unknown>;
      const outputSummary = (call.outputSummary ?? {}) as Record<string, unknown>;

      const promptName =
        (typeof callSummary.promptName === "string" && callSummary.promptName) ||
        call.promptKey;

      const model =
        (typeof callSummary.model === "string" && callSummary.model) ||
        call.providerModel ||
        "unknown";

      const imageCount =
        typeof callSummary.imageCount === "number" ? callSummary.imageCount : undefined;
      const preview =
        typeof callSummary.promptPreview === "string"
          ? callSummary.promptPreview
          : undefined;

      const outputPreview =
        typeof outputSummary.preview === "string" ? outputSummary.preview : undefined;

      return {
        id: call.id,
        promptName,
        promptVersionId: call.promptVersionId ?? null,
        model,
        status: call.status as any,
        startedAt: call.startedAt.toISOString(),
        finishedAt: call.finishedAt ? call.finishedAt.toISOString() : null,
        latencyMs: call.latencyMs ?? null,
        tokensIn: call.tokensIn ?? null,
        tokensOut: call.tokensOut ?? null,
        costEstimate: call.costEstimate ? Number(call.costEstimate) : null,
        errorType: call.errorType ?? null,
        errorMessage: call.errorMessage ?? null,
        retryCount: 0,
        providerRequestId: call.providerRequestId ?? null,
        providerModel: call.providerModel ?? null,
        resolutionHash: call.callIdentityHash,
        requestHash: call.dedupeHash ?? call.callIdentityHash,
        inputRef: {
          imageCount,
          preview,
          resolutionHash: call.callIdentityHash,
        },
        inputPayload: (call as any).debugPayload ?? null,
        outputRef: outputPreview ? { preview: outputPreview } : null,
      };
    });

    return jsonSuccess({
      llmCalls: serializedCalls,
      count: serializedCalls.length,
    });
  } catch (error) {
    console.error("Failed to fetch LLM calls:", error);
    return jsonError(500, "database_error", "Failed to fetch LLM calls");
  }
}
