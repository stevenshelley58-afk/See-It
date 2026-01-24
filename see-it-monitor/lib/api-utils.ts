// =============================================================================
// API Utilities for Route Handlers
// =============================================================================

import { NextResponse } from "next/server";
import type { AuthSession, Permission } from "./auth.types";
import { PERMISSIONS } from "./auth.types";

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Return a JSON error response
 */
export function jsonError(
  status: number,
  error: string,
  message: string,
  details?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    { error, message, ...(details && { details }) },
    { status }
  );
}

/**
 * Return a JSON success response
 */
export function jsonSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate that a shop ID is provided and properly formatted
 */
export function validateShopId(shopId: string | undefined): string | null {
  if (!shopId || typeof shopId !== "string" || shopId.trim() === "") {
    return null;
  }
  return shopId.trim();
}

/**
 * Check if a string looks like a UUID
 */
export function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Parse JSON body safely
 */
export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const body = await request.json();
    return body as T;
  } catch {
    return null;
  }
}

// =============================================================================
// Authentication Helpers
// =============================================================================

/**
 * Header key where middleware stores the authenticated session
 */
const AUTH_SESSION_HEADER = "x-auth-session";

/**
 * Get the authenticated session from request headers
 * Returns null if not authenticated (middleware should prevent this)
 */
export function getAuthSession(request: Request): AuthSession | null {
  const sessionHeader = request.headers.get(AUTH_SESSION_HEADER);

  if (!sessionHeader) {
    return null;
  }

  try {
    return JSON.parse(sessionHeader) as AuthSession;
  } catch {
    console.error("[api-utils] Failed to parse auth session from header");
    return null;
  }
}

/**
 * Get the actor (user email/identifier) from the authenticated session
 * Falls back to headers for backwards compatibility during migration
 */
export function getActor(request: Request): string {
  // First try to get from authenticated session (preferred)
  const session = getAuthSession(request);
  if (session) {
    return session.actor;
  }

  // Fallback: This path should not be reached if middleware is configured correctly
  // Log a warning so we can track any missed routes
  console.warn(
    "[api-utils] getActor called without auth session - route may be missing auth"
  );

  // Return a placeholder that indicates unauthenticated access
  return "unauthenticated@see-it.app";
}

/**
 * Require authentication and return the session
 * Returns an error response if not authenticated
 */
export function requireAuth(
  request: Request
): { session: AuthSession } | { error: NextResponse } {
  const session = getAuthSession(request);

  if (!session) {
    return {
      error: jsonError(
        401,
        "unauthorized",
        "Authentication required"
      ),
    };
  }

  return { session };
}

// =============================================================================
// Shop Access Verification
// =============================================================================

/**
 * Verify the authenticated user has access to the specified shop
 * Returns an error response if access is denied
 */
export function requireShopAccess(
  request: Request,
  shopId: string
): { session: AuthSession } | { error: NextResponse } {
  const authResult = requireAuth(request);

  if ("error" in authResult) {
    return authResult;
  }

  const { session } = authResult;

  // Admins with no shop restrictions have full access
  if (session.hasFullAccess) {
    return { session };
  }

  // Check if shop is in allowed list
  if (session.allowedShops.includes(shopId)) {
    return { session };
  }

  return {
    error: jsonError(
      403,
      "forbidden",
      `Access denied to shop ${shopId}`
    ),
  };
}

// =============================================================================
// Permission Verification
// =============================================================================

/**
 * Check if a session has a specific permission
 */
export function hasPermission(
  session: AuthSession,
  permission: Permission
): boolean {
  const allowedRoles = PERMISSIONS[permission];
  return (allowedRoles as readonly string[]).includes(session.role);
}

/**
 * Require a specific permission
 * Returns an error response if permission is denied
 */
export function requirePermission(
  request: Request,
  permission: Permission
): { session: AuthSession } | { error: NextResponse } {
  const authResult = requireAuth(request);

  if ("error" in authResult) {
    return authResult;
  }

  const { session } = authResult;

  if (!hasPermission(session, permission)) {
    const allowedRoles = PERMISSIONS[permission].join(" or ");
    return {
      error: jsonError(
        403,
        "forbidden",
        `Permission denied: ${permission} requires role ${allowedRoles}`
      ),
    };
  }

  return { session };
}

/**
 * Require both shop access and a specific permission
 * This is the most common pattern for protected endpoints
 */
export function requireShopAccessAndPermission(
  request: Request,
  shopId: string,
  permission: Permission
): { session: AuthSession } | { error: NextResponse } {
  // First verify shop access
  const shopResult = requireShopAccess(request, shopId);
  if ("error" in shopResult) {
    return shopResult;
  }

  // Then verify permission
  const { session } = shopResult;
  if (!hasPermission(session, permission)) {
    const allowedRoles = PERMISSIONS[permission].join(" or ");
    return {
      error: jsonError(
        403,
        "forbidden",
        `Permission denied: ${permission} requires role ${allowedRoles}`
      ),
    };
  }

  return { session };
}

// =============================================================================
// Request Context Helpers
// =============================================================================

/**
 * Get IP address from request headers
 */
export function getIpAddress(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

/**
 * Get user agent from request headers
 */
export function getUserAgent(request: Request): string | null {
  return request.headers.get("user-agent") || null;
}
