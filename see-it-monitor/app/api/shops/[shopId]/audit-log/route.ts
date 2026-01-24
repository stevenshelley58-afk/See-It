// =============================================================================
// Audit Log API Route
// GET: Returns paginated audit log entries
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  jsonError,
  jsonSuccess,
  validateShopId,
  requireShopAccessAndPermission,
} from "@/lib/api-utils";
import type { AuditLogEntry, AuditAction } from "@/lib/types-prompt-control";

// =============================================================================
// Types
// =============================================================================

interface AuditLogResponse {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

// Valid audit actions from the Prisma enum
const VALID_ACTIONS: AuditAction[] = [
  "PROMPT_CREATE",
  "PROMPT_UPDATE_DRAFT",
  "PROMPT_ACTIVATE",
  "PROMPT_ARCHIVE",
  "PROMPT_ROLLBACK",
  "RUNTIME_UPDATE",
  "TEST_RUN",
];

// =============================================================================
// GET /api/shops/[shopId]/audit-log
// Returns paginated audit log entries
// Query params: ?limit=50&cursor=...&action=...&targetType=...
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
): Promise<NextResponse> {
  try {
    const { shopId: rawShopId } = await params;
    const shopId = validateShopId(rawShopId);

    if (!shopId) {
      return jsonError(400, "bad_request", "Invalid or missing shopId");
    }

    // Verify authentication and shop access
    const authResult = requireShopAccessAndPermission(
      request,
      shopId,
      "VIEW_AUDIT_LOG"
    );
    if ("error" in authResult) {
      return authResult.error;
    }

    // Parse query parameters
    const { searchParams } = request.nextUrl;
    const limitParam = searchParams.get("limit");
    const cursor = searchParams.get("cursor");
    const action = searchParams.get("action");
    const targetType = searchParams.get("targetType");

    // Parse and validate limit
    let limit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        return jsonError(400, "validation_error", "limit must be between 1 and 100");
      }
      limit = parsed;
    }

    // Validate action if provided
    if (action && !VALID_ACTIONS.includes(action as AuditAction)) {
      return jsonError(400, "validation_error", `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`);
    }

    // Build where clause
    const where: Record<string, unknown> = {
      shopId,
    };

    if (action) {
      where.action = action;
    }

    if (targetType) {
      where.targetType = targetType;
    }

    // Add cursor condition if provided
    if (cursor) {
      // Cursor is the ID of the last item seen
      // We fetch items created before or at the same time as the cursor item
      const cursorEntry = await prisma.promptAuditLog.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });

      if (cursorEntry) {
        where.OR = [
          { createdAt: { lt: cursorEntry.createdAt } },
          {
            createdAt: cursorEntry.createdAt,
            id: { lt: cursor },
          },
        ];
      }
    }

    // Fetch entries with one extra to determine if there are more
    const entries = await prisma.promptAuditLog.findMany({
      where,
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
    });

    // Determine if there are more results
    let nextCursor: string | null = null;
    if (entries.length > limit) {
      const lastEntry = entries[limit - 1];
      nextCursor = lastEntry.id;
      entries.pop(); // Remove the extra entry
    }

    // Transform entries to response format
    const responseEntries: AuditLogEntry[] = entries.map((entry) => ({
      id: entry.id,
      shopId: entry.shopId,
      actor: entry.actor,
      action: entry.action as AuditAction,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetName: entry.targetName,
      before: entry.before,
      after: entry.after,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      createdAt: entry.createdAt.toISOString(),
    }));

    const response: AuditLogResponse = {
      entries: responseEntries,
      nextCursor,
    };

    return jsonSuccess(response);
  } catch (error) {
    console.error("GET /api/shops/[shopId]/audit-log error:", error);
    return jsonError(500, "internal_error", "Failed to fetch audit log");
  }
}
