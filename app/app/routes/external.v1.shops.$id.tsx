/**
 * GET /external/v1/shops/:id
 *
 * External API: Get shop detail by ID.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";
import {
  requireExternalAuth,
  handleOptions,
  jsonError,
  jsonWithCors,
} from "~/services/external-auth";
import { getShopDetailExternal } from "~/services/monitor/queries.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Handle OPTIONS preflight
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  try {
    const { corsHeaders } = await requireExternalAuth(request);

    const shopId = params.id;
    if (!shopId) {
      return jsonError("bad_request", 400, "Missing shop ID", undefined, corsHeaders);
    }

    const url = new URL(request.url);
    const recentRunsLimitParam = url.searchParams.get("recentRunsLimit");

    // Parse and validate recentRunsLimit (max 20, default 10)
    let recentRunsLimit = 10;
    if (recentRunsLimitParam) {
      const parsed = parseInt(recentRunsLimitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        recentRunsLimit = Math.min(parsed, 20);
      }
    }

    const result = await getShopDetailExternal(shopId, recentRunsLimit);

    if (!result) {
      return jsonError("not_found", 404, "Shop not found", undefined, corsHeaders);
    }

    return jsonWithCors(result, 200, corsHeaders);
  } catch (error) {
    // If error is already a Response (from auth), re-throw
    if (error instanceof Response) {
      throw error;
    }

    console.error("[external.v1.shops.$id] Error:", error);
    return jsonError(
      "internal_error",
      500,
      "An unexpected error occurred"
    );
  }
};
