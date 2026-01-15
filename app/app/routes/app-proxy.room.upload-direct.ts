/**
 * Direct upload route - handles room image uploads directly to GCS
 *
 * This route receives the image data directly in the request body
 * and uploads it to GCS, returning the resulting URL.
 */
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";
import { logger, createLogContext } from "../utils/logger.server";
import sharp from "sharp";

// Maximum file size: 10MB
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ROOM_EDGE_PX = 2048;

export const action = async ({ request }: ActionFunctionArgs) => {
    const logContext = createLogContext("upload", "direct", "start", {});

    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const shopDomain = session.shop;

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

    try {
        // Get the content type from the request
        const contentType = request.headers.get("content-type") || "image/jpeg";

        // Determine file extension from content type
        const extensionMap: Record<string, string> = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/heic": "heic",
            "image/heif": "heif"
        };

        // Handle multipart form data
        let imageBuffer: Buffer;
        let finalContentType = contentType;

        if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const file = formData.get("file") as File | null;

            if (!file) {
                return json({
                    status: "error",
                    message: "No file provided"
                }, { status: 400 });
            }

            if (file.size > MAX_FILE_SIZE_BYTES) {
                return json({
                    status: "error",
                    message: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`
                }, { status: 400 });
            }

            finalContentType = file.type || "image/jpeg";
            const arrayBuffer = await file.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);
        } else {
            // Direct binary upload
            const arrayBuffer = await request.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);

            if (imageBuffer.length > MAX_FILE_SIZE_BYTES) {
                return json({
                    status: "error",
                    message: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`
                }, { status: 400 });
            }
        }

        if (imageBuffer.length === 0) {
            return json({
                status: "error",
                message: "Empty file received"
            }, { status: 400 });
        }

        // Normalize the uploaded image into a canonical JPEG.
        // This makes downstream cleanup/rendering robust across formats + EXIF orientations.
        let canonicalBuffer: Buffer;
        try {
            canonicalBuffer = await sharp(imageBuffer)
                .rotate()
                .resize({
                    width: MAX_ROOM_EDGE_PX,
                    height: MAX_ROOM_EDGE_PX,
                    fit: "inside",
                    withoutEnlargement: true
                })
                .jpeg({ quality: 90 })
                .toBuffer();

            const meta = await sharp(canonicalBuffer).metadata();
            if (!meta.width || !meta.height) {
                throw new Error("Missing dimensions");
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(
                { ...logContext, stage: "normalize-failed", contentType: finalContentType },
                `Failed to decode/normalize uploaded room image: ${message}`
            );
            return json({
                status: "error",
                message: "Unsupported image format. Please upload a JPG, PNG, or WebP.",
            }, { status: 400 });
        }

        const filename = `room-${Date.now()}.jpg`;

        // Create room session
        const roomSession = await prisma.roomSession.create({
            data: {
                shopId: shop.id,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
            }
        });

        // Upload directly to GCS
        const key = `rooms/${shop.id}/${roomSession.id}/${filename}`;
        // Note: uploadBuffer signature is (buffer, key, contentType)
        const publicUrl = await StorageService.uploadBuffer(canonicalBuffer, key, "image/jpeg");

        // Store the GCS key for future URL generation
        await prisma.roomSession.update({
            where: { id: roomSession.id },
            data: {
                originalRoomImageKey: key,
            }
        });

        logger.info(
            { ...logContext, stage: "complete" },
            `Direct upload complete: session=${roomSession.id}, size=${imageBuffer.length}, key=${key}`
        );

        return json({
            status: "success",
            room_session_id: roomSession.id,
            room_image_url: publicUrl,
            sessionId: roomSession.id,
            roomImageUrl: publicUrl
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            { ...logContext, stage: "error" },
            `Direct upload failed: ${errorMessage}`,
            error
        );
        return json({
            status: "error",
            message: "Failed to upload image. Please try again."
        }, { status: 500 });
    }
};
