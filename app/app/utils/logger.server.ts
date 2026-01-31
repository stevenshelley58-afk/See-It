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
 *
 * ERROR LOGS automatically capture:
 * - Full error type, message, and stack trace
 * - Cause chain (for nested errors)
 * - System info (memory, uptime)
 * - Environment context
 */

type LogLevel = "info" | "warn" | "error" | "debug";

type LogContext = {
  flow: "prepare" | "render" | "auth" | "shopify-sync" | "cleanup" | "system";
  shopId?: string | null;
  productId?: string | null;
  assetId?: string | null;
  requestId: string;
   traceId?: string;
  stage: string;
  [key: string]: unknown;
};

/**
 * Extract rich error details from any error type
 * Automatically captures type, message, stack, cause chain, and common error properties
 */
function enrichError(error: unknown): Record<string, unknown> {
  if (!error) return { errorType: 'null', errorMessage: 'No error provided' };

  const result: Record<string, unknown> = {};

  if (error instanceof Error) {
    result.errorType = error.constructor.name || 'Error';
    result.errorMessage = error.message;
    result.errorStack = error.stack?.split('\n').slice(0, 8).join('\n'); // First 8 lines

    // Capture cause chain (modern Error.cause support)
    if ('cause' in error && error.cause) {
      result.errorCause = enrichError(error.cause);
    }

    // Common error properties
    if ('code' in error) result.errorCode = (error as any).code;
    if ('errno' in error) result.errorErrno = (error as any).errno;
    if ('syscall' in error) result.errorSyscall = (error as any).syscall;
    if ('hostname' in error) result.errorHostname = (error as any).hostname;
    if ('statusCode' in error) result.errorStatusCode = (error as any).statusCode;
    if ('response' in error) {
      const resp = (error as any).response;
      if (resp?.status) result.httpStatus = resp.status;
      if (resp?.statusText) result.httpStatusText = resp.statusText;
    }

    // GraphQL errors
    if ('errors' in error) result.graphqlErrors = (error as any).errors;

    // Prisma errors
    if ('meta' in error) result.prismaMeta = (error as any).meta;
    if ('clientVersion' in error) result.prismaVersion = (error as any).clientVersion;

  } else if (typeof error === 'object') {
    result.errorType = (error as any).constructor?.name || 'Object';
    result.errorMessage = (error as any).message || JSON.stringify(error).substring(0, 500);
    result.errorRaw = JSON.stringify(error).substring(0, 1000);
  } else {
    result.errorType = typeof error;
    result.errorMessage = String(error);
  }

  return result;
}

/**
 * Get system context for error debugging
 */
function getSystemContext(): Record<string, unknown> {
  const memUsage = process.memoryUsage();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    uptime: Math.round(process.uptime()),
    memoryMB: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
    env: process.env.NODE_ENV || 'unknown',
  };
}

class StructuredLogger {
  private formatMessage(level: LogLevel, context: LogContext, message: string): string {
    const timestamp = new Date().toISOString();
    const contextStr = JSON.stringify(context);
    return `[${timestamp}] [${level.toUpperCase()}] ${message} | ${contextStr}`;
  }

  info(context: LogContext, message: string): void {
    console.log(this.formatMessage("info", context, message));
  }

  warn(context: LogContext, message: string, error?: Error | unknown): void {
    const warnContext = { ...context };
    if (error) {
      Object.assign(warnContext, enrichError(error));
    }
    console.warn(this.formatMessage("warn", warnContext, message));
  }

  /**
   * Log error with FULL context automatically captured:
   * - Error type, message, stack trace (first 8 lines)
   * - Cause chain for nested errors
   * - Common error codes (HTTP, system, Prisma, GraphQL)
   * - System info (memory, Node version, uptime)
   */
  error(context: LogContext, message: string, error?: Error | unknown): void {
    const errorContext = {
      ...context,
      ...enrichError(error),
      system: getSystemContext(),
    };
    console.error(this.formatMessage("error", errorContext, message));
  }

  debug(context: LogContext, message: string): void {
    console.debug(this.formatMessage("debug", context, message));
  }
}

export const logger = new StructuredLogger();

/**
 * Export enrichError for use in error responses and other contexts
 * where you need the full error details outside of logging
 */
export { enrichError };

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
  const traceId = overrides?.traceId ?? requestId;
  const effectiveRequestId = overrides?.requestId ?? traceId ?? requestId;

  return {
    flow,
    stage,
    shopId: null,
    productId: null,
    assetId: null,
    ...overrides,
    // Ensure requestId/traceId are never undefined even if overrides lacked them
    requestId: overrides?.requestId ?? effectiveRequestId,
    traceId: overrides?.traceId ?? traceId,
  };
}






