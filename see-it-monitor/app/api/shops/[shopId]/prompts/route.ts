// =============================================================================
// GET /api/shops/[shopId]/prompts
// List all prompts for a shop with active/draft versions and metrics
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  jsonSuccess,
  validateShopId,
  requireShopAccessAndPermission,
} from "@/lib/api-utils";
import { resolveShopId } from "@/lib/shop-resolver";
import { listPromptsForShop } from "@/lib/prompt-service";

type RouteContext = {
  params: Promise<{ shopId: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const params = await context.params;
    const validatedId = validateShopId(params.shopId);

    if (!validatedId) {
      return jsonError(400, "bad_request", "Invalid or missing shopId");
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

    const response = await listPromptsForShop(shopId);
    return jsonSuccess(response);
  } catch (error) {
    console.error("[GET /api/shops/[shopId]/prompts] Error:", error);

    if (error instanceof Error) {
      return jsonError(500, "internal_error", error.message);
    }

    return jsonError(500, "internal_error", "An unexpected error occurred");
  }
}
