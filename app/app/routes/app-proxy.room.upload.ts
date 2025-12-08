import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";
import { validateContentType } from "../utils/validation.server";

// Maximum file size: 10MB
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Spec alignment: external path /apps/see-it/room/upload (spec Routes → Storefront app proxy routes)
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const shopDomain = session.shop;

    // Parse request body for content type validation
    let contentType = "image/jpeg"; // Default
    try {
        const body = await request.json();
        if (body.content_type || body.contentType) {
            const requestedType = body.content_type || body.contentType;
            const validation = validateContentType(requestedType);
            if (!validation.valid) {
                return json({
                    status: "error",
                    message: validation.error,
                    allowed_types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
                }, { status: 400 });
            }
            contentType = validation.sanitized!;
        }
    } catch {
        // No body or invalid JSON - use defaults
    }

    // Shop must exist from installation - do not create stubs
    const shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
        console.error(`[RoomUpload] Shop not found in database: ${shopDomain}. App may not be properly installed.`);
        return json({
            status: "error",
            message: "Shop not found. Please reinstall the app."
        }, { status: 404 });
    }

    // Determine file extension from content type
    const extensionMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/heic": "heic",
        "image/heif": "heif"
    };
    const extension = extensionMap[contentType] || "jpg";
    const filename = `room.${extension}`;

    const roomSession = await prisma.roomSession.create({
        data: {
            shopId: shop.id,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        }
    });

    try {
        const { uploadUrl, publicUrl, key } = await StorageService.getPresignedUploadUrl(
            shop.id,
            roomSession.id,
            filename,
            contentType
        );

        // Store the stable GCS key for future URL generation
        await prisma.roomSession.update({
            where: { id: roomSession.id },
            data: {
                originalRoomImageKey: key,
            }
        });

        console.log(`[RoomUpload] Created session ${roomSession.id} for shop ${shopDomain} with content type ${contentType}`);

        // Return both spec-aligned snake_case fields and existing camelCase for compatibility
        return json({
            room_session_id: roomSession.id,
            upload_url: uploadUrl,
            room_image_future_url: publicUrl,
            content_type: contentType,
            max_file_size_bytes: MAX_FILE_SIZE_BYTES,
            max_file_size_mb: MAX_FILE_SIZE_BYTES / (1024 * 1024),
            sessionId: roomSession.id,
            uploadUrl: uploadUrl,
            roomImageFutureUrl: publicUrl
        });
    } catch (error) {
        // Clean up the room session if presigned URL generation fails
        await prisma.roomSession.delete({ where: { id: roomSession.id } }).catch(() => {});
        console.error(`[RoomUpload] Failed to generate presigned URL for session ${roomSession.id}:`, error);
        return json({
            status: "error",
            message: "Failed to prepare upload. Please try again."
        }, { status: 500 });
    }
};

