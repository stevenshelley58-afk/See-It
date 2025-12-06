/**
 * Simple in-memory image cache for See It
 * Caches room and product images to avoid repeated downloads
 *
 * Cache keys:
 *   room:{sessionId}:original  - Original room image
 *   room:{sessionId}:cleaned   - Cleaned room image (after Gemini cleanup)
 *   room:{sessionId}:optimized - Pre-resized for Gemini
 *   product:{productId}        - Prepared product image (transparent PNG)
 */

import { logger, createLogContext } from "./logger.server";

interface CacheEntry {
    buffer: Buffer;
    expires: number;
    size: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB max cache size

let currentCacheSize = 0;

export const imageCache = {
    get(key: string): Buffer | null {
        const entry = cache.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expires) {
            currentCacheSize -= entry.size;
            cache.delete(key);
            return null;
        }

        return entry.buffer;
    },

    set(key: string, buffer: Buffer, ttl = DEFAULT_TTL): void {
        // Remove old entry if exists
        const existing = cache.get(key);
        if (existing) {
            currentCacheSize -= existing.size;
            cache.delete(key);
        }

        // Evict old entries if cache too large
        while (currentCacheSize + buffer.length > MAX_CACHE_SIZE && cache.size > 0) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey) {
                const oldEntry = cache.get(oldestKey);
                if (oldEntry) {
                    currentCacheSize -= oldEntry.size;
                }
                cache.delete(oldestKey);
            }
        }

        cache.set(key, {
            buffer,
            expires: Date.now() + ttl,
            size: buffer.length
        });
        currentCacheSize += buffer.length;

        logger.debug(
            createLogContext("system", "cache", "set", {}),
            `Cache set: ${key}, size: ${(buffer.length / 1024).toFixed(1)}KB, total: ${(currentCacheSize / 1024 / 1024).toFixed(1)}MB`
        );
    },

    delete(key: string): void {
        const entry = cache.get(key);
        if (entry) {
            currentCacheSize -= entry.size;
            cache.delete(key);
        }
    },

    // Delete all entries for a session (when session expires)
    deleteSession(sessionId: string): void {
        for (const key of cache.keys()) {
            if (key.includes(sessionId)) {
                this.delete(key);
            }
        }
    },

    // Cleanup expired entries
    cleanup(): void {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of cache) {
            if (now > entry.expires) {
                currentCacheSize -= entry.size;
                cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger.info(
                createLogContext("system", "cache", "cleanup", {}),
                `Cache cleanup: removed ${cleaned} entries, size: ${(currentCacheSize / 1024 / 1024).toFixed(1)}MB`
            );
        }
    },

    // Stats for debugging
    stats(): { entries: number; sizeBytes: number; sizeMB: string } {
        return {
            entries: cache.size,
            sizeBytes: currentCacheSize,
            sizeMB: (currentCacheSize / 1024 / 1024).toFixed(2)
        };
    }
};

// Run cleanup every 5 minutes
setInterval(() => imageCache.cleanup(), 5 * 60 * 1000);
