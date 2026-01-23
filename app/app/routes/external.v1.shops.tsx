/**
 * GET /external/v1/shops
 *
 * External API: Paginated list of shops with aggregate stats.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";
import {
  requireExternalAuth,
  handleOptions,
  jsonError,
  jsonWithCors,
} from "~/services/external-auth";
import { getShopsExternal } from "~/services/monitor/queries.server";

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
    const windowDaysParam = url.searchParams.get("windowDays");
    const includeTotal = url.searchParams.get("includeTotal") === "true";

    // Parse and validate limit (max 200, default 50)
    let limit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 200);
      }
    }

    // Parse and validate windowDays (max 30, default 7)
    let windowDays = 7;
    if (windowDaysParam) {
      const parsed = parseInt(windowDaysParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        windowDays = Math.min(parsed, 30);
      }
    }

    const result = await getShopsExternal(cursor, limit, windowDays, includeTotal);

    return jsonWithCors(result, 200, corsHeaders);
  } catch (error) {
    // If error is already a Response (from auth), re-throw
    if (error instanceof Response) {
      throw error;
    }

    console.error("[external.v1.shops] Error:", error);
    return jsonError(
      "internal_error",
      500,
      "An unexpected error occurred"
    );
  }
};
