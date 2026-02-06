# Error Handling & Retry/Backoff Audit

**Scope:** Analysis of try/catch patterns, retry logic, backoff strategies, and error propagation across the codebase.  
**Date:** 2026-01-30  
**Focus Areas:** API error handling, retry mechanisms, backoff strategies, error swallowing patterns

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Files with Retry Logic | 8+ |
| Custom Error Classes | 15+ |
| Max Retry Attempts Range | 1-3 |
| Backoff Strategies | 3 distinct patterns |
| Unbounded Retry Risks | 1 (stale lock recovery) |

---

## 1. Retry Logic Implementations

### 1.1 Shopify API Retry (`app/app/utils/shopify-api.server.ts`)

**Implementation:** [`executeGraphQLWithRetry()`](app/app/utils/shopify-api.server.ts:197)

```typescript
const maxRetries = options?.maxRetries ?? 3;
const initialDelay = options?.initialDelayMs ?? 1000;

for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Execute query
    // Don't retry non-retryable errors
    // Use error-suggested retry delay or exponential backoff
    const retryDelay = lastResult.error?.retryAfterMs ?? delay;
    delay = Math.min(delay * 2, 10000); // Cap at 10 seconds
}
```

**Characteristics:**
- **Max Retries:** 3 (configurable)
- **Backoff:** Exponential with 10s cap
- **Retryable Errors:** RATE_LIMITED, SERVER_ERROR, NETWORK_ERROR
- **Retry-After Header:** Respects API-provided delays

**Error Classification:**
| Error Type | Retryable | Default Delay |
|------------|-----------|---------------|
| RATE_LIMITED | ✅ Yes | 2000ms or Retry-After header |
| SERVER_ERROR | ✅ Yes | Exponential backoff |
| NETWORK_ERROR | ✅ Yes | 1000ms |
| UNAUTHORIZED | ❌ No | - |
| FORBIDDEN | ❌ No | - |
| NOT_FOUND | ❌ No | - |

### 1.2 Prepare Processor Retry (`app/app/services/prepare-processor.server.ts`)

**Implementation:** Inline retry loops with exponential backoff

```typescript
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 5000; // 5 seconds base delay

function getRetryDelay(retryCount: number): number {
    return RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
    // Results: 5s, 10s, 20s
}
```

**Retryable Pattern Detection:**
```typescript
const retryablePatterns = [
    'network', 'timeout', 'econnreset', 'econnrefused', 'etimedout',
    'rate limit', 'too many requests', '429', '503', '502', '504',
    'temporarily unavailable', 'service unavailable', 'internal server error',
    'aborted',
];
```

**Applied To:**
- Product asset processing (lines 160-250)
- Render job processing (lines 677-790)
- Stale lock recovery (lines 956-1011) ⚠️ **See Risk #1**

### 1.3 PhotoRoom API Retry (`app/app/services/photoroom.server.ts`)

**Implementation:** Limited retry with jittered backoff

```typescript
const retryMax = getEnvInt("PHOTOROOM_RETRY_MAX", 1);

function jitteredBackoffMs(attempt: number): number {
    const base = 250 * Math.pow(2, Math.max(0, attempt));
    const jitter = Math.floor(Math.random() * 150);
    return base + jitter;
}
```

**Characteristics:**
- **Max Retries:** 1 (default, configurable via env)
- **Backoff:** Jittered exponential (250ms, 500ms, 1000ms...)
- **Timeout:** 30s default, deadline-aware
- **Retry Only On:** HTTP 429 (rate limit)

### 1.4 Gemini Service Retry (`app/app/services/gemini.server.ts`)

**Implementation:** Error classification without automatic retry loop

```typescript
function isRetryableGeminiError(error: unknown): boolean {
    if (error instanceof GeminiTimeoutError) return true;
    const msg = error instanceof Error ? error.message.toLowerCase() : "";
    return (
        msg.includes("429") ||
        msg.includes("rate") ||
        msg.includes("quota") ||
        msg.includes("503") ||
        msg.includes("timeout")
    );
}
```

**Note:** No automatic retry loop - callers must implement their own retry logic.

### 1.5 See It Now Extractor Retry (`app/app/services/see-it-now/extractor.server.ts`)

**Implementation:** Fixed 2-attempt retry loop

```typescript
for (let attempt = 0; attempt < 2; attempt++) {
    // Try extraction
    if (validationFailed && attempt === 0) {
        logger.warn({ ...logContext, stage: "validate-retry" }, "Retrying extraction once");
        continue;
    }
    // Same for parse failures
}
```

