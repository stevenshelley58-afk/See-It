import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { traceDataFlow } from "~/services/telemetry/data-flow-tracer.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { runId } = params;

  if (!runId) {
    return json({ error: "Missing run ID" }, { status: 400 });
  }

  const trace = await traceDataFlow(runId);

  return json({
    traceId: runId,
    stageCount: trace.stages.length,
    issues: trace.issues,
    isValid: trace.issues.length === 0,
  });
};
