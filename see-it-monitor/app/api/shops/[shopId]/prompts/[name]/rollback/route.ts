// =============================================================================
// POST /api/shops/[shopId]/prompts/[name]/rollback
// Rollback to most recent archived version
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonSuccess, validateShopId, getActor } from "@/lib/api-utils";
import { rollbackToPreviousVersion } from "@/lib/prompt-service";

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

    // Get actor from request
    const rolledBackBy = getActor(request);

    // Perform rollback
    const result = await rollbackToPreviousVersion(shopId, decodedName, rolledBackBy);

    return jsonSuccess(result);
  } catch (error) {
    console.error("[POST /api/shops/[shopId]/prompts/[name]/rollback] Error:", error);

    if (error instanceof Error) {
      // Check for specific error messages
      if (error.message.includes("not found")) {
        return jsonError(404, "not_found", error.message);
      }
      if (error.message.includes("No active version")) {
        return jsonError(400, "validation_error", error.message);
      }
      if (error.message.includes("No previous version")) {
        return jsonError(400, "validation_error", error.message);
      }
      return jsonError(500, "internal_error", error.message);
    }

    return jsonError(500, "internal_error", "An unexpected error occurred");
  }
}
