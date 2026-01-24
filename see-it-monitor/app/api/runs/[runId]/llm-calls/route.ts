import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type RouteContext = {
  params: Promise<{ runId: string }>;
};

/**
 * GET /api/runs/[runId]/llm-calls
 * Fetches all LLM calls for a specific render run
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { runId } = await context.params;

  if (!runId) {
    return NextResponse.json(
      { error: "bad_request", message: "Run ID is required" },
      { status: 400 }
    );
  }

  try {
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
        outputRef: true,
      },
    });

    // Convert Decimal to number for JSON serialization
    const serializedCalls = llmCalls.map((call) => ({
      ...call,
      costEstimate: call.costEstimate ? Number(call.costEstimate) : null,
      startedAt: call.startedAt.toISOString(),
      finishedAt: call.finishedAt ? call.finishedAt.toISOString() : null,
    }));

    return NextResponse.json({
      llmCalls: serializedCalls,
      count: serializedCalls.length,
    });
  } catch (error) {
    console.error("Failed to fetch LLM calls:", error);
    return NextResponse.json(
      { error: "database_error", message: "Failed to fetch LLM calls" },
      { status: 500 }
    );
  }
}
