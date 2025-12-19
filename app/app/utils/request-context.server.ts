/**
 * Request context utilities for propagating requestId through Remix loaders/actions
 */

import { generateRequestId } from "./logger.server";

/**
 * Get or create request ID from headers, or generate a new one
 * Checks for X-Request-ID header first, then generates if missing
 */
export function getRequestId(request: Request): string {
  const existingId = request.headers.get("X-Request-ID");
  if (existingId) {
    return existingId;
  }
  return generateRequestId();
}

/**
 * Create a response with request ID header
 */
export function addRequestIdHeader(response: Response, requestId: string): Response {
  response.headers.set("X-Request-ID", requestId);
  return response;
}





