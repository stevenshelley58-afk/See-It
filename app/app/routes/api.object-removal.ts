import { json, type ActionFunctionArgs } from "@remix-run/node";
import { removeObjects, isObjectRemovalAvailable } from "../services/object-removal.server";
import { logger, createLogContext, generateRequestId } from "../utils/logger.server";

/**
 * POST /api/object-removal
 *
 * Standalone mask-driven object removal endpoint.
 *
 * Request body:
 * {
 *   "image": "data:image/png;base64,..." or raw base64,
 *   "mask": "data:image/png;base64,..." or raw base64 (white=remove, black=keep)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "image": "data:image/png;base64,...",
 *   "processingTimeMs": 450,
 *   "maskCoveragePercent": 15.3
 * }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    const requestId = generateRequestId();
    const logContext = createLogContext("cleanup", requestId, "object-removal-api", {});

    if (!isObjectRemovalAvailable()) {
        return json({ success: false, error: "Service unavailable" }, { status: 503 });
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return json({ success: false, error: "Invalid JSON" }, { status: 400 });
    }

    const { image, mask } = body;

    if (!image || !mask) {
        return json({ success: false, error: "Missing image or mask" }, { status: 400 });
    }

    try {
        const imageBuffer = parseBase64(image);
        const maskBuffer = parseBase64(mask);

        logger.info(logContext, `Object removal: image=${imageBuffer.length}b, mask=${maskBuffer.length}b`);

        const result = await removeObjects({ imageBuffer, maskBuffer, requestId });

        return json({
            success: true,
            image: `data:image/png;base64,${result.imageBuffer.toString('base64')}`,
            processingTimeMs: result.processingTimeMs,
            maskCoveragePercent: result.maskCoveragePercent
        });

    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Object removal failed: ${msg}`, error);
        return json({ success: false, error: msg }, { status: 500 });
    }
};

function parseBase64(input: string): Buffer {
    const match = input.match(/^data:image\/\w+;base64,(.+)$/);
    return Buffer.from(match ? match[1] : input, 'base64');
}

export const loader = () => json({ error: "Use POST" }, { status: 405 });
