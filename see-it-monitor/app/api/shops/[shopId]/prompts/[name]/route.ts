// =============================================================================
// GET /api/shops/[shopId]/prompts/[name]
// Get prompt detail with all versions
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  jsonSuccess,
  validateShopId,
  requireShopAccessAndPermission,
} from "@/lib/api-utils";
import { getPromptDetail } from "@/lib/prompt-service";
import { resolveShopId } from "@/lib/shop-resolver";

type RouteContext = {
  params: Promise<{ shopId: string; name: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const params = await context.params;
    const validatedId = validateShopId(params.shopId);
    const promptName = params.name;

    if (!validatedId) {
      return jsonError(400, "bad_request", "Invalid or missing shopId");
    }

    if (!promptName || typeof promptName !== "string") {
      return jsonError(400, "bad_request", "Invalid or missing prompt name");
    }

    // Resolve shop ID (supports UUID, domain name, or "SYSTEM")
    const shopId = await resolveShopId(validatedId);
    if (!shopId) {
      return jsonError(404, "not_found", `Shop not found: ${validatedId}`);
    }

    // Verify authentication and shop access
    const authResult = requireShopAccessAndPermission(
      request,
      shopId,
      "VIEW_PROMPTS"
    );
    if ("error" in authResult) {
      return authResult.error;
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
