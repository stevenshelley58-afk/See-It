// =============================================================================
// Authentication Types for See It Monitor
// =============================================================================

/**
 * Decoded JWT payload structure
 */
export interface AuthTokenPayload {
  /** User email or identifier */
  sub: string;
  /** User display name (optional) */
  name?: string;
  /** List of shop IDs the user has access to (empty = all shops) */
  shops: string[];
  /** User role */
  role: "admin" | "editor" | "viewer";
  /** Token issued at (Unix timestamp) */
  iat: number;
  /** Token expiration (Unix timestamp) */
  exp: number;
}

/**
 * Authenticated session context attached to requests
 */
export interface AuthSession {
  /** User email/identifier from token */
  actor: string;
  /** User display name */
  actorName: string;
  /** User role */
  role: "admin" | "editor" | "viewer";
  /** Shop IDs the user can access (empty = all shops for admins) */
  allowedShops: string[];
  /** Whether user can access all shops */
  hasFullAccess: boolean;
  /** Original token for forwarding */
  token: string;
}

/**
 * Result of authentication verification
 */
export type AuthResult =
  | { success: true; session: AuthSession }
  | { success: false; error: string; status: 401 | 403 };

/**
 * Result of shop access verification
 */
export type ShopAccessResult =
  | { allowed: true }
  | { allowed: false; error: string };

/**
 * Permission levels for different operations
 */
export const PERMISSIONS = {
  // Read-only operations
  VIEW_PROMPTS: ["admin", "editor", "viewer"] as const,
  VIEW_AUDIT_LOG: ["admin", "editor", "viewer"] as const,
  VIEW_RUNTIME_CONFIG: ["admin", "editor", "viewer"] as const,
  VIEW_LLM_CALLS: ["admin", "editor", "viewer"] as const,

  // Write operations
  CREATE_VERSION: ["admin", "editor"] as const,
  ACTIVATE_VERSION: ["admin", "editor"] as const,
  ROLLBACK_VERSION: ["admin", "editor"] as const,
  UPDATE_RUNTIME_CONFIG: ["admin"] as const,
  RUN_TESTS: ["admin", "editor"] as const,
} as const;

export type Permission = keyof typeof PERMISSIONS;