**Characteristics:**
- **Max Retries:** 1 (2 total attempts)
- **Backoff:** None (immediate retry)
- **Retry On:** Validation failures, parse failures

---

## 2. Backoff Strategy Comparison

| Service | Strategy | Base Delay | Max Delay | Jitter | Configurable |
|---------|----------|------------|-----------|--------|--------------|
| Shopify API | Exponential | 1000ms | 10000ms | ❌ No | ✅ Yes |
| Prepare Processor | Exponential | 5000ms | 20000ms | ❌ No | ❌ Hardcoded |
| PhotoRoom | Jittered Exponential | 250ms | ~1000ms | ✅ Yes | ✅ Via env |
| Extractor | None (immediate) | 0ms | 0ms | ❌ No | ❌ Hardcoded |

**Inconsistency Risk:** Different services use different backoff strategies without a unified approach. This could lead to:
- Thundering herd problems during outages
- Inconsistent user experience
- Difficult tuning of retry behavior

---

## 3. Error Classes & Types

### 3.1 Custom Error Classes

| Class | File | Properties | Purpose |
|-------|------|------------|---------|
| `ShopifyApiError` | `shopify-api.server.ts` | type, message, retryable, retryAfterMs | Structured API errors |
| `GeminiServiceError` | `gemini.server.ts` | code, retryable, causeId | LLM service errors |
| `GeminiTimeoutError` | `gemini.server.ts` | - | Timeout-specific |
| `PhotoRoomRateLimitError` | `photoroom.server.ts` | status, retryAfterMs | Rate limit errors |
| `PhotoRoomTimeoutError` | `photoroom.server.ts` | - | Timeout-specific |
| `PhotoRoomBadResponseError` | `photoroom.server.ts` | status | Bad response errors |
| `VariantBlockedError` | `composite-runner.server.ts` | code, finishReason, safetyRatings | Safety block errors |
| `InfrastructureError` | `composite-runner.server.ts` | - | Infrastructure failures |
| `ExtractorOutputError` | `extractor.server.ts` | code, issues, attempt | Extraction failures |
| `TrimAlphaError` | `trim-alpha.server.ts` | - | Image processing errors |

### 3.2 Error Type Hierarchy

```
Error
├── ShopifyApiError (interface)
├── GeminiServiceError
├── GeminiTimeoutError
├── PhotoRoomRateLimitError
├── PhotoRoomTimeoutError
├── PhotoRoomBadResponseError
├── VariantBlockedError
├── InfrastructureError
├── ExtractorOutputError
└── TrimAlphaError
```

---

## 4. Error Swallowing vs Propagation

### 4.1 Error Swallowing Patterns

| Location | Pattern | Risk Level |
|----------|---------|------------|
| `prep-events.server.ts:126` | `.catch(() => { /* silently log */ })` | 🟡 Low - Non-critical monitor copy |
| `telemetry/emitter.server.ts:18` | `.catch((error) => { console.error(...) })` | 🟡 Low - Telemetry only |
| `session-logger.server.ts:125` | `.catch((error) => { console.error(...) })` | 🟡 Low - Logging only |
| `analytics.ts:255` | `try/catch { console.error }` | 🟢 Safe - Analytics fail-silent |
| `rate-limit.server.ts:119` | Returns `{ allowed: true }` on DB error | 🟡 Medium - Security bypass risk |

**Example:**
```typescript
// app/app/rate-limit.server.ts:119
} catch (error) {
    // If DB check fails, allow request but log the error
    console.error("[RateLimit] Database check failed:", error);
    return { allowed: true };  // ⚠️ Allows request on DB failure
}
```

### 4.2 Error Propagation Patterns

**Fail-Hard Patterns:**
- `prepare-processor.server.ts:1046` - `process.exit(1)` on critical error
- `composite-runner.server.ts` - Throws `InfrastructureError` for upload failures
- `gemini.server.ts` - Throws `GeminiServiceError` for all failures

**Structured Error Responses:**
```typescript
// shopify-api.server.ts
return {
    success: false,
    error: {
        type: "RATE_LIMITED",
        message: "Too many requests...",
        retryable: true,
        retryAfterMs: 2000
    }
};
```

---

## 5. Unbounded Retry Risks

### 🔴 Risk #1: Stale Lock Recovery Could Create Infinite Loop

