// =============================================================================
// API Utilities for Route Handlers
// =============================================================================

import { NextResponse } from "next/server";

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

/**
 * Validate that a shop exists and belongs to the tenant
 * For now, we just validate the shopId is provided
 */
export function validateShopId(shopId: string | undefined): string | null {
  if (!shopId || typeof shopId !== "string" || shopId.trim() === "") {
    return null;
  }
  return shopId.trim();
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

/**
 * Get the actor (user) from request headers
 * For now, this is a placeholder - in production would use auth
 */
export function getActor(request: Request): string {
  // Try to get from header (set by frontend auth)
  const actor = request.headers.get("X-Actor") || request.headers.get("X-User-Email");

  // Fallback for development
  return actor || "system@see-it.app";
}
