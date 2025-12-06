/**
 * Structured logger for See It app
 *
 * Every log must include:
 * - flow: "prepare" | "render" | "auth" | "shopify-sync" | "cleanup" | "system"
 * - shopId: string | null
 * - productId: string | null
 * - assetId: string | null
 * - requestId: string (UUID per HTTP request)
 * - stage: string (e.g., "download", "convert", "bg-remove", "upload", "db-update")
 */

type LogLevel = "info" | "warn" | "error" | "debug";

type LogContext = {
  flow: "prepare" | "render" | "auth" | "shopify-sync" | "cleanup" | "system";
  shopId?: string | null;
  productId?: string | null;
  assetId?: string | null;
  requestId: string;
  stage: string;
  [key: string]: unknown;
};

class StructuredLogger {
  private formatMessage(level: LogLevel, context: LogContext, message: string): string {
    const timestamp = new Date().toISOString();
    const contextStr = JSON.stringify(context);
    return `[${timestamp}] [${level.toUpperCase()}] ${message} | ${contextStr}`;
  }

  info(context: LogContext, message: string): void {
    console.log(this.formatMessage("info", context, message));
  }

  warn(context: LogContext, message: string): void {
    console.warn(this.formatMessage("warn", context, message));
  }

  error(context: LogContext, message: string, error?: Error | unknown): void {
    const errorContext = { ...context };
    if (error instanceof Error) {
      errorContext.errorMessage = error.message;
      errorContext.errorStack = error.stack;
      errorContext.errorName = error.name;
    } else if (error) {
      errorContext.error = String(error);
    }
    console.error(this.formatMessage("error", errorContext, message));
  }

  debug(context: LogContext, message: string): void {
    console.debug(this.formatMessage("debug", context, message));
  }
}

export const logger = new StructuredLogger();

/**
 * Generate a request ID (UUID v4)
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Create a log context with defaults
 */
export function createLogContext(
  flow: LogContext["flow"],
  requestId: string,
  stage: string,
  overrides?: Partial<LogContext>
): LogContext {
  return {
    flow,
    requestId,
    stage,
    shopId: null,
    productId: null,
    assetId: null,
    ...overrides,
  };
}
