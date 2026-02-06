# Telemetry, Logging, and Observability Audit

**Date:** 2026-01-30  
**Scope:** OpenTelemetry configuration, logging patterns, correlation IDs, secret exposure risks  
**Files Analyzed:**
- [`app/app/otel.server.ts`](app/app/otel.server.ts:1)
- [`app/app/services/telemetry/*.ts`](app/app/services/telemetry/index.ts:1)
- [`app/app/services/session-logger.server.ts`](app/app/services/session-logger.server.ts:1)
- [`app/app/utils/logger.server.ts`](app/app/utils/logger.server.ts:1)
- [`app/app/utils/request-context.server.ts`](app/app/utils/request-context.server.ts:1)

---

## Executive Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| OpenTelemetry Configuration | ✅ GOOD | Properly configured with Google Cloud Trace, graceful fallback |
| Correlation ID Consistency | ⚠️ PARTIAL | Multiple ID types (`requestId`, `traceId`, `runId`) with inconsistent mapping |
| Secret Exposure Risk | ✅ LOW | No obvious secrets in logs; payloads truncated appropriately |
| Log Shape Consistency | ✅ GOOD | Structured logger enforces consistent schema |
| Error Handling | ✅ GOOD | Comprehensive error enrichment with cause chain support |

---

## 1. OpenTelemetry Configuration

### 1.1 Initialization ([`otel.server.ts`](app/app/otel.server.ts:90))

**Strengths:**
- ✅ **Fail-safe design**: Wrapped in try/catch; app continues if tracing fails
- ✅ **Environment-aware**: Skips initialization in test environment
- ✅ **Graceful shutdown**: SIGTERM handler for clean SDK shutdown
- ✅ **Prisma instrumentation**: Automatic DB query tracing via [`@prisma/instrumentation`](app/app/otel.server.ts:130)

**Configuration Flow:**
```typescript
// Credential priority (line 46-84):
1. GOOGLE_APPLICATION_CREDENTIALS (file path)
2. GOOGLE_CREDENTIALS_JSON (base64-encoded)
3. GOOGLE_CLOUD_PROJECT (GCP metadata)
```

**Security Note:** Base64 credentials are written to temp file with `0o600` permissions ([line 63](app/app/otel.server.ts:63)).

### 1.2 Trace Context Extraction

```typescript
// Lines 209-225
getCurrentTraceId()  // Returns traceId from active span
getCurrentSpanId()   // Returns spanId from active span
```

**Gap:** These utilities exist but are not widely used. Most code uses `requestId` from logger instead of OTEL trace context.

---

## 2. Correlation ID Consistency

### 2.1 ID Types Overview

| ID Type | Purpose | Source | Stored In |
|---------|---------|--------|-----------|
| `requestId` | HTTP request correlation | [`generateRequestId()`](app/app/utils/logger.server.ts:150) or `X-Request-ID` header | Logs, telemetry events |
| `traceId` | OpenTelemetry trace | OTEL SDK | MonitorEvent.traceId, CompositeRun.traceId |
| `runId` | Composite render run | [`crypto.randomUUID()`](app/app/services/telemetry/artifacts.server.ts:25) | CompositeRun.id, MonitorEvent.runId |
| `sessionId` | Room/session tracking | Generated per session | Session logs, RoomSession.id |

### 2.2 Inconsistency Issues

**Issue 1: `traceId` vs `requestId` Confusion**

In [`rollups.server.ts`](app/app/services/telemetry/rollups.server.ts:51):
```typescript
// traceId is used as requestId
requestId: input.traceId, // Use traceId as requestId for events
```

In [`prompt-builder.server.ts`](app/app/services/see-it-now/prompt-builder.server.ts:63):
```typescript
// But here traceId IS the requestId
requestId: traceId,
```

**Issue 2: Missing Trace Context Propagation**

The [`TelemetryEventInput`](app/app/services/telemetry/types.ts:19) interface supports `traceId`, `spanId`, `parentSpanId`, but these are rarely populated from actual OTEL context:

```typescript
// Most calls don't use getCurrentTraceId():
emit({
  shopId,
  requestId,  // <-- This is usually a UUID, not OTEL traceId
  traceId: undefined,  // <-- Often missing
})
```

**Recommendation:** Create a helper to extract OTEL context and populate telemetry events automatically.

### 2.3 Request ID Generation

**Source:** [`request-context.server.ts`](app/app/utils/request-context.server.ts:11)

```typescript
export function getRequestId(request: Request): string {
  const existingId = request.headers.get("X-Request-ID");
  if (existingId) return existingId;
  return generateRequestId();  // crypto.randomUUID()
}
```

**Good Practice:**
- ✅ Respects incoming `X-Request-ID` header for distributed tracing
- ✅ Response includes `X-Request-ID` via [`addRequestIdHeader()`](app/app/utils/request-context.server.ts:22)

