/**
 * Telemetry Emitter
 *
 * CRITICAL: This module must NEVER throw exceptions or block the render path.
 * All operations are fire-and-forget with internal error handling.
 */

import prisma from "~/db.server";
import { RetentionClass, Severity, SCHEMA_VERSION, MAX_PAYLOAD_SIZE } from "./constants";
import { storeArtifact } from "~/services/telemetry/artifacts.server";
import type { TelemetryEventInput } from "./types";

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "token",
  "password",
  "secret",
  "authorization",
]);

/**
 * Recursively scrub common secret fields from objects/arrays.
 */
function scrubSecrets<T>(value: T, visited = new Set<unknown>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (visited.has(value)) {
    return value;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return value.map((item) => scrubSecrets(item, visited)) as any;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = scrubSecrets(val, visited);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result as any;
}

/**
 * JSON.stringify that never throws on circular structures.
 * (We use this only for telemetry/diagnostics, not as a canonical serializer.)
 */
function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object") {
      const obj = val as object;
      if (seen.has(obj)) return "[Circular]";
      seen.add(obj);
    }
    return val;
  });
}

function truncatePreviewValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 500) return value;
    return `${value.slice(0, 500)}…`;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map(truncatePreviewValue);
  }

  if (typeof value === "object") {
    return "[Object]";
  }

  return String(value);
}

function buildTruncatedPayloadPreview(
  payload: Record<string, unknown>,
  originalSize: number
): Record<string, unknown> {
  const keys = Object.keys(payload);
  const previewEntries = Object.entries(payload)
    .slice(0, 10)
    .map(([key, value]) => [key, truncatePreviewValue(value)] as const);

  return {
    __truncated: true,
    __originalSize: originalSize,
    __keyCount: keys.length,
    __keys: keys.slice(0, 50),
    __preview: Object.fromEntries(previewEntries),
  };
}

/**
 * Emit a telemetry event. NEVER throws. Fire and forget.
 *
 * Call this without await on hot paths.
 */
export function emit(input: TelemetryEventInput): void {
  doEmit(input).catch((error) => {
    console.error(
      "[Telemetry] Failed to emit event:",
      input.type,
      error?.message || error
    );
  });
}

/**
 * Emit and wait for confirmation. Use only in non-critical paths.
 * Still never throws - returns boolean success.
 */
export async function emitAsync(
  input: TelemetryEventInput
): Promise<boolean> {
  try {
    await doEmit(input);
    return true;
  } catch (error) {
    console.error("[Telemetry] Failed to emit event:", input.type, error);
    return false;
  }
}

/**
 * Emit an error event with standardized payload.
 */
export function emitError(
  baseInput: Omit<TelemetryEventInput, "type" | "severity">,
  error: Error | unknown,
  context?: Record<string, unknown>
): void {
  const errorPayload = enrichError(error);

  emit({
    ...baseInput,
    type: "error",
    severity: Severity.ERROR,
    payload: {
      ...errorPayload,
      ...context,
    },
  });
}

/**
 * Internal emit implementation.
 */
async function doEmit(input: TelemetryEventInput): Promise<void> {
  let payload = input.payload || {};

  // Redact secrets before any further processing
  payload = scrubSecrets(payload);

  // Truncate payload if too large (store full payload as artifact for deep debugging)
  const payloadStr = safeJsonStringify(payload);
  const originalPayload = payloadStr.length > MAX_PAYLOAD_SIZE ? payload : undefined;

  if (payloadStr.length > MAX_PAYLOAD_SIZE) {
    payload = buildTruncatedPayloadPreview(payload, payloadStr.length);
  }

  const created = await prisma.monitorEvent.create({
    data: {
      shopId: input.shopId,
      requestId: input.requestId,
      runId: input.runId,
      variantId: input.variantId,
      traceId: input.traceId,
      spanId: input.spanId,
      parentSpanId: input.parentSpanId,
      source: input.source,
      type: input.type,
      severity: input.severity || Severity.INFO,
      payload,
      schemaVersion: SCHEMA_VERSION,
    },
  });

  if (!originalPayload) {
    return;
  }

  // Best-effort overflow artifact creation.
  // Never fail the event emission if artifact storage fails.
  const artifactId = await storeArtifact({
    shopId: input.shopId,
    requestId: input.requestId,
    runId: input.runId,
    variantId: input.variantId,
    type: "monitor_event_payload_overflow",
    buffer: Buffer.from(
      safeJsonStringify({
        event: {
          id: created.id,
          ts: created.ts.toISOString(),
          shopId: created.shopId,
          requestId: created.requestId,
          runId: created.runId,
          variantId: created.variantId,
          traceId: created.traceId,
          spanId: created.spanId,
          parentSpanId: created.parentSpanId,
          source: created.source,
          type: created.type,
          severity: created.severity,
          schemaVersion: created.schemaVersion,
        },
        payload: originalPayload,
      }) + "\n",
      "utf8"
    ),
    contentType: "application/json",
    retentionClass: RetentionClass.SENSITIVE,
    meta: {
      kind: "monitor_event_payload_overflow",
      eventId: created.id,
      eventType: created.type,
      eventSource: created.source,
      originalPayloadSize: payloadStr.length,
    },
  });

  if (!artifactId) {
    return;
  }

  try {
    await prisma.monitorEvent.update({
      where: { id: created.id },
      data: { overflowArtifactId: artifactId },
    });
  } catch (error) {
    // Orphaned artifact is acceptable; do not throw.
    console.error("[Telemetry] Failed to link overflow artifact to event:", error);
  }
}

/**
 * Extract rich error details from any error type.
 */
function enrichError(error: unknown): Record<string, unknown> {
  if (!error) {
    return { errorType: "null", errorMessage: "No error provided" };
  }

  const result: Record<string, unknown> = {};

  if (error instanceof Error) {
    result.errorType = error.constructor.name || "Error";
    result.errorMessage = error.message;
    result.errorStack = error.stack?.split("\n").slice(0, 8).join("\n");

    // Capture cause chain
    if ("cause" in error && error.cause) {
      result.errorCause = enrichError(error.cause);
    }

    // Common error properties
    if ("code" in error) result.errorCode = (error as any).code;
    if ("errno" in error) result.errorErrno = (error as any).errno;
    if ("statusCode" in error)
      result.errorStatusCode = (error as any).statusCode;

    // HTTP response
    if ("response" in error) {
      const resp = (error as any).response;
      if (resp?.status) result.httpStatus = resp.status;
      if (resp?.statusText) result.httpStatusText = resp.statusText;
    }

    // Prisma errors
    if ("meta" in error) result.prismaMeta = (error as any).meta;
  } else if (typeof error === "object") {
    result.errorType = (error as any).constructor?.name || "Object";
    result.errorMessage =
      (error as any).message || JSON.stringify(error).substring(0, 500);
  } else {
    result.errorType = typeof error;
    result.errorMessage = String(error);
  }

  return result;
}
