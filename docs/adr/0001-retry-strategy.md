# ADR 0001: Retry Strategy

**Status:** Accepted  
**Date:** 2026-01-30

## Context
- Four retry styles existed (linear, exponential, fixed, none) with no documented guidance.
- Mixed strategies made it hard to correlate retries across Shopify, Gemini, and internal services.
- Some callers retried non-idempotent actions, risking duplicate side effects.

## Decision
1. **Default:** Exponential backoff with jitter (base 250 ms, max 5 s, cap 5 attempts) for transient network errors and 5xx responses.
2. **Shopify Admin API:** Respect `Retry-After` when provided; otherwise linear backoff (500 ms increments, max 5 attempts) to avoid overwhelming rate limits.
3. **Idempotent internal DB operations:** Single retry on `TransactionAlreadyClosed` / connection reset, then surface the error.
4. **Non-idempotent operations (writes with external side effects):** Do **not** auto-retry; surface to caller and log with correlation IDs.

## Implementation Notes
- Prefer a shared helper when adding new retries; keep jittered backoff centralized.
- Always include `requestId`/`traceId` in retry logs for correlation.
- Honor provider-specific guidance (e.g., Shopify `Retry-After`, Google 429/503).

## Consequences
- Fewer duplicate side effects from unsafe retries.
- Clear, predictable backoff behavior across services.
- Easier tracing of repeated attempts in logs and telemetry.