---

## 3. Logging Configuration

### 3.1 Structured Logger ([`logger.server.ts`](app/app/utils/logger.server.ts:99))

**Required Context Fields:**
```typescript
interface LogContext {
  flow: "prepare" | "render" | "auth" | "shopify-sync" | "cleanup" | "system";
  shopId?: string | null;
  productId?: string | null;
  assetId?: string | null;
  requestId: string;  // Required
  stage: string;
  [key: string]: unknown;
}
```

**Log Format:**
```
[2026-01-30T01:23:45.678Z] [ERROR] Message | {"flow":"prepare","requestId":"...","stage":"upload"}
```

### 3.2 Error Enrichment

**Excellent implementation** at [`logger.server.ts:35-79`](app/app/utils/logger.server.ts:35):

Captures:
- Error type, message, stack (first 8 lines)
- **Cause chain** (modern `Error.cause` support)
- Common codes: `code`, `errno`, `statusCode`
- HTTP response info
- **Prisma errors**: `meta`, `clientVersion`
- **GraphQL errors**: `errors` array
- System context: memory, Node version, uptime

### 3.3 Console Usage Patterns

**Prefix Convention (Good):**
```typescript
console.error("[Rollups] Failed to start run:", error);
console.error("[Telemetry] Failed to emit event:", input.type, error);
console.error("[SessionLogger] Failed to log step:", step, error);
```

**Problem Areas:**

1. **Mixed patterns**: Some code uses structured logger, some uses `console.*` directly
2. **Inconsistent prefixes**: Not all modules use bracketed prefixes

---

## 4. Secret Exposure Risk Assessment

### 4.1 Telemetry Payload Handling

**Good Safeguards:**

1. **Payload Size Limit** ([`constants.ts:105`](app/app/services/telemetry/constants.ts:105)):
   ```typescript
   export const MAX_PAYLOAD_SIZE = 10000;  // 10KB
   ```

2. **Truncation Logic** ([`emitter.server.ts:72-81`](app/app/services/telemetry/emitter.server.ts:72)):
   ```typescript
   if (payloadStr.length > MAX_PAYLOAD_SIZE) {
     payload = {
       _truncated: true,
       _originalSize: payloadStr.length,
       ...Object.fromEntries(Object.entries(payload).slice(0, 10)),
     };
   }
   ```

3. **TODO Comment** indicates overflow to GCS is planned but not implemented.

### 4.2 Session Logger Data

**Potential Concern:** [`session-logger.server.ts`](app/app/services/session-logger.server.ts:30-77)

The [`SeeItNowEventData`](app/app/services/session-logger.server.ts:30) interface captures:
- Device info (userAgent, screen size)
- Product info (productId, productTitle)
- Image URLs

**No obvious PII** (no customer names, emails, addresses), but shop domain is logged.

### 4.3 Error Payloads

**Risk:** Error objects may contain sensitive data in messages. The [`enrichError()`](app/app/services/telemetry/emitter.server.ts:105) function captures:
- Error message (could contain IDs, partial URLs)
- Stack traces (safe)
- HTTP response status/text (usually safe)

**No explicit secret scrubbing** is implemented. If an API error message contains a token or key, it would be logged.

---

## 5. Log Shape Consistency

### 5.1 Telemetry Event Schema

**Database Schema** ([`emitter.server.ts:83-99`](app/app/services/telemetry/emitter.server.ts:83)):

```typescript
await prisma.monitorEvent.create({
  data: {
    shopId: input.shopId,        // Required correlation
    requestId: input.requestId,  // Required correlation
    runId: input.runId,          // Optional
    variantId: input.variantId,  // Optional
    traceId: input.traceId,      // Optional (OTEL)
    spanId: input.spanId,        // Optional (OTEL)
    parentSpanId: input.parentSpanId,  // Optional (OTEL)
    source: input.source,        // EventSource enum
    type: input.type,            // EventType enum
    severity: input.severity || Severity.INFO,
    payload: payload,            // JSON (max 10KB)
    overflowArtifactId,          // For large payloads (TODO)
    schemaVersion: SCHEMA_VERSION,  // Currently 1
  },
});
```

### 5.2 Event Source Taxonomy

**Well-organized** in [`constants.ts`](app/app/services/telemetry/constants.ts:8-17):

```typescript
export const EventSource = {
  STOREFRONT: "storefront",
  APP_PROXY: "app_proxy",
  ADMIN_APP: "admin_app",
  PREP: "prep",
  PROMPT_BUILDER: "prompt_builder",
  COMPOSITE_RUNNER: "composite_runner",
  PROVIDER: "provider",
  STORAGE: "storage",
};
```

### 5.3 Artifact Storage

**Dual Storage Strategy:**

1. **GCS**: Actual file content stored with retention policies
2. **Database**: Index record in [`MonitorArtifact`](app/app/services/telemetry/artifacts.server.ts:59) table

