import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * POST /api/products/regenerate-prompt
 *
 * Deprecated: The "See It Now" variant library system has been removed.
 * This endpoint is kept for compatibility but performs no operations.
 */
export const action = async ({ request }) => {
    const requestId = `regenerate-prompt-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "regenerate-prompt", {});

    try {
        await authenticate.admin(request);
        logger.info(logContext, "Regenerate prompt endpoint called (deprecated/no-op).");

        return json({
            success: true,
            prompt: null,
            archetype: null,
            variants: [],
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Regenerate prompt failed (deprecated): ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};
