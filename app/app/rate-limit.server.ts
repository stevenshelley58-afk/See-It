/**
 * Rate Limiter for App-Proxy Routes
 *
 * Uses a hybrid approach:
 * - In-memory Map for fast burst protection (sub-millisecond response)
 * - Database-backed via RoomSession.lastUsedAt for persistence across restarts
 *
 * Trade-offs documented:
 * - In-memory state resets on deploy/restart, but this is acceptable because:
 *   1. Room sessions expire in 24h anyway
 *   2. Rate limits are per-session, not per-user
 *   3. Deploys are infrequent and reset is a minor attack surface
 *   4. DB check provides secondary persistent protection
 *
 * For Redis-backed rate limiting in high-scale scenarios, consider:
 * - npm install @upstash/ratelimit @upstash/redis
 * - Or use Redis directly with INCR + EXPIRE pattern
 */

import prisma from "./db.server";

// In-memory store for fast burst protection
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;

// Minimum time between requests (prevents rapid-fire attacks even after restart)
const MIN_REQUEST_INTERVAL_MS = 2000; // 2 seconds

/**
 * Check if a request is rate limited
 * Returns true if allowed, false if rate limited
 */
export function checkRateLimit(roomSessionId: string): boolean {
    const now = Date.now();
    const key = roomSessionId;

    if (!rateLimitStore.has(key)) {
        rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }

    const record = rateLimitStore.get(key)!;

    // Reset if window expired
    if (now > record.resetAt) {
        rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }

    // Check if limit exceeded
    if (record.count >= MAX_REQUESTS_PER_WINDOW) {
        return false;
    }

    // Increment count
    record.count++;
    return true;
}

/**
 * Async rate limit check with database persistence
 * Use this for expensive operations (like render requests) where persistence matters
 *
 * Returns: { allowed: boolean; retryAfterMs?: number; reason?: string }
 */
export async function checkRateLimitAsync(roomSessionId: string): Promise<{
    allowed: boolean;
    retryAfterMs?: number;
    reason?: string;
}> {
    const now = Date.now();

    // First, check in-memory rate limit (fast path)
    if (!checkRateLimit(roomSessionId)) {
        const record = rateLimitStore.get(roomSessionId);
        return {
            allowed: false,
            retryAfterMs: record ? record.resetAt - now : RATE_LIMIT_WINDOW_MS,
            reason: "Rate limit exceeded. Please wait before trying again."
        };
    }

    // Second, check database for minimum interval (persistence across restarts)
    try {
        const session = await prisma.roomSession.findUnique({
            where: { id: roomSessionId },
            select: { lastUsedAt: true, expiresAt: true }
        });

        if (!session) {
            return { allowed: false, reason: "Session not found" };
        }

        // Check if session has expired
        if (session.expiresAt < new Date()) {
            return { allowed: false, reason: "Session has expired" };
        }

        // Check minimum interval from last use (persistent across restarts)
        if (session.lastUsedAt) {
            const timeSinceLastUse = now - session.lastUsedAt.getTime();
            if (timeSinceLastUse < MIN_REQUEST_INTERVAL_MS) {
                return {
                    allowed: false,
                    retryAfterMs: MIN_REQUEST_INTERVAL_MS - timeSinceLastUse,
                    reason: "Please wait a moment before making another request"
                };
            }
        }

        // Update lastUsedAt for next check
        await prisma.roomSession.update({
            where: { id: roomSessionId },
            data: { lastUsedAt: new Date() }
        });

        return { allowed: true };
    } catch (error) {
        // If DB check fails, allow request but log the error
        console.error("[RateLimit] Database check failed:", error);
        return { allowed: true };
    }
}

/**
 * Reset rate limit for a specific session (useful for testing)
 */
export function resetRateLimit(roomSessionId: string): void {
    rateLimitStore.delete(roomSessionId);
}

/**
 * Get remaining requests for a session
 */
export function getRateLimitStatus(roomSessionId: string): {
    remaining: number;
    resetAt: number;
} {
    const record = rateLimitStore.get(roomSessionId);
    if (!record) {
        return {
            remaining: MAX_REQUESTS_PER_WINDOW,
            resetAt: Date.now() + RATE_LIMIT_WINDOW_MS
        };
    }

    const now = Date.now();
    if (now > record.resetAt) {
        return {
            remaining: MAX_REQUESTS_PER_WINDOW,
            resetAt: now + RATE_LIMIT_WINDOW_MS
        };
    }

    return {
        remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - record.count),
        resetAt: record.resetAt
    };
}

// Cleanup old entries periodically (every minute)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetAt + RATE_LIMIT_WINDOW_MS) {
            // Keep entries for one extra window for accurate rate limiting
            rateLimitStore.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`[RateLimit] Cleaned ${cleaned} expired entries, ${rateLimitStore.size} active`);
    }
}, RATE_LIMIT_WINDOW_MS);