**Retention Classes** ([`constants.ts:89-102`](app/app/services/telemetry/constants.ts:89)):
- `SHORT`: 7 days
- `STANDARD`: 30 days (default)
- `LONG`: 90 days

---

## 6. Fire-and-Forget Patterns

### 6.1 Telemetry Emitter

**Critical Design** ([`emitter.server.ts:17-25`](app/app/services/telemetry/emitter.server.ts:17)):

```typescript
export function emit(input: TelemetryEventInput): void {
  doEmit(input).catch((error) => {
    console.error(
      "[Telemetry] Failed to emit event:",
      input.type,
      error?.message || error
    );
  });
}
```

**Guarantees:**
- ✅ Never throws
- ✅ Never blocks (fire-and-forget)
- ✅ Errors logged to console only

### 6.2 Session Logger

Same pattern at [`session-logger.server.ts:120-128`](app/app/services/session-logger.server.ts:120):

```typescript
export function logSeeItNowEvent(eventType: SeeItNowEventType, data: SeeItNowEventData): void {
  doLogSeeItNowEvent(eventType, data).catch((error) => {
    console.error('[SessionLogger] Failed to log See It Now event:', ...);
  });
}
```

---

## 7. Recommendations

### High Priority

1. **Unify Correlation IDs**
   ```typescript
   // Create a helper
   export function getCurrentContext() {
     return {
       requestId: getCurrentRequestId(),
       traceId: getCurrentTraceId(),  // From OTEL
       spanId: getCurrentSpanId(),    // From OTEL
     };
   }
   ```

2. **Add Secret Scrubbing**
   ```typescript
   const SENSITIVE_KEYS = ['apiKey', 'token', 'password', 'secret', 'authorization'];
   function scrubPayload(payload: unknown): unknown {
     // Recursively redact sensitive keys
   }
   ```

3. **Implement Overflow Artifact Storage**
   - The TODO at [`emitter.server.ts:74`](app/app/services/telemetry/emitter.server.ts:74) should be implemented to handle large payloads properly.

### Medium Priority

4. **Standardize on Structured Logger**
   - Replace remaining `console.*` calls with `logger.info/error/warn`

5. **Add Log Levels Configuration**
   - Allow `LOG_LEVEL` env var to control verbosity

6. **Correlation ID Validation**
   - Validate `X-Request-ID` format to prevent log injection

### Low Priority

7. **OTEL Span Attributes**
   - Populate more span attributes for better trace visualization

8. **Metrics Collection**
   - Consider adding OpenTelemetry metrics (not just traces)

---

## 8. Files Summary

| File | Purpose | Key Exports |
|------|---------|-------------|
| [`otel.server.ts`](app/app/otel.server.ts:1) | OTEL SDK initialization | `initTracing()`, `withSpan()`, `getCurrentTraceId()` |
| [`telemetry/index.ts`](app/app/services/telemetry/index.ts:1) | Public telemetry API | `emit()`, `startRun()`, `storeArtifact()` |
| [`telemetry/emitter.server.ts`](app/app/services/telemetry/emitter.server.ts:1) | Event emission | `emit()`, `emitAsync()`, `emitError()` |
| [`telemetry/rollups.server.ts`](app/app/services/telemetry/rollups.server.ts:1) | Run/variant tracking | `startRun()`, `recordVariantResult()`, `completeRun()` |
| [`telemetry/artifacts.server.ts`](app/app/services/telemetry/artifacts.server.ts:1) | GCS artifact storage | `storeArtifact()`, `getArtifactUrl()` |
| [`telemetry/types.ts`](app/app/services/telemetry/types.ts:1) | TypeScript interfaces | `TelemetryEventInput`, `ArtifactInput`, `TraceContext` |
| [`telemetry/constants.ts`](app/app/services/telemetry/constants.ts:1) | Enums and constants | `EventSource`, `EventType`, `RetentionClass` |
| [`session-logger.server.ts`](app/app/services/session-logger.server.ts:1) | Session event logging | `logSeeItNowEvent()`, `logSessionStep()` |
| [`logger.server.ts`](app/app/utils/logger.server.ts:1) | Structured logging | `logger`, `createLogContext()`, `generateRequestId()` |
| [`request-context.server.ts`](app/app/utils/request-context.server.ts:1) | Request ID handling | `getRequestId()`, `addRequestIdHeader()` |

---

## 9. Conclusion

The telemetry and logging system is **well-architected** with strong fail-safe patterns. The main areas for improvement are:

1. **Correlation ID unification** - The `traceId`/`requestId` duality is confusing
2. **Secret scrubbing** - Add explicit PII/secrets filtering
3. **Overflow artifact implementation** - Complete the TODO for large payloads

Overall, the system follows observability best practices and should provide good visibility into production issues.
