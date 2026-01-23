/**
 * External Auth Module
 *
 * Authentication, CORS, and rate limiting for the External Operator API.
 * Uses API key auth instead of Shopify OAuth.
 */

import { json } from "@remix-run/node";
import { createHash, timingSafeEqual } from "crypto";
import type { ExternalAuthResult, RateLimitEntry } from "./types";

// =============================================================================
// Configuration
// =============================================================================

const RATE_LIMIT_PER_KEY = 100; // requests per minute per token+IP
const RATE_LIMIT_GLOBAL = 300; // requests per minute global
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds

// In-memory rate limit storage (resets on deploy)
const perKeyLimits = new Map<string, RateLimitEntry>();
const globalLimit: RateLimitEntry = { count: 0, windowStart: Date.now() };

// =============================================================================
// Environment Variables
// =============================================================================

function getEnvVar(name: string): string | undefined {
  return process.env[name];
}

function getRequiredEnvVar(name: string): string {
  const value = getEnvVar(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getAllowedOrigins(): string[] {
  const origins = getEnvVar("MONITOR_ALLOWED_ORIGINS");
  if (!origins) return [];
  return origins.split(",").map((o) => o.trim()).filter(Boolean);
}

// =============================================================================
// CORS Headers
// =============================================================================

function buildCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, X-Monitor-Reveal, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// =============================================================================
// Token Hashing (for rate limit keys)
// =============================================================================

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function hashUserAgent(userAgent: string): string {
  return createHash("sha256").update(userAgent).digest("hex").slice(0, 8);
}

// =============================================================================
// Constant-time Token Comparison
// =============================================================================

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to prevent timing differences
    const dummy = Buffer.alloc(a.length, "x");
    timingSafeEqual(dummy, dummy);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// =============================================================================
// Client IP Extraction
// =============================================================================

export function getClientIp(request: Request): string {
  // X-Forwarded-For: first IP (trimmed)
  const forwardedFor = request.headers.get("X-Forwarded-For");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  // X-Real-IP
  const realIp = request.headers.get("X-Real-IP");
  if (realIp) return realIp.trim();

  return "unknown";
}

// =============================================================================
// Rate Limiting
// =============================================================================

function cleanExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of perKeyLimits) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      perKeyLimits.delete(key);
    }
  }
}

function checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();

  // Clean expired entries periodically (every 100 checks)
  if (Math.random() < 0.01) {
    cleanExpiredEntries();
  }

  // Check global limit
  if (now - globalLimit.windowStart > RATE_LIMIT_WINDOW_MS) {
    globalLimit.count = 0;
    globalLimit.windowStart = now;
  }

  if (globalLimit.count >= RATE_LIMIT_GLOBAL) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - globalLimit.windowStart);
    return { allowed: false, retryAfterMs };
  }

  // Check per-key limit
  let entry = perKeyLimits.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    perKeyLimits.set(key, entry);
  }

  if (entry.count >= RATE_LIMIT_PER_KEY) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  // Increment counters
  entry.count++;
  globalLimit.count++;

  return { allowed: true, retryAfterMs: 0 };
}

export function rateLimitOrThrow(
  tokenHash: string,
  clientIp: string,
  userAgent: string,
  corsHeaders: Record<string, string> = {}
): void {
  // Build rate limit key
  let key = `${tokenHash}:${clientIp}`;
  if (clientIp === "unknown") {
    key = `${tokenHash}:unknown:${hashUserAgent(userAgent || "no-ua")}`;
  }

  const { allowed, retryAfterMs } = checkRateLimit(key);

  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    throw json(
      { error: "rate_limited", message: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Retry-After": String(retryAfterSeconds),
        },
      }
    );
  }
}

// =============================================================================
// CORS Origin Check
// =============================================================================

export function checkCorsOrigin(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");

  // No origin (curl, etc.) - allow without CORS headers
  if (!origin) {
    return {};
  }

  const allowedOrigins = getAllowedOrigins();

  // Check if origin is allowed
  if (!allowedOrigins.includes(origin)) {
    throw json(
      { error: "forbidden", message: "Origin not allowed" },
      { status: 403 }
    );
  }

  return buildCorsHeaders(origin);
}

// =============================================================================
// OPTIONS Handler (Preflight)
// =============================================================================

export function handleOptions(request: Request): Response {
  const origin = request.headers.get("Origin");

  // No origin (curl, etc.) - just return 204
  if (!origin) {
    return new Response(null, { status: 204 });
  }

  const allowedOrigins = getAllowedOrigins();

  // Origin not allowed - return 403
  if (!allowedOrigins.includes(origin)) {
    return new Response(
      JSON.stringify({ error: "forbidden", message: "Origin not allowed" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Origin allowed - return 204 with CORS headers
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

// =============================================================================
// Main Auth Function
// =============================================================================

export async function requireExternalAuth(request: Request): Promise<ExternalAuthResult> {
  // Check CORS first
  const corsHeaders = checkCorsOrigin(request);

  // Check Authorization header
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw json(
      { error: "unauthorized", message: "Missing or invalid authorization" },
      { status: 401, headers: corsHeaders }
    );
  }

  const token = authHeader.slice(7); // Remove "Bearer "
  const expectedToken = getRequiredEnvVar("MONITOR_API_TOKEN");

  // Constant-time comparison
  if (!constantTimeCompare(token, expectedToken)) {
    throw json(
      { error: "unauthorized", message: "Missing or invalid authorization" },
      { status: 401, headers: corsHeaders }
    );
  }

  const tokenHash = hashToken(token);
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get("User-Agent") || "";

  // Rate limit check
  rateLimitOrThrow(tokenHash, clientIp, userAgent, corsHeaders);

  // Check reveal token (only after Bearer is valid)
  let revealEnabled = false;
  const revealHeader = request.headers.get("X-Monitor-Reveal");
  const revealToken = getEnvVar("MONITOR_REVEAL_TOKEN");

  if (revealHeader && revealToken) {
    // Silently ignore invalid reveal token (still redacted)
    if (constantTimeCompare(revealHeader, revealToken)) {
      revealEnabled = true;
    }
  }

  return {
    revealEnabled,
    corsHeaders,
    tokenHash,
    clientIp,
  };
}

// =============================================================================
// Response Helpers
// =============================================================================

export function jsonError(
  error: string,
  status: number,
  message: string,
  details?: Record<string, unknown>,
  corsHeaders: Record<string, string> = {}
): Response {
  const body: { error: string; message: string; details?: Record<string, unknown> } = {
    error,
    message,
  };
  if (details) {
    body.details = details;
  }

  return json(body, {
    status,
    headers: corsHeaders,
  });
}

export function jsonWithCors<T>(
  data: T,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return json(data, {
    status,
    headers: corsHeaders,
  });
}

// Re-export types
export type { ExternalAuthResult, ApiError } from "./types";
