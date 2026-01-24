// =============================================================================
// POST /api/shops/[shopId]/prompts/[name]/test
// Run a test call without affecting production
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  jsonSuccess,
  validateShopId,
  parseJsonBody,
  getActor,
} from "@/lib/api-utils";
import { testPrompt } from "@/lib/prompt-service";
import type { TestPromptRequest } from "@/lib/types-prompt-control";

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

    // Parse request body (optional - test can run with defaults)
    const body = await parseJsonBody<TestPromptRequest>(request);

    // Get actor from request
    const testedBy = getActor(request);

    // Run the test
    const result = await testPrompt(
      shopId,
      decodedName,
      {
        variables: body?.variables,
        imageRefs: body?.imageRefs,
        overrides: body?.overrides,
        versionId: body?.versionId,
      },
      testedBy
    );

    return jsonSuccess(result);
  } catch (error) {
    console.error("[POST /api/shops/[shopId]/prompts/[name]/test] Error:", error);

    if (error instanceof Error) {
      // Check for specific error messages
      if (error.message.includes("not found")) {
        return jsonError(404, "not_found", error.message);
      }
      if (error.message.includes("disabled")) {
        return jsonError(403, "forbidden", error.message);
      }
      if (error.message.includes("No templates")) {
        return jsonError(400, "validation_error", error.message);
      }
      return jsonError(500, "internal_error", error.message);
    }

    return jsonError(500, "internal_error", "An unexpected error occurred");
  }
}
