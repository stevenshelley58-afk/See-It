/**
 * GET /external/v1/runs
 *
 * External API: Paginated list of runs with cursor-based pagination.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";
import {
  requireExternalAuth,
  handleOptions,
  jsonError,
  jsonWithCors,
} from "~/services/external-auth";
import { getRunsExternal } from "~/services/monitor/queries.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Handle OPTIONS preflight
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  try {
    const { corsHeaders } = await requireExternalAuth(request);

    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const limitParam = url.searchParams.get("limit");
    const status = url.searchParams.get("status") || undefined;
    const shopId = url.searchParams.get("shopId") || undefined;
    const includeTotal = url.searchParams.get("includeTotal") === "true";

    // Parse and validate limit
    let limit = 20;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 100); // Max 100
      }
    }

    const result = await getRunsExternal(
      { status, shopId },
      cursor,
      limit,
      includeTotal
    );

    return jsonWithCors(result, 200, corsHeaders);
  } catch (error) {
    // If error is already a Response (from auth), re-throw
    if (error instanceof Response) {
      throw error;
    }

    console.error("[external.v1.runs] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return jsonError(
      "internal_error",
      500,
      errorMessage
    );
  }
};
