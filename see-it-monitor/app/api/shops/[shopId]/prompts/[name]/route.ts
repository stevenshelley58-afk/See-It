// =============================================================================
// GET /api/shops/[shopId]/prompts/[name]
// Get prompt detail with all versions
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonSuccess, validateShopId } from "@/lib/api-utils";
import { getPromptDetail } from "@/lib/prompt-service";

type RouteContext = {
  params: Promise<{ shopId: string; name: string }>;
};

export async function GET(
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

    // Decode URL-encoded name (e.g., "global_render" might be encoded)
    const decodedName = decodeURIComponent(promptName);

    const response = await getPromptDetail(shopId, decodedName);

    if (!response) {
      return jsonError(404, "not_found", `Prompt "${decodedName}" not found for shop`);
    }

    return jsonSuccess(response);
  } catch (error) {
    console.error("[GET /api/shops/[shopId]/prompts/[name]] Error:", error);

    if (error instanceof Error) {
      return jsonError(500, "internal_error", error.message);
    }

    return jsonError(500, "internal_error", "An unexpected error occurred");
  }
}
