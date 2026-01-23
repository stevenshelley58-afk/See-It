/**
 * GET /external/v1/health
 *
 * External API: Global health statistics.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";
import {
  requireExternalAuth,
  handleOptions,
  jsonError,
  jsonWithCors,
} from "~/services/external-auth";
import { getHealthStatsExternal } from "~/services/monitor/queries.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Handle OPTIONS preflight
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  try {
    const { corsHeaders } = await requireExternalAuth(request);

    const result = await getHealthStatsExternal();

    return jsonWithCors(result, 200, corsHeaders);
  } catch (error) {
    // If error is already a Response (from auth), re-throw
    if (error instanceof Response) {
      throw error;
    }

    console.error("[external.v1.health] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return jsonError(
      "internal_error",
      500,
      errorMessage
    );
  }
};
