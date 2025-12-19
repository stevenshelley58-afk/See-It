import { json, type ActionFunctionArgs, unstable_parseMultipartFormData } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";
import { validateContentType } from "../utils/validation.server";

// Maximum file size: 10MB
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Direct upload endpoint - accepts multipart form data with the image file
 * This bypasses the need for CORS on GCS bucket
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403 });
    }

    const shopDomain = session.shop;

    // Shop must exist from installation
    const shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
        console.error(`[RoomUploadDirect] Shop not found: ${shopDomain}`);
        return json({
            status: "error",
            message: "Shop not found. Please reinstall the app."
        }, { status: 404 });
    }

    // Parse multipart form data
    let fileBuffer: Buffer | null = null;
    let contentType = "image/jpeg";
    let filename = "room.jpg";

    try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        
        if (!file) {
            return json({ status: "error", message: "No file provided" }, { status: 400 });
        }

        // Validate content type
        const validation = validateContentType(file.type);
        if (!validation.valid) {
            return json({
                status: "error",
                message: validation.error,
                allowed_types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
            }, { status: 400 });
        }
        contentType = validation.sanitized!;

        // Check file size
        if (file.size > MAX_FILE_SIZE_BYTES) {
            return json({
                status: "error",
                message: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`
            }, { status: 400 });
        }

        // Read file into buffer
        const arrayBuffer = await file.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);

        // Determine extension
        const extensionMap: Record<string, string> = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/heic": "heic",
            "image/heif": "heif"
        };
        const extension = extensionMap[contentType] || "jpg";
        filename = `room.${extension}`;

    } catch (error) {
        console.error(`[RoomUploadDirect] Failed to parse form data:`, error);
        return json({
            status: "error",
            message: "Failed to parse upload"
        }, { status: 400 });
    }

    // Create room session
    const roomSession = await prisma.roomSession.create({
        data: {
            shopId: shop.id,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        }
    });

    try {
        // Upload directly to GCS
        const key = `rooms/${shop.id}/${roomSession.id}/${filename}`;
        const publicUrl = await StorageService.uploadBuffer(fileBuffer, key, contentType);

        // Update session with the key and URL
        await prisma.roomSession.update({
            where: { id: roomSession.id },
            data: {
                originalRoomImageKey: key,
                originalRoomImageUrl: publicUrl,
            }
        });

        console.log(`[RoomUploadDirect] Uploaded ${fileBuffer.length} bytes for session ${roomSession.id}`);

        return json({
            room_session_id: roomSession.id,
            room_image_url: publicUrl,
            sessionId: roomSession.id,
            roomImageUrl: publicUrl,
            uploadComplete: true
        });

    } catch (error) {
        // Clean up on failure
        await prisma.roomSession.delete({ where: { id: roomSession.id } }).catch(() => {});
        console.error(`[RoomUploadDirect] Upload failed for session ${roomSession.id}:`, error);
        return json({
            status: "error",
            message: "Upload failed. Please try again."
        }, { status: 500 });
    }
};

