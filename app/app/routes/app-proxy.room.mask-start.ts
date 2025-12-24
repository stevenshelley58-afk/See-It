import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";
import { validateSessionId, validateContentType } from "../utils/validation.server";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * POST /apps/see-it/room/mask-start
 * 
 * Creates a presigned upload URL for a mask image.
 * Used when mask is too large to send inline.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    const logContext = createLogContext("mask-start", "start", "init", {});

    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const shopDomain = session.shop;

    // Parse request body
    let body: any;
    let contentType = "image/png"; // Default for masks
    try {
        body = await request.json();
        if (body.content_type || body.contentType) {
            const requestedType = body.content_type || body.contentType;
            const validation = validateContentType(requestedType);
            if (!validation.valid) {
                return json({
                    status: "error",
                    message: validation.error,
                    allowed_types: ["image/png", "image/jpeg"]
                }, { status: 400 });
            }
            contentType = validation.sanitized!;
        }
    } catch {
        // No body or invalid JSON - use defaults
        body = {};
    }

    const { room_session_id } = body;

    // Validate session ID
    const sessionResult = validateSessionId(room_session_id);
    if (!sessionResult.valid) {
        return json({ error: sessionResult.error }, { status: 400 });
    }
    const sanitizedSessionId = sessionResult.sanitized!;

    // Shop must exist from installation
    const shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
        logger.error(
            { ...logContext, stage: "shop-lookup" },
            `Shop not found in database: ${shopDomain}. App may not be properly installed.`
        );
        return json({
            status: "error",
            message: "Shop not found. Please reinstall the app."
        }, { status: 404 });
    }

    // Verify room session exists and belongs to shop
    const roomSession = await prisma.roomSession.findUnique({
        where: { id: sanitizedSessionId },
        include: { shop: true }
    });

    if (!roomSession || roomSession.shop.shopDomain !== shopDomain) {
        return json({ error: "Room session not found" }, { status: 404 });
    }

    // Determine file extension from content type
    const extensionMap: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg"
    };
    const extension = extensionMap[contentType] || "png";
    const filename = `mask.${extension}`;

    try {
        const { uploadUrl, publicUrl, key } = await StorageService.getPresignedUploadUrl(
            shop.id,
            roomSession.id,
            filename,
            contentType
        );

        logger.info(
            { ...logContext, stage: "complete" },
            `Created mask upload URL for session ${roomSession.id}, key: ${key}`
        );

        // Return both spec-aligned snake_case fields and camelCase for compatibility
        return json({
            upload_url: uploadUrl,
            mask_image_key: key,
            mask_image_url: publicUrl,
            uploadUrl: uploadUrl,
            maskImageKey: key,
            maskImageUrl: publicUrl
        });
    } catch (error) {
        logger.error(
            { ...logContext, stage: "error" },
            `Failed to generate presigned URL for mask upload: ${error}`,
            error
        );
        return json({
            status: "error",
            message: "Failed to prepare mask upload. Please try again."
        }, { status: 500 });
    }
};

