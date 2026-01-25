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
    // First, find the render run and get its shopId
    // Note: RenderRun model is in the main app schema, we need to access it
    // For now, we get the shopId from the first LLM call
    const firstCall = await prisma.lLMCall.findFirst({
      where: { renderRunId: runId },
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
        renderRunId: runId,
      },
      orderBy: {
        startedAt: "asc",
      },
      select: {
        id: true,
        promptName: true,
        promptVersionId: true,
        model: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        latencyMs: true,
        tokensIn: true,
        tokensOut: true,
        costEstimate: true,
        errorType: true,
        errorMessage: true,
        retryCount: true,
        providerRequestId: true,
        providerModel: true,
        resolutionHash: true,
        requestHash: true,
        inputRef: true,
        inputPayload: reveal, // sensitive; only return when explicitly revealed
        outputRef: true,
      },
    });

    // Convert Decimal to number for JSON serialization
    const serializedCalls = llmCalls.map((call) => ({
      ...call,
      costEstimate: call.costEstimate ? Number(call.costEstimate) : null,
      startedAt: call.startedAt.toISOString(),
      finishedAt: call.finishedAt ? call.finishedAt.toISOString() : null,
      // Prisma omits fields not selected; normalize to null for API clients
      inputPayload: (call as any).inputPayload ?? null,
    }));

    return jsonSuccess({
      llmCalls: serializedCalls,
      count: serializedCalls.length,
    });
  } catch (error) {
    console.error("Failed to fetch LLM calls:", error);
    return jsonError(500, "database_error", "Failed to fetch LLM calls");
  }
}
