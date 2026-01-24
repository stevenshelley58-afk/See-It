// =============================================================================
// POST /api/shops/[shopId]/prompts/[name]/activate
// Activate a version (archives current active)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  jsonSuccess,
  validateShopId,
  parseJsonBody,
  getActor,
} from "@/lib/api-utils";
import { activateVersion } from "@/lib/prompt-service";
import type { ActivateVersionRequest } from "@/lib/types-prompt-control";

type RouteContext = {
  params: Promise<{ shopId: string; name: string }>;
};

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const params = await context.params;
    const shopId = validateShopId(params.shopId);
    const promptName = params.name;

    if (!shopId) {
      return jsonError(400, "bad_request", "Invalid or missing shopId");
    }

    if (!promptName || typeof promptName !== "string") {
      return jsonError(400, "bad_request", "Invalid or missing prompt name");
    }

    // Decode URL-encoded name
    const decodedName = decodeURIComponent(promptName);

    // Parse request body
    const body = await parseJsonBody<ActivateVersionRequest>(request);

    if (!body) {
      return jsonError(400, "bad_request", "Invalid or missing request body");
    }

    // Validate versionId is provided
    if (!body.versionId || typeof body.versionId !== "string") {
      return jsonError(400, "validation_error", "versionId is required");
    }

    // Get actor from request
    const activatedBy = getActor(request);

    // Activate the version
    const result = await activateVersion(shopId, decodedName, body.versionId, activatedBy);

    return jsonSuccess(result);
  } catch (error) {
    console.error("[POST /api/shops/[shopId]/prompts/[name]/activate] Error:", error);

    if (error instanceof Error) {
      // Check for specific error messages
      if (error.message.includes("not found")) {
        return jsonError(404, "not_found", error.message);
      }
      if (error.message.includes("does not belong")) {
        return jsonError(400, "validation_error", error.message);
      }
      return jsonError(500, "internal_error", error.message);
    }

    return jsonError(500, "internal_error", "An unexpected error occurred");
  }
}
