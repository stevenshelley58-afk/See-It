import prisma from "~/db.server";

export interface FlowTrace {
  traceId: string;
  stages: Array<{
    stage: string;
    timestamp: Date;
    data: Record<string, unknown>;
  }>;
  issues: string[];
}

export async function traceDataFlow(traceId: string): Promise<FlowTrace> {
  const trace: FlowTrace = {
    traceId,
    stages: [],
    issues: [],
  };

  // Fetch all events for this trace
  const events = await prisma.monitorEvent.findMany({
    where: { requestId: traceId },
    orderBy: { ts: "asc" },
  });

  // Group by source/type
  for (const event of events) {
    trace.stages.push({
      stage: `${event.source}:${event.type}`,
      timestamp: event.ts,
      data: event.payload as Record<string, unknown>,
    });
  }

  // Fetch LLM calls
  const llmCalls = await prisma.lLMCall.findMany({
    where: {
      callSummary: {
        path: ["traceId"],
        equals: traceId,
      },
    },
  });

  // Verify consistency
  for (const call of llmCalls) {
    const payload = call.debugPayload as any;

    // Check for unreplaced variables in stored prompt
    if (payload?.promptText) {
      const unreplaced = payload.promptText.match(/\{\{[\w.]+\}\}/g);
      if (unreplaced) {
        trace.issues.push(`LLM call ${call.id} has unreplaced variables: ${unreplaced.join(", ")}`);
      }
    }

    // Check hash consistency
    if (payload?.images) {
      for (const img of payload.images) {
        if (img.hash && img.hash.length !== 64) {
          trace.issues.push(`Image ${img.role} in call ${call.id} has invalid hash length: ${img.hash.length}`);
        }
      }
    }
  }

  return trace;
}
