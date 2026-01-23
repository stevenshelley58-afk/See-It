/**
 * GET /external/v1/runs/:id/events
 *
 * External API: Get events for a run.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";
import {
  requireExternalAuth,
  handleOptions,
  jsonError,
  jsonWithCors,
} from "~/services/external-auth";
import { getRunEventsExternal } from "~/services/monitor/queries.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Handle OPTIONS preflight
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  try {
    const { revealEnabled, corsHeaders } = await requireExternalAuth(request);

    const runId = params.id;
    if (!runId) {
      return jsonError("bad_request", 400, "Missing run ID", undefined, corsHeaders);
    }

    const result = await getRunEventsExternal(runId, revealEnabled);

    return jsonWithCors(result, 200, corsHeaders);
  } catch (error) {
    // If error is already a Response (from auth), re-throw
    if (error instanceof Response) {
      throw error;
    }

    console.error("[external.v1.runs.$id.events] Error:", error);
    return jsonError(
      "internal_error",
      500,
      "An unexpected error occurred"
    );
  }
};
