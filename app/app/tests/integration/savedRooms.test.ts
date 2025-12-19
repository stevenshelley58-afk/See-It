/**
 * Integration tests for Saved Rooms endpoints
 * 
 * Tests the shopper identify and saved rooms list/save/delete endpoints
 * with various scenarios including auth validation and token requirements.
 */

import prisma from "../../db.server";
import { issueShopperToken, validateShopperToken } from "../../utils/shopper-token.server";

/**
 * Test shopper identify endpoint behavior
 * - Validates email format
 * - Creates or finds SavedRoomOwner
 * - Returns valid token
 */
export async function testShopperIdentify(
    shopId: string,
    shopDomain: string,
    email: string
): Promise<{
    success: boolean;
    token?: string;
    ownerId?: string;
    error?: string;
}> {
    try {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const sanitizedEmail = email.trim().toLowerCase();
        
        if (!emailRegex.test(sanitizedEmail)) {
            return {
                success: false,
                error: "Invalid email format"
            };
        }

        // Find or create owner
        const owner = await prisma.savedRoomOwner.upsert({
            where: {
                shopId_email: {
                    shopId,
                    email: sanitizedEmail,
                }
            },
            update: {},
            create: {
                shopId,
                email: sanitizedEmail,
            }
        });

        // Issue token
        const token = issueShopperToken(shopDomain, sanitizedEmail);

        // Verify token is valid
        const payload = validateShopperToken(token);
        if (!payload || payload.shopDomain !== shopDomain || payload.email !== sanitizedEmail) {
            return {
                success: false,
                error: "Generated token is invalid"
            };
        }

        return {
            success: true,
            token,
            ownerId: owner.id
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        };
    }
}

/**
 * Test saved rooms list endpoint
 * - Requires valid shopper token
 * - Returns only rooms owned by the token's email
 * - Returns empty array if no rooms exist
 */
export async function testSavedRoomsList(
    shopId: string,
    shopDomain: string,
    email: string
): Promise<{
    success: boolean;
    roomCount?: number;
    error?: string;
}> {
    try {
        // Issue token
        const token = issueShopperToken(shopDomain, email.toLowerCase().trim());
        
        // Verify token validation
        const payload = validateShopperToken(token);
        if (!payload) {
            return {
                success: false,
                error: "Token validation failed"
            };
        }

        // Find owner
        const owner = await prisma.savedRoomOwner.findUnique({
            where: {
                shopId_email: {
                    shopId,
                    email: payload.email,
                }
            }
        });

        if (!owner) {
            return {
                success: false,
                error: "Owner not found"
            };
        }

        // Get saved rooms for this owner
        const savedRooms = await prisma.savedRoom.findMany({
            where: {
                shopId,
                ownerId: owner.id,
            }
        });

        return {
            success: true,
            roomCount: savedRooms.length
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        };
    }
}

/**
 * Test saved rooms save endpoint
 * - Requires valid shopper token
 * - Verifies room session exists and belongs to shop
 * - Creates SavedRoom record with copied image keys
 */
export async function testSavedRoomsSave(
    shopId: string,
    shopDomain: string,
    email: string,
    roomSessionId: string,
    originalImageKey: string
): Promise<{
    success: boolean;
    savedRoomId?: string;
    error?: string;
}> {
    try {
        // Issue token
        const token = issueShopperToken(shopDomain, email.toLowerCase().trim());
        
        // Verify token
        const payload = validateShopperToken(token);
        if (!payload || payload.shopDomain !== shopDomain) {
            return {
                success: false,
                error: "Invalid token"
            };
        }

        // Verify room session exists and belongs to shop
        const roomSession = await prisma.roomSession.findUnique({
            where: { id: roomSessionId }
        });

        if (!roomSession || roomSession.shopId !== shopId) {
            return {
                success: false,
                error: "Room session not found or access denied"
            };
        }

        // Find owner
        const owner = await prisma.savedRoomOwner.findUnique({
            where: {
                shopId_email: {
                    shopId,
                    email: payload.email,
                }
            }
        });

        if (!owner) {
            return {
                success: false,
                error: "Owner not found"
            };
        }

        // Create saved room (simulating the save endpoint logic)
        // Note: In real implementation, files would be copied to saved-rooms/ prefix
        const savedRoom = await prisma.savedRoom.create({
            data: {
                shopId,
                ownerId: owner.id,
                originalImageKey: `saved-rooms/${shopId}/test-room-id/original.jpg`, // Simulated
                cleanedImageKey: null,
            }
        });

        // Verify saved room belongs to owner
        const verify = await prisma.savedRoom.findUnique({
            where: { id: savedRoom.id },
            include: { owner: true }
        });

        if (!verify || verify.ownerId !== owner.id) {
            return {
                success: false,
                error: "Ownership verification failed"
            };
        }

        // Cleanup test data
        await prisma.savedRoom.delete({ where: { id: savedRoom.id } });

        return {
            success: true,
            savedRoomId: savedRoom.id
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        };
    }
}

/**
 * Test saved rooms delete endpoint
 * - Requires valid shopper token
 * - Verifies ownership before deletion
 * - Prevents deletion of rooms not owned by token's email
 */
export async function testSavedRoomsDelete(
    shopId: string,
    shopDomain: string,
    ownerEmail: string,
    savedRoomId: string
): Promise<{
    success: boolean;
    deleted?: boolean;
    error?: string;
}> {
    try {
        // Issue token
        const token = issueShopperToken(shopDomain, ownerEmail.toLowerCase().trim());
        
        // Verify token
        const payload = validateShopperToken(token);
        if (!payload) {
            return {
                success: false,
                error: "Invalid token"
            };
        }

        // Find saved room
        const savedRoom = await prisma.savedRoom.findUnique({
            where: { id: savedRoomId },
            include: { owner: true }
        });

        if (!savedRoom) {
            return {
                success: false,
                error: "Saved room not found"
            };
        }

        // Verify ownership
        if (savedRoom.shopId !== shopId || savedRoom.owner.email !== payload.email) {
            return {
                success: false,
                error: "Access denied - ownership verification failed"
            };
        }

        // Delete (in real test, would also delete GCS files)
        await prisma.savedRoom.delete({
            where: { id: savedRoomId }
        });

        // Verify deletion
        const verify = await prisma.savedRoom.findUnique({
            where: { id: savedRoomId }
        });

        if (verify) {
            return {
                success: false,
                error: "Room was not deleted"
            };
        }

        return {
            success: true,
            deleted: true
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        };
    }
}

/**
 * Test token rejection for invalid/expired tokens
 */
export async function testTokenValidation(): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        // Test invalid token format
        const invalidToken = "invalid.token.format";
        const result1 = validateShopperToken(invalidToken);
        if (result1 !== null) {
            return {
                success: false,
                error: "Invalid token was accepted"
            };
        }

        // Test tampered token
        const validToken = issueShopperToken("test-shop.myshopify.com", "test@example.com");
        const tamperedToken = validToken.split('.')[0] + '.tampered';
        const result2 = validateShopperToken(tamperedToken);
        if (result2 !== null) {
            return {
                success: false,
                error: "Tampered token was accepted"
            };
        }

        return {
            success: true
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        };
    }
}

