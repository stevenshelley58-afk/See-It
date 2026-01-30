// =============================================================================
// Authentication Module for See It Monitor
// =============================================================================
//
// This module provides JWT-based authentication for the monitoring API.
// It supports two authentication methods:
// 1. Bearer JWT token (for programmatic access and frontend sessions)
// 2. API key (MONITOR_API_TOKEN) for service-to-service calls
//
// =============================================================================

import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import type {
  AuthTokenPayload,
  AuthSession,
  AuthResult,
  ShopAccessResult,
  Permission,
  PERMISSIONS,
} from "./auth.types";

// =============================================================================
// Configuration
// =============================================================================

const JWT_SECRET = process.env.JWT_SECRET;
const MONITOR_API_TOKEN = process.env.MONITOR_API_TOKEN;

// Token expiration: 24 hours
const TOKEN_EXPIRATION = "24h";

/**
 * Get the secret key for JWT operations
 * Throws if not configured
 */
function getSecretKey(): Uint8Array {
  if (!JWT_SECRET) {
    throw new Error(
      "JWT_SECRET environment variable is required for JWT authentication"
    );
  }
  return new TextEncoder().encode(JWT_SECRET);
}

// =============================================================================
// Token Generation (for admin/testing purposes)
// =============================================================================

/**
 * Generate a new JWT token for a user
 * This is typically called after validating credentials
 */
export async function generateToken(payload: {
  sub: string;
  name?: string;
  shops?: string[];
  role?: "admin" | "editor" | "viewer";
}): Promise<string> {
  const secretKey = getSecretKey();

  const token = await new SignJWT({
    sub: payload.sub,
    name: payload.name || payload.sub,
    shops: payload.shops || [],
    role: payload.role || "viewer",
  } as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRATION)
    .sign(secretKey);

  return token;
}

// =============================================================================
// Token Verification
// =============================================================================

/**
 * Verify a JWT token and extract the payload
 */
async function verifyJWT(token: string): Promise<AuthTokenPayload | null> {
  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey);

    // Validate required fields
    if (!payload.sub || typeof payload.sub !== "string") {
      console.error("[Auth] JWT missing or invalid 'sub' claim");
      return null;
    }

    return {
      sub: payload.sub,
      name: typeof payload.name === "string" ? payload.name : undefined,
      shops: Array.isArray(payload.shops) ? payload.shops : [],
      role: isValidRole(payload.role) ? payload.role : "viewer",
      iat: typeof payload.iat === "number" ? payload.iat : 0,
      exp: typeof payload.exp === "number" ? payload.exp : 0,
    };
  } catch (error) {
    if (error instanceof Error) {
      // Don't log full error for expected cases like expiration
      if (error.message.includes("expired")) {
        console.warn("[Auth] JWT token expired");
      } else {
        console.error("[Auth] JWT verification failed:", error.message);
      }
    }
    return null;
  }
}

/**
 * Type guard for valid roles
 */
function isValidRole(role: unknown): role is "admin" | "editor" | "viewer" {
  return role === "admin" || role === "editor" || role === "viewer";
}

// =============================================================================
// Request Authentication
// =============================================================================

/**
 * Authenticate a request using Authorization header
 * Supports:
 * - Bearer <jwt-token>
 * - ApiKey <api-token>
 */
export async function authenticateRequest(
  request: Request
): Promise<AuthResult> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return {
      success: false,
      error: "Missing Authorization header",
      status: 401,
    };
  }

  // Handle Bearer token (JWT)
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    return authenticateJWT(token);
  }

  // Handle API key
  if (authHeader.startsWith("ApiKey ")) {
    const apiKey = authHeader.slice(7);
    return authenticateApiKey(apiKey);
  }

  return {
    success: false,
    error: "Invalid Authorization header format. Use 'Bearer <token>' or 'ApiKey <key>'",
    status: 401,
  };
}

/**
 * Authenticate using JWT token
 */
async function authenticateJWT(token: string): Promise<AuthResult> {
  const payload = await verifyJWT(token);

  if (!payload) {
    return {
      success: false,
      error: "Invalid or expired token",
      status: 401,
    };
  }

  const session: AuthSession = {
    actor: payload.sub,
    actorName: payload.name || payload.sub,
    role: payload.role,
    allowedShops: payload.shops,
    hasFullAccess: payload.role === "admin" && payload.shops.length === 0,
    token,
  };

  return { success: true, session };
}

/**
 * Authenticate using API key
 * API key grants full admin access
 */
function authenticateApiKey(apiKey: string): AuthResult {
  if (!MONITOR_API_TOKEN) {
    console.error("[Auth] MONITOR_API_TOKEN not configured");
    return {
      success: false,
      error: "API key authentication not configured",
      status: 401,
    };
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(apiKey, MONITOR_API_TOKEN)) {
    return {
      success: false,
      error: "Invalid API key",
      status: 401,
    };
  }

  const session: AuthSession = {
    actor: "api-key@see-it.app",
    actorName: "API Key",
    role: "admin",
    allowedShops: [],
    hasFullAccess: true,
    token: apiKey,
  };

  return { success: true, session };
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
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
// Shop Access Verification
// =============================================================================

/**
 * Check if the authenticated session has access to a specific shop
 */
export function verifyShopAccess(
  session: AuthSession,
  shopId: string
): ShopAccessResult {
  // Admins with no shop restrictions have full access
  if (session.hasFullAccess) {
    return { allowed: true };
  }

  // Check if shop is in allowed list
  if (session.allowedShops.includes(shopId)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    error: `Access denied to shop ${shopId}`,
  };
}

// =============================================================================
// Permission Checking
// =============================================================================

/**
 * Check if a session has a specific permission
 */
export function hasPermission(
  session: AuthSession,
  permission: Permission
): boolean {
  const { PERMISSIONS } = require("./auth.types") as {
    PERMISSIONS: typeof import("./auth.types").PERMISSIONS;
  };
  const allowedRoles = PERMISSIONS[permission];
  return (allowedRoles as readonly string[]).includes(session.role);
}

/**
 * Verify permission and return error result if not allowed
 */
export function verifyPermission(
  session: AuthSession,
  permission: Permission
): ShopAccessResult {
  if (hasPermission(session, permission)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    error: `Permission denied: ${permission} requires role ${getRequiredRoles(permission)}`,
  };
}

function getRequiredRoles(permission: Permission): string {
  const { PERMISSIONS } = require("./auth.types") as {
    PERMISSIONS: typeof import("./auth.types").PERMISSIONS;
  };
  const roles = PERMISSIONS[permission];
  return roles.join(" or ");
}

// =============================================================================
// Utility: Extract session from verified request
// =============================================================================

/**
 * Symbol key for storing session in request
 */
export const AUTH_SESSION_KEY = "x-auth-session";

/**
 * Get auth session from request headers (set by middleware)
 * Returns null if not authenticated
 */
export function getSessionFromRequest(request: Request): AuthSession | null {
  const sessionHeader = request.headers.get(AUTH_SESSION_KEY);

  if (!sessionHeader) {
    return null;
  }

  try {
    return JSON.parse(sessionHeader) as AuthSession;
  } catch {
    console.error("[Auth] Failed to parse session from header");
    return null;
  }
}