**Location:** `app/app/services/prepare-processor.server.ts:956-1011`

```typescript
// Reset items stuck in "processing" state
const staleAssets = await prisma.productAsset.updateMany({
    where: {
        status: "processing",
        updatedAt: { lt: fifteenMinutesAgo },
        retryCount: { lt: MAX_RETRY_ATTEMPTS }  // ✅ Bounded per item
    },
    data: {
        status: "preparing",
        retryCount: { increment: 1 }  // ✅ Increment on reset
    }
});
```

**Mitigation:**
- ✅ Retry count is incremented on each stale reset
- ✅ Max retry limit enforced (3 attempts)
- ⚠️ However, if an item repeatedly gets stuck, it will cycle: processing → preparing → processing → ...

**Recommendation:** Add a "stale reset count" separate from retry count to prevent items from being reset indefinitely.

### 🟡 Risk #2: No Global Rate Limit on Retries

Multiple services retrying simultaneously during an outage could:
- Amplify load on failing services
- Cause cascading failures
- Hit rate limits more aggressively

**Recommendation:** Implement circuit breaker pattern or coordinated retry backoff.

---

## 6. Timeout Handling

| Service | Timeout | Implementation | AbortController |
|---------|---------|----------------|-----------------|
| PhotoRoom | 30s (configurable) | Deadline-based | ✅ Yes |
| Gemini | Configurable | `withTimeout()` helper | ✅ Yes |
| Composite Runner | 120s | `Promise.race()` with timeout | ✅ Yes |
| Health Check | 5s | `Promise.race()` with timeout | ❌ No |
| Room Confirm | 20s | `setTimeout` + `controller.abort()` | ✅ Yes |

---

## 7. Best Practices Found

### ✅ Good Patterns

1. **Structured Error Types:** [`ShopifyApiError`](app/app/utils/shopify-api.server.ts:29) with retryable flags
2. **Retry-After Header Support:** PhotoRoom and Shopify respect server-provided delays
3. **Error Cause Chains:** `GeminiServiceError` includes `causeId` for tracing
4. **Timeout Wrappers:** `withTimeout()` helper for consistent timeout handling
5. **Jittered Backoff:** PhotoRoom uses jitter to prevent thundering herd
6. **Non-Retryable Error Detection:** Clear classification of permanent vs transient errors

### ⚠️ Areas for Improvement

1. **Unified Backoff Strategy:** Different services use different backoff formulas
2. **Retry Metrics:** No centralized tracking of retry rates/success rates
3. **Circuit Breaker:** No circuit breaker pattern for failing services
4. **Stale Lock Reset:** Could benefit from separate reset counter
5. **Rate Limit on Retries:** No global coordination of retry attempts

---

## 8. Recommendations

### High Priority

1. **Add Circuit Breaker Pattern**
   - After N consecutive failures, stop retrying for a cooldown period
   - Prevents cascading failures during outages

2. **Implement Unified Retry Utility**
   ```typescript
   // Suggested API
   retryWithBackoff(operation, {
       maxAttempts: 3,
       baseDelay: 1000,
       maxDelay: 30000,
       jitter: true,
       retryable: (error) => error.retryable
   });
   ```

3. **Add Separate Stale Reset Counter**
   - Track how many times an item has been reset due to staleness
   - Fail items that get stuck repeatedly

### Medium Priority

4. **Add Retry Metrics**
   - Track retry rates per service
   - Alert on abnormal retry patterns

5. **Document Error Handling Strategy**
   - Create ADR for error handling patterns
   - Define when to retry vs fail fast

### Low Priority

6. **Consolidate Error Classes**
   - Consider shared error types across services
   - Standardize error serialization

---

## Appendix: File Inventory

| File | Retry Logic | Custom Errors | Backoff |
|------|-------------|---------------|---------|
| `shopify-api.server.ts` | ✅ | ✅ | Exponential |
| `prepare-processor.server.ts` | ✅ | ❌ | Exponential |
| `photoroom.server.ts` | ✅ | ✅ | Jittered |
| `gemini.server.ts` | ❌ | ✅ | N/A |
| `extractor.server.ts` | ✅ | ✅ | None |
| `composite-runner.server.ts` | ❌ | ✅ | N/A |
| `rate-limit.server.ts` | ❌ | ❌ | N/A |
| `external-auth/index.ts` | ❌ | ❌ | N/A |

---

*End of Audit Report*
