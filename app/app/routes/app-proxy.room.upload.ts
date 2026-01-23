import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { StorageService } from "../services/storage.server";
import prisma from "../db.server";
import { validateContentType } from "../utils/validation.server";
import { PLANS } from "../billing";
import { emit, EventSource, EventType, Severity } from "../services/telemetry";
import { getRequestId } from "../utils/request-context.server";

// Maximum file size: 10MB
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function getCorsHeaders(shopDomain: string | null): Record<string, string> {
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    };
    if (shopDomain) {
        headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
    }
    return headers;
}

// Spec alignment: external path /apps/see-it/room/upload (spec Routes → Storefront app proxy routes)
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.public.appProxy(request);
    const corsHeaders = getCorsHeaders(session?.shop ?? null);

    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const shopDomain = session.shop;

    // Ensure shop exists (some stores may hit app proxy before opening embedded admin)
    // Use Admin API (available via authenticate.public.appProxy) to create a real shop record, not a stub.
    let shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
        try {
            if (!admin) {
                console.error(`[RoomUpload] Admin client missing for shop ${shopDomain}`);
                return json({
                    status: "error",
                    message: "App not fully initialized. Please try again."
                }, { status: 500, headers: corsHeaders });
            }

            const shopResponse = await admin.graphql(
                `#graphql
                  query {
                    shop {
                      id
                    }
                  }
                `
            );
            const shopData = await shopResponse.json();
            const rawId = shopData?.data?.shop?.id;
            const shopifyShopId = typeof rawId === "string"
                ? rawId.replace("gid://shopify/Shop/", "")
                : null;

            if (!shopifyShopId) {
                console.error(`[RoomUpload] Failed to fetch shop id from Admin API for ${shopDomain}`, shopData);
                return json({
                    status: "error",
                    message: "Shop initialization failed. Please try again."
                }, { status: 500, headers: corsHeaders });
            }

            shop = await prisma.shop.upsert({
                where: { shopDomain },
                update: {
                    accessToken: (session as any)?.accessToken || "pending",
                    uninstalledAt: null,
                },
                create: {
                    shopDomain,
                    shopifyShopId,
                    accessToken: (session as any)?.accessToken || "pending",
                    plan: PLANS.FREE.id,
                    dailyQuota: PLANS.FREE.dailyQuota,
                    monthlyQuota: PLANS.FREE.monthlyQuota,
                },
            });

            console.log(`[RoomUpload] Created missing shop record for ${shopDomain}`);
        } catch (error) {
            console.error(`[RoomUpload] Failed to create missing shop record for ${shopDomain}:`, error);
            return json({
                status: "error",
                message: "Shop initialization failed. Please try again."
            }, { status: 500, headers: corsHeaders });
        }
    }

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
                }, { status: 400, headers: corsHeaders });
            }
            contentType = validation.sanitized!;
        }
    } catch {
        // No body or invalid JSON - use defaults
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

    const requestId = getRequestId(request);

    // Emit upload started event
    emit({
        shopId: shop.id,
        requestId,
        source: EventSource.APP_PROXY,
        type: EventType.SF_UPLOAD_STARTED,
        severity: Severity.INFO,
        payload: {
            contentType,
            shopDomain,
        },
    });

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

        // Emit upload completed event
        emit({
            shopId: shop.id,
            requestId,
            source: EventSource.APP_PROXY,
            type: EventType.SF_UPLOAD_COMPLETED,
            severity: Severity.INFO,
            payload: {
                roomSessionId: roomSession.id,
                contentType,
                gcsKey: key,
            },
        });

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
        }, { headers: corsHeaders });
    } catch (error) {
        // Clean up the room session if presigned URL generation fails
        await prisma.roomSession.delete({ where: { id: roomSession.id } }).catch(() => { });
        console.error(`[RoomUpload] Failed to generate presigned URL for session ${roomSession.id}:`, error);
        return json({
            status: "error",
            message: "Failed to prepare upload. Please try again."
        }, { status: 500, headers: corsHeaders });
    }
};






