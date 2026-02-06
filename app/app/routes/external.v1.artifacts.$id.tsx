/**
 * GET /external/v1/artifacts/:id
 *
 * External API: Get a single artifact by ID.
 *
 * Notes:
 * - Sensitive artifacts are hidden unless reveal is enabled.
 * - Optional shopId query param can be provided for extra scoping.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";
import {
  requireExternalAuth,
  handleOptions,
  jsonError,
  jsonWithCors,
} from "~/services/external-auth";
import { getArtifactExternal } from "~/services/monitor/queries.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Handle OPTIONS preflight
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  try {
    const { revealEnabled, corsHeaders } = await requireExternalAuth(request);

    const artifactId = params.id;
    if (!artifactId) {
      return jsonError(
        "bad_request",
        400,
        "Missing artifact ID",
        undefined,
        corsHeaders
      );
    }

    const shopId = new URL(request.url).searchParams.get("shopId") || undefined;

    const artifact = await getArtifactExternal(artifactId, shopId, revealEnabled);

    if (!artifact) {
      return jsonError(
        "not_found",
        404,
        "Artifact not found",
        undefined,
        corsHeaders
      );
    }

    return jsonWithCors(artifact, 200, corsHeaders);
  } catch (error) {
    // If error is already a Response (from auth), re-throw
    if (error instanceof Response) {
      throw error;
    }

    console.error("[external.v1.artifacts.$id] Error:", error);
    return jsonError("internal_error", 500, "An unexpected error occurred");
  }
};

