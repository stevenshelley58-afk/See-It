/**
 * Room Gemini Upload Route
 * 
 * Called when user clicks "Continue" or "Skip" in the room cleanup flow.
 * Pre-uploads the room image to Gemini Files API for faster render times.
 * 
 * POST /apps/see-it/room/gemini-upload
 * Body: { room_session_id: string }
 * Response: { success: true, gemini_file_uri: string, expires_at: string }
 */

import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { logger, createLogContext, generateRequestId } from "../utils/logger.server";
import { StorageService } from "../services/storage.server";
import { uploadToGeminiFiles, isGeminiFileValid } from "../services/gemini-files.server";

export async function action({ request }: ActionFunctionArgs) {
    const requestId = generateRequestId();
    const logContext = createLogContext("room", requestId, "gemini-upload", {});
    
    if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, { status: 405 });
    }
    
    try {
        const body = await request.json();
        const { room_session_id } = body;
        
        if (!room_session_id) {
            logger.warn(logContext, "Missing room_session_id in request");
            return json({ error: "room_session_id is required" }, { status: 400 });
        }
        
        logger.info(
            { ...logContext, sessionId: room_session_id },
            `Starting Gemini upload for room session ${room_session_id}`
        );
        
        // Find the room session
        const roomSession = await prisma.roomSession.findUnique({
            where: { id: room_session_id }
        });
        
        if (!roomSession) {
            logger.warn({ ...logContext, sessionId: room_session_id }, "Room session not found");
            return json({ error: "Room session not found" }, { status: 404 });
        }
        
        // Check if we already have a valid Gemini file
        if (roomSession.geminiFileUri && isGeminiFileValid(roomSession.geminiFileExpiresAt)) {
            logger.info(
                { ...logContext, sessionId: room_session_id },
                `Using existing Gemini file: ${roomSession.geminiFileUri}`
            );
            return json({
                success: true,
                gemini_file_uri: roomSession.geminiFileUri,
                expires_at: roomSession.geminiFileExpiresAt?.toISOString(),
                cached: true
            });
        }
        
        // Determine which image to upload: cleaned > canonical > original
        const imageKey = roomSession.cleanedRoomImageKey || 
                        roomSession.canonicalRoomImageKey || 
                        roomSession.originalRoomImageKey;
        
        if (!imageKey) {
            logger.warn({ ...logContext, sessionId: room_session_id }, "No room image found");
            return json({ error: "No room image available" }, { status: 400 });
        }
        
        // Download the image from GCS
        const imageUrl = await StorageService.getSignedReadUrl(imageKey, 60 * 60 * 1000); // 1 hour
        const response = await fetch(imageUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to download room image: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Determine mime type from key
        const mimeType = imageKey.endsWith('.png') ? 'image/png' : 
                         imageKey.endsWith('.webp') ? 'image/webp' : 
                         'image/jpeg';
        
        // Upload to Gemini Files API
        const geminiFile = await uploadToGeminiFiles(
            buffer,
            mimeType,
            `room-${room_session_id}`,
            requestId
        );
        
        // Update the room session with Gemini file info
        await prisma.roomSession.update({
            where: { id: room_session_id },
            data: {
                geminiFileUri: geminiFile.uri,
                geminiFileExpiresAt: geminiFile.expiresAt
            }
        });
        
        logger.info(
            { ...logContext, sessionId: room_session_id },
            `Room uploaded to Gemini: ${geminiFile.uri} (expires: ${geminiFile.expiresAt.toISOString()})`
        );
        
        return json({
            success: true,
            gemini_file_uri: geminiFile.uri,
            expires_at: geminiFile.expiresAt.toISOString(),
            cached: false
        });
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Gemini room upload failed: ${errorMessage}`, error);
        
        // Return success:false but don't fail the request
        // The render will fall back to URL-based upload
        return json({
            success: false,
            error: errorMessage,
            message: "Gemini pre-upload failed, will use fallback at render time"
        });
    }
}
