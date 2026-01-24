// =============================================================================
// POST /api/shops/[shopId]/prompts/[name]/versions
// Create a new DRAFT version
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  jsonSuccess,
  validateShopId,
  parseJsonBody,
  requireShopAccessAndPermission,
} from "@/lib/api-utils";
import { createVersion } from "@/lib/prompt-service";
import type { CreateVersionRequest } from "@/lib/types-prompt-control";

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

    // Verify authentication, shop access, and permission to create versions
    const authResult = requireShopAccessAndPermission(
      request,
      shopId,
      "CREATE_VERSION"
    );
    if ("error" in authResult) {
      return authResult.error;
    }

    const { session } = authResult;

    // Decode URL-encoded name
    const decodedName = decodeURIComponent(promptName);

    // Parse request body
    const body = await parseJsonBody<CreateVersionRequest>(request);

    if (!body) {
      return jsonError(400, "bad_request", "Invalid or missing request body");
    }

    // Validate at least one template is provided
    if (!body.systemTemplate && !body.developerTemplate && !body.userTemplate) {
      return jsonError(
        400,
        "validation_error",
        "At least one template (systemTemplate, developerTemplate, or userTemplate) is required"
      );
    }

    // Create the version using actor from authenticated session
    const version = await createVersion(shopId, decodedName, body, session.actor);

    return jsonSuccess(version, 201);
  } catch (error) {
    console.error("[POST /api/shops/[shopId]/prompts/[name]/versions] Error:", error);

    if (error instanceof Error) {
      // Check for specific error messages
      if (error.message.includes("not found")) {
        return jsonError(404, "not_found", error.message);
      }
      return jsonError(500, "internal_error", error.message);
    }

    return jsonError(500, "internal_error", "An unexpected error occurred");
  }
}
