// =============================================================================
// Next.js Middleware - Authentication
// =============================================================================
//
// This middleware runs on all /api/* routes and verifies authentication.
// It attaches the authenticated session to the request headers for use by
// route handlers.
//
// =============================================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Routes that are public (no auth required)
 *
 * Note: Everything else under /api/* is treated as protected so that:
 * - internal APIs (e.g. /api/shops/*, /api/runs/*) are consistent
 * - the /api/external/* proxy isn't accidentally publicly callable in production
 */

/**
 * Routes that are public (no auth required)
 */
const PUBLIC_PATHS = ["/api/health", "/api/auth"];

/**
 * Header key for passing session to route handlers
 */
const AUTH_SESSION_HEADER = "x-auth-session";

// =============================================================================
// Middleware
// =============================================================================

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for non-API routes
  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // All other /api/* routes require auth

  // Get auth configuration
  const jwtSecret = process.env.JWT_SECRET || process.env.MONITOR_API_TOKEN;
  const monitorApiToken = process.env.MONITOR_API_TOKEN;

  if (!jwtSecret && !monitorApiToken) {
    console.error("[Middleware] No JWT_SECRET or MONITOR_API_TOKEN configured");
    return new NextResponse(
      JSON.stringify({
        error: "unauthorized",
        message: "Authentication not configured",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Get Authorization header
  const authHeader = request.headers.get("Authorization");

  // Implicit auth fallback: if no Authorization header, check if implicit auth is enabled
  if (!authHeader) {
    // Check if implicit dashboard auth is allowed
    const allowImplicitAuth =
      process.env.NODE_ENV !== "production" ||
      process.env.MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH === "true";

    if (allowImplicitAuth && monitorApiToken) {
      // Create admin session using MONITOR_API_TOKEN (same as ApiKey branch)
      const session = {
        actor: "dashboard@see-it.app",
        actorName: "Dashboard User",
        role: "admin" as const,
        allowedShops: [] as string[],
        hasFullAccess: true,
        token: "implicit",
      };

      const requestHeaders = new Headers(request.headers);
      requestHeaders.set(AUTH_SESSION_HEADER, JSON.stringify(session));

      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }

    // No implicit auth allowed or no token configured
    return new NextResponse(
      JSON.stringify({
        error: "unauthorized",
        message: "Missing Authorization header. Use 'Bearer <token>' or 'ApiKey <key>'",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Handle Bearer token (JWT)
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const result = await verifyBearerToken(token, jwtSecret!);

    if (!result.success) {
      return new NextResponse(
        JSON.stringify({
          error: "unauthorized",
          message: result.error,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Clone request and add session header
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(AUTH_SESSION_HEADER, JSON.stringify(result.session));

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Handle API key
  if (authHeader.startsWith("ApiKey ")) {
    const apiKey = authHeader.slice(7);

    if (!monitorApiToken) {
      return new NextResponse(
        JSON.stringify({
          error: "unauthorized",
          message: "API key authentication not configured",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Constant-time comparison
    if (!timingSafeEqual(apiKey, monitorApiToken)) {
      return new NextResponse(
        JSON.stringify({
          error: "unauthorized",
          message: "Invalid API key",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // API key grants full admin access
    const session = {
      actor: "api-key@see-it.app",
      actorName: "API Key",
      role: "admin" as const,
      allowedShops: [] as string[],
      hasFullAccess: true,
      token: apiKey,
    };

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(AUTH_SESSION_HEADER, JSON.stringify(session));

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Invalid auth header format
  return new NextResponse(
    JSON.stringify({
      error: "unauthorized",
      message: "Invalid Authorization header format. Use 'Bearer <token>' or 'ApiKey <key>'",
    }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

interface AuthSession {
  actor: string;
  actorName: string;
  role: "admin" | "editor" | "viewer";
  allowedShops: string[];
  hasFullAccess: boolean;
  token: string;
}

type VerifyResult =
  | { success: true; session: AuthSession }
  | { success: false; error: string };

async function verifyBearerToken(
  token: string,
  secret: string
): Promise<VerifyResult> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey);

    if (!payload.sub || typeof payload.sub !== "string") {
      return { success: false, error: "Invalid token: missing subject" };
    }

    const role = isValidRole(payload.role) ? payload.role : "viewer";
    const shops = Array.isArray(payload.shops) ? payload.shops : [];

    const session: AuthSession = {
      actor: payload.sub,
      actorName: typeof payload.name === "string" ? payload.name : payload.sub,
      role,
      allowedShops: shops as string[],
      hasFullAccess: role === "admin" && shops.length === 0,
      token,
    };

    return { success: true, session };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("expired")) {
        return { success: false, error: "Token expired" };
      }
      if (error.message.includes("signature")) {
        return { success: false, error: "Invalid token signature" };
      }
    }
    return { success: false, error: "Invalid token" };
  }
}

function isValidRole(role: unknown): role is "admin" | "editor" | "viewer" {
  return role === "admin" || role === "editor" || role === "viewer";
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// =============================================================================
// Middleware Configuration
// =============================================================================

export const config = {
  matcher: [
    // Match all API routes except static files
    "/api/:path*",
  ],
};
