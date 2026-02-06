/**
 * OpenTelemetry Initialization
 *
 * Configures distributed tracing with Google Cloud Trace.
 * MUST be imported before any other modules that need instrumentation.
 *
 * CRITICAL: All initialization is wrapped in try/catch so the app
 * continues to function even if tracing setup fails.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { Resource } from "@opentelemetry/resources";
// semantic-conventions is CommonJS, must use default import
import semconv from "@opentelemetry/semantic-conventions";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { trace, context, SpanStatusCode, type Span } from "@opentelemetry/api";
import * as grpc from "@grpc/grpc-js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = semconv as any;
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME: string =
  (semconv as any).ATTR_DEPLOYMENT_ENVIRONMENT_NAME ||
  "deployment.environment.name";

// Re-export for use in other modules
export { trace, context, SpanStatusCode, type Span };

const SERVICE_NAME = "see-it-app";
const SERVICE_VERSION = process.env.npm_package_version || "1.0.0";
const ENVIRONMENT = process.env.NODE_ENV || "development";

// Google Cloud Trace endpoint
const GOOGLE_TRACE_ENDPOINT = "cloudtrace.googleapis.com:443";

let sdk: NodeSDK | null = null;
let initialized = false;

/**
 * Setup Google Cloud credentials from GOOGLE_CREDENTIALS_JSON env var.
 * Writes the decoded JSON to a temp file and sets GOOGLE_APPLICATION_CREDENTIALS.
 */
function setupCredentials(): boolean {
  // Already have file-based credentials
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return true;
  }

  // Check for base64-encoded credentials (used in Railway/production)
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  if (credentialsJson) {
    try {
      const decoded = Buffer.from(credentialsJson, "base64").toString("utf-8");
      // Validate it's valid JSON
      JSON.parse(decoded);

      // Write to temp file
      const tempDir = os.tmpdir();
      const credPath = path.join(tempDir, "gcp-credentials.json");
      fs.writeFileSync(credPath, decoded, { mode: 0o600 });

      // Set the env var for OTEL and other GCP libraries
      process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
      console.log("[OTEL] Wrote GCP credentials to temp file");
      return true;
    } catch (error) {
      console.error(
        "[OTEL] Failed to decode GOOGLE_CREDENTIALS_JSON:",
        error instanceof Error ? error.message : error
      );
      return false;
    }
  }

  // Check for GCP default credentials (running on GCP)
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return true;
  }

  return false;
}

/**
 * Initialize OpenTelemetry SDK with Google Cloud Trace exporter.
 * Safe to call multiple times - only initializes once.
 */
export function initTracing(): boolean {
  if (initialized) {
    return sdk !== null;
  }
  initialized = true;

  // Skip in test environment
  if (process.env.NODE_ENV === "test") {
    console.log("[OTEL] Skipping tracing initialization in test environment");
    return false;
  }

  // Setup credentials from various sources
  if (!setupCredentials()) {
    console.log(
      "[OTEL] No Google Cloud credentials found - tracing disabled. " +
        "Set GOOGLE_CREDENTIALS_JSON, GOOGLE_APPLICATION_CREDENTIALS, or run on GCP."
    );
    return false;
  }

  try {
    // Create OTLP exporter for Google Cloud Trace
    // Uses Application Default Credentials (ADC) for authentication
    const exporter = new OTLPTraceExporter({
      url: `https://${GOOGLE_TRACE_ENDPOINT}`,
      credentials: grpc.credentials.createSsl(),
    });

    // Create resource describing the service
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: ENVIRONMENT,
    });

    // Initialize the SDK with Prisma instrumentation
    sdk = new NodeSDK({
      resource,
      traceExporter: exporter,
      instrumentations: [new PrismaInstrumentation()],
    });

    // Start the SDK
    sdk.start();

    console.log(
      `[OTEL] Tracing initialized: service=${SERVICE_NAME}, version=${SERVICE_VERSION}, env=${ENVIRONMENT}`
    );

    // Graceful shutdown on process exit
    process.on("SIGTERM", () => {
      sdk
        ?.shutdown()
        .then(() => console.log("[OTEL] Tracing shut down"))
        .catch((err) => console.error("[OTEL] Shutdown error:", err));
    });

    return true;
  } catch (error) {
    console.error(
      "[OTEL] Failed to initialize tracing - app will continue without traces:",
      error instanceof Error ? error.message : error
    );
    sdk = null;
    return false;
  }
}

/**
 * Get the tracer for creating spans.
 */
export function getTracer(name = SERVICE_NAME) {
  return trace.getTracer(name, SERVICE_VERSION);
}

/**
 * Create a span for an operation and execute the callback within it.
 * Safe wrapper that handles errors and always ends the span.
 *
 * @example
 * const result = await withSpan('render.variant', { variantId: 'v1' }, async (span) => {
 *   // Your code here
 *   span.setAttribute('output.size', 12345);
 *   return await renderVariant(variantId);
 * });
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> = {},
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name, { attributes });

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () =>
      fn(span)
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    if (error instanceof Error) {
      span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Get the current trace ID from the active context.
 * Returns null if no active trace.
 */
export function getCurrentTraceId(): string | null {
  const span = trace.getSpan(context.active());
  if (!span) return null;
  const ctx = span.spanContext();
  return ctx.traceId || null;
}

/**
 * Get the current span ID from the active context.
 * Returns null if no active span.
 */
export function getCurrentSpanId(): string | null {
  const span = trace.getSpan(context.active());
  if (!span) return null;
  const ctx = span.spanContext();
  return ctx.spanId || null;
}

// Auto-initialize on import
initTracing();
