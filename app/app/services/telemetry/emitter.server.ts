/**
 * Telemetry Emitter
 *
 * CRITICAL: This module must NEVER throw exceptions or block the render path.
 * All operations are fire-and-forget with internal error handling.
 */

import prisma from "~/db.server";
import { Severity, SCHEMA_VERSION, MAX_PAYLOAD_SIZE } from "./constants";
import type { TelemetryEventInput } from "./types";

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
  let overflowArtifactId: string | undefined;

  // Truncate payload if too large
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > MAX_PAYLOAD_SIZE) {
    // TODO: Store overflow in artifact and link via overflowArtifactId
    // For now, truncate
    payload = {
      _truncated: true,
      _originalSize: payloadStr.length,
      ...Object.fromEntries(Object.entries(payload).slice(0, 10)),
    };
  }

  await prisma.monitorEvent.create({
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
      overflowArtifactId,
      schemaVersion: SCHEMA_VERSION,
    },
  });
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
