/**
 * Shopify API Error Handling Wrapper
 *
 * Provides utilities for making Shopify Admin API calls with:
 * - Automatic error handling and logging
 * - User-friendly error messages
 * - Rate limit handling
 * - Retry logic for transient failures
 */

import { logger, generateRequestId, createLogContext } from "./logger.server";

// Shopify Admin client type (from authenticate.admin)
type AdminClient = {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// Error types for different Shopify API failures
export type ShopifyApiErrorType =
    | "GRAPHQL_ERROR"        // GraphQL validation or execution error
    | "RATE_LIMITED"         // 429 Too Many Requests
    | "UNAUTHORIZED"         // 401 Authentication failure
    | "FORBIDDEN"            // 403 Permission denied
    | "NOT_FOUND"            // 404 Resource not found
    | "SERVER_ERROR"         // 5xx Server errors
    | "NETWORK_ERROR"        // Connection/timeout failures
    | "UNKNOWN";             // Unclassified errors

export interface ShopifyApiError {
    type: ShopifyApiErrorType;
    message: string;              // User-friendly message
    technicalDetails?: string;    // Technical details for logging
    retryable: boolean;           // Whether the request can be retried
    retryAfterMs?: number;        // Suggested retry delay
    statusCode?: number;          // HTTP status code if available
}

export interface ShopifyApiResult<T> {
    success: boolean;
    data?: T;
    error?: ShopifyApiError;
}

// User-friendly error messages by type
const USER_FRIENDLY_MESSAGES: Record<ShopifyApiErrorType, string> = {
    GRAPHQL_ERROR: "Unable to complete the request. Please try again.",
    RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
    UNAUTHORIZED: "Your session has expired. Please refresh the page.",
    FORBIDDEN: "You don't have permission to perform this action.",
    NOT_FOUND: "The requested resource was not found.",
    SERVER_ERROR: "Shopify is temporarily unavailable. Please try again later.",
    NETWORK_ERROR: "Unable to connect to Shopify. Please check your connection.",
    UNKNOWN: "An unexpected error occurred. Please try again."
};

/**
 * Parse GraphQL response errors into a structured format
 */
function parseGraphQLErrors(errors: Array<{ message: string; extensions?: Record<string, unknown> }>): {
    type: ShopifyApiErrorType;
    message: string;
    technicalDetails: string;
} {
    const errorMessages = errors.map(e => e.message);
    const technicalDetails = errorMessages.join("; ");

    // Check for specific error patterns
    const combined = technicalDetails.toLowerCase();

    if (combined.includes("throttled") || combined.includes("rate limit")) {
        return {
            type: "RATE_LIMITED",
            message: USER_FRIENDLY_MESSAGES.RATE_LIMITED,
            technicalDetails
        };
    }

    if (combined.includes("access denied") || combined.includes("unauthorized")) {
        return {
            type: "FORBIDDEN",
            message: USER_FRIENDLY_MESSAGES.FORBIDDEN,
            technicalDetails
        };
    }

    return {
        type: "GRAPHQL_ERROR",
        message: USER_FRIENDLY_MESSAGES.GRAPHQL_ERROR,
        technicalDetails
    };
}

/**
 * Determine error type from HTTP status code
 */
function errorTypeFromStatus(status: number): ShopifyApiErrorType {
    if (status === 401) return "UNAUTHORIZED";
    if (status === 403) return "FORBIDDEN";
    if (status === 404) return "NOT_FOUND";
    if (status === 429) return "RATE_LIMITED";
    if (status >= 500) return "SERVER_ERROR";
    return "UNKNOWN";
}

/**
 * Execute a Shopify GraphQL query with error handling
 */
export async function executeGraphQL<T>(
    admin: AdminClient,
    query: string,
    options?: {
        variables?: Record<string, unknown>;
        shopId?: string;
        context?: string;  // For logging (e.g., "fetchProducts", "updateProduct")
    }
): Promise<ShopifyApiResult<T>> {
    const requestId = generateRequestId();
    const logContext = createLogContext("shopify-sync", requestId, options?.context || "graphql", {
        shopId: options?.shopId
    });

    try {
        const response = await admin.graphql(query, {
            variables: options?.variables
        });

        // Check HTTP-level errors
        if (!response.ok) {
            const errorType = errorTypeFromStatus(response.status);
            const retryAfter = response.headers.get("Retry-After");

            const error: ShopifyApiError = {
                type: errorType,
                message: USER_FRIENDLY_MESSAGES[errorType],
                technicalDetails: `HTTP ${response.status}: ${response.statusText}`,
                retryable: errorType === "RATE_LIMITED" || errorType === "SERVER_ERROR",
                statusCode: response.status
            };

            if (retryAfter) {
                error.retryAfterMs = parseInt(retryAfter, 10) * 1000;
            } else if (errorType === "RATE_LIMITED") {
                error.retryAfterMs = 2000; // Default 2 second retry
            }

            logger.error(logContext, `Shopify API HTTP error: ${response.status}`);

            return { success: false, error };
        }

        const responseJson = await response.json();

        // Check for GraphQL errors
        if (responseJson.errors && responseJson.errors.length > 0) {
            const { type, message, technicalDetails } = parseGraphQLErrors(responseJson.errors);

            const error: ShopifyApiError = {
                type,
                message,
                technicalDetails,
                retryable: type === "RATE_LIMITED",
                retryAfterMs: type === "RATE_LIMITED" ? 2000 : undefined
            };

            logger.error(logContext, `Shopify GraphQL error: ${technicalDetails}`);

            // Some GraphQL errors come with partial data
            if (responseJson.data) {
                return { success: true, data: responseJson.data as T, error };
            }

            return { success: false, error };
        }

        // Success
        return { success: true, data: responseJson.data as T };

    } catch (err) {
        // Network or parsing errors
        const error: ShopifyApiError = {
            type: "NETWORK_ERROR",
            message: USER_FRIENDLY_MESSAGES.NETWORK_ERROR,
            technicalDetails: err instanceof Error ? err.message : String(err),
            retryable: true,
            retryAfterMs: 1000
        };

        logger.error(logContext, "Shopify API network error", err);

        return { success: false, error };
    }
}

/**
 * Execute a GraphQL query with automatic retry for transient failures
 */
export async function executeGraphQLWithRetry<T>(
    admin: AdminClient,
    query: string,
    options?: {
        variables?: Record<string, unknown>;
        shopId?: string;
        context?: string;
        maxRetries?: number;
        initialDelayMs?: number;
    }
): Promise<ShopifyApiResult<T>> {
    const maxRetries = options?.maxRetries ?? 3;
    const initialDelay = options?.initialDelayMs ?? 1000;

    let lastResult: ShopifyApiResult<T> | null = null;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        lastResult = await executeGraphQL<T>(admin, query, options);

        if (lastResult.success) {
            return lastResult;
        }

        // Don't retry non-retryable errors
        if (!lastResult.error?.retryable) {
            return lastResult;
        }

        // Don't retry on last attempt
        if (attempt === maxRetries) {
            break;
        }

        // Use error-suggested retry delay or exponential backoff
        const retryDelay = lastResult.error?.retryAfterMs ?? delay;
        console.log(`[ShopifyAPI] Retrying in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries})`);

        await new Promise(resolve => setTimeout(resolve, retryDelay));
        delay = Math.min(delay * 2, 10000); // Cap at 10 seconds
    }

    return lastResult!;
}

/**
 * Format a ShopifyApiError for JSON response
 */
export function formatErrorResponse(error: ShopifyApiError): {
    status: "error";
    message: string;
    code: ShopifyApiErrorType;
    retryable: boolean;
    retryAfterMs?: number;
} {
    return {
        status: "error",
        message: error.message,
        code: error.type,
        retryable: error.retryable,
        ...(error.retryAfterMs && { retryAfterMs: error.retryAfterMs })
    };
}

/**
 * Common GraphQL fragments for products
 */
export const PRODUCT_FRAGMENT = `
    fragment ProductFields on Product {
        id
        title
        handle
        featuredImage {
            id
            url
            altText
        }
        images(first: 10) {
            edges {
                node {
                    id
                    url
                    altText
                }
            }
        }
    }
`;

/**
 * Helper to extract numeric ID from Shopify GID
 */
export function extractNumericId(gid: string): string {
    const match = gid.match(/\/(\d+)$/);
    return match ? match[1] : gid;
}

/**
 * Helper to build a Shopify GID from numeric ID
 */
export function buildProductGid(numericId: string): string {
    if (numericId.startsWith("gid://")) {
        return numericId;
    }
    return `gid://shopify/Product/${numericId}`;
}
