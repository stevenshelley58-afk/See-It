/**
 * External Auth Types
 *
 * Types for external API authentication, rate limiting, and CORS.
 */

export interface ExternalAuthResult {
  revealEnabled: boolean;
  corsHeaders: Record<string, string>;
  tokenHash: string;
  clientIp: string;
}

export interface RateLimitConfig {
  perKeyLimit: number; // 100 requests
  perKeyWindowMs: number; // 60000 (60s)
  globalLimit: number; // 300 requests
  globalWindowMs: number; // 60000 (60s)
}

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}
