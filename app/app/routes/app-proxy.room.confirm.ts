import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";
import { validateSessionId } from "../utils/validation.server";
import sharp from "sharp";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import { getCorsHeaders } from "../services/cors.server";

const MAX_ORIGINAL_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_CANONICAL_EDGE_PX = 2048;

function clampInt(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.trunc(n)));
}

async function downloadToBuffer(url: string, maxBytes: number): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new Error(`Failed to download image: ${res.status}`);
        }

        const contentLength = res.headers.get("content-length");
        if (contentLength) {
            const len = Number(contentLength);
            if (Number.isFinite(len) && len > maxBytes) {
                throw new Error(`Image too large (${Math.round(len / 1024 / 1024)}MB). Please upload a smaller image.`);
            }
        }

        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > maxBytes) {
            throw new Error(`Image too large (${Math.round(buf.length / 1024 / 1024)}MB). Please upload a smaller image.`);
        }
        if (buf.length === 0) {
            throw new Error("Empty image");
        }
        return buf;
    } catch (err: any) {
        if (err?.name === "AbortError") {
            throw new Error("Timed out downloading image. Please try again.");
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const requestId = getRequestId(request);
    const logContext = createLogContext("system", requestId, "start", {});

    const { session } = await authenticate.public.appProxy(request);
    const corsHeaders = getCorsHeaders(session?.shop ?? null);

    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const { room_session_id, crop_params } = body;

    // Validate session ID
    const sessionResult = validateSessionId(room_session_id);
    if (!sessionResult.valid) {
        return json({ error: sessionResult.error }, { status: 400, headers: corsHeaders });
    }
    const sanitizedSessionId = sessionResult.sanitized!;

    const roomSession = await prisma.roomSession.findUnique({
        where: { id: sanitizedSessionId },
        include: { shop: true }
    });

    if (!roomSession || roomSession.shop.shopDomain !== session.shop) {
        return json({ error: "Session not found" }, { status: 404, headers: corsHeaders });
    }

    // Use stored key if available, otherwise construct it (for legacy sessions)
    const originalKey = roomSession.originalRoomImageKey || `rooms/${roomSession.shopId}/${roomSession.id}/room.jpg`;

    // Check if file exists
    const fileExists = await StorageService.fileExists(originalKey);
    if (!fileExists) {
        return json({ error: "Room image not uploaded yet" }, { status: 400, headers: corsHeaders });
    }

    // If canonical already exists and we aren't changing crop params, just return it.
    if (!crop_params && roomSession.canonicalRoomImageKey) {
        const canonicalUrl = await StorageService.getSignedReadUrl(roomSession.canonicalRoomImageKey, 60 * 60 * 1000);
        await prisma.roomSession.update({
            where: { id: sanitizedSessionId },
            data: { lastUsedAt: new Date() }
        });
        return json({
            ok: true,
            canonical_room_image_url: canonicalUrl,
            canonical_width: roomSession.canonicalRoomWidth || null,
            canonical_height: roomSession.canonicalRoomHeight || null,
            ratio_label: roomSession.canonicalRoomRatioLabel || null,
            room_image_url: canonicalUrl,
            roomImageUrl: canonicalUrl
        }, { headers: corsHeaders });
    }

    // Always generate a canonical JPEG, even if no crop params are provided.
    // This makes downstream cleanup/rendering robust across formats (png/webp/heic/etc) and aspect ratios.
    try {
        logger.info(
            { ...logContext, sessionId: sanitizedSessionId },
            crop_params
                ? `Generating canonical room image with crop params: ${JSON.stringify(crop_params)}`
                : "Generating canonical room image (no crop params)"
        );

        const originalUrl = await StorageService.getSignedReadUrl(originalKey, 60 * 60 * 1000);
        const originalBuffer = await downloadToBuffer(originalUrl, MAX_ORIGINAL_DOWNLOAD_BYTES);

        // Rotate first (auto-orient), then process
        const rotated = sharp(originalBuffer).rotate();
        const rotatedMeta = await rotated.metadata();
        const orientedWidth = rotatedMeta.width || 0;
        const orientedHeight = rotatedMeta.height || 0;
        if (!orientedWidth || !orientedHeight) {
            throw new Error("Uploaded image is not a supported image format.");
        }

        let pipeline = rotated;
        let ratioLabel: string | null = null;
        let ratioValue: number | null = null;
        let cropToStore: any = null;

        if (crop_params) {
            const { ratio_label, ratio_value, crop_rect_norm } = crop_params;
            ratioLabel = ratio_label ?? null;
            ratioValue = ratio_value ?? null;
            cropToStore = crop_params;

            if (!crop_rect_norm || typeof crop_rect_norm.x !== 'number' || typeof crop_rect_norm.y !== 'number' ||
                typeof crop_rect_norm.w !== 'number' || typeof crop_rect_norm.h !== 'number') {
                throw new Error("Invalid crop_rect_norm format");
            }

            const rawX = Math.round(crop_rect_norm.x * orientedWidth);
            const rawY = Math.round(crop_rect_norm.y * orientedHeight);
            const rawW = Math.round(crop_rect_norm.w * orientedWidth);
            const rawH = Math.round(crop_rect_norm.h * orientedHeight);

            // Clamp extract to image bounds (prevents out-of-bounds errors on odd aspect ratios/rounding)
            const left = clampInt(rawX, 0, orientedWidth - 1);
            const top = clampInt(rawY, 0, orientedHeight - 1);
            const width = clampInt(rawW, 1, orientedWidth - left);
            const height = clampInt(rawH, 1, orientedHeight - top);

            logger.info(
                { ...logContext, stage: "crop-calc" },
                `Crop rect: ${left},${top},${width}x${height} (from norm: ${JSON.stringify(crop_rect_norm)}, oriented: ${orientedWidth}x${orientedHeight})`
            );

            pipeline = pipeline.extract({ left, top, width, height });
        }

        const canonicalBuffer = await pipeline
            .resize({
                width: MAX_CANONICAL_EDGE_PX,
                height: MAX_CANONICAL_EDGE_PX,
                fit: "inside",
                withoutEnlargement: true,
            })
            .jpeg({ quality: 90 })
            .toBuffer();

        const canonicalMeta = await sharp(canonicalBuffer).metadata();
        const canonicalWidth = canonicalMeta.width || 0;
        const canonicalHeight = canonicalMeta.height || 0;
        if (!canonicalWidth || !canonicalHeight) {
            throw new Error("Failed to generate canonical image dimensions");
        }

        const canonicalKey = `rooms/${roomSession.shopId}/${sanitizedSessionId}/canonical.jpg`;
        const canonicalUrl = await StorageService.uploadBuffer(canonicalBuffer, canonicalKey, "image/jpeg");

        await prisma.roomSession.update({
            where: { id: sanitizedSessionId },
            data: {
                canonicalRoomImageKey: canonicalKey,
                canonicalRoomWidth: canonicalWidth,
                canonicalRoomHeight: canonicalHeight,
                canonicalRoomRatioLabel: ratioLabel,
                canonicalRoomRatioValue: ratioValue,
                canonicalRoomCrop: cropToStore,
                canonicalCreatedAt: new Date(),
                // Keep original key/url around, but ensure key is always set
                originalRoomImageKey: originalKey,
                // Invalidate Gemini URI since room image changed
                geminiFileUri: null,
                geminiFileExpiresAt: null,
                lastUsedAt: new Date(),
            }
        });

        return json({
            ok: true,
            canonical_room_image_url: canonicalUrl,
            canonical_width: canonicalWidth,
            canonical_height: canonicalHeight,
            ratio_label: ratioLabel,
            room_image_url: canonicalUrl,
            roomImageUrl: canonicalUrl
        }, { headers: corsHeaders });
    } catch (error) {
        logger.error(
            { ...logContext, stage: "canonical-error" },
            "Failed to generate canonical room image",
            error
        );

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return json({
            error: "canonicalization_failed",
            message: errorMessage,
            hint: "Try uploading a JPG, PNG, or WebP under 25MB."
        }, { status: 500, headers: corsHeaders });
    }
};
