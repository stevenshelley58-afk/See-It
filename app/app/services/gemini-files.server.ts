/**
 * Gemini Files API Service
 * 
 * Handles pre-uploading images to Gemini's Files API for faster render times.
 * Files uploaded to Gemini expire after 48 hours.
 * 
 * Flow:
 * 1. Product prepared → upload to Gemini Files API → store URI + expiry
 * 2. Room confirmed → upload to Gemini Files API → store URI + expiry  
 * 3. Render time → reference URIs instead of re-uploading (saves 3-5s)
 */

import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "../utils/logger.server";

// Gemini files expire after 48 hours, but use 47 hours for safety buffer
const GEMINI_FILE_VALIDITY_HOURS = 47;

export interface GeminiFileInfo {
    uri: string;
    name: string;
    mimeType: string;
    expiresAt: Date;
}

// Lazy initialize Gemini client (reuse from gemini.server.ts pattern)
let ai: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
    if (!ai) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return ai;
}

/**
 * Validate magic bytes match the expected MIME type
 */
export function validateMagicBytes(buffer: Buffer, mimeType: string) {
    if (!buffer || buffer.length < 2) {
        throw new Error(`Magic bytes mismatch: buffer too small for ${mimeType}`);
    }

    if (mimeType === "image/png") {
        // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
        const header = buffer.slice(0, 8).toString("hex").toUpperCase();
        if (header !== "89504E470D0A1A0A") {
            throw new Error(`Magic bytes mismatch: expected PNG header, got ${header}`);
        }
        return;
    }

    if (mimeType === "image/jpeg") {
        // JPEG magic bytes: FF D8 FF
        const header = buffer.slice(0, 3).toString("hex").toUpperCase();
        if (header !== "FFD8FF") {
            throw new Error(`Magic bytes mismatch: expected JPEG header, got ${header}`);
        }
        return;
    }

    if (mimeType === "image/webp") {
        // WebP: "RIFF" .... "WEBP"
        if (buffer.length < 12) {
            throw new Error(`Magic bytes mismatch: buffer too small for WEBP (${buffer.length} bytes)`);
        }
        const riff = buffer.slice(0, 4).toString("ascii");
        const webp = buffer.slice(8, 12).toString("ascii");
        if (riff !== "RIFF" || webp !== "WEBP") {
            const header = buffer.slice(0, 12).toString("hex").toUpperCase();
            throw new Error(`Magic bytes mismatch: expected WEBP (RIFF....WEBP), got ${header}`);
        }
        return;
    }

    if (mimeType === "image/bmp") {
        // BMP: "BM"
        const bm = buffer.slice(0, 2).toString("ascii");
        if (bm !== "BM") {
            const header = buffer.slice(0, 8).toString("hex").toUpperCase();
            throw new Error(`Magic bytes mismatch: expected BMP header (BM), got ${header}`);
        }
        return;
    }

    throw new Error(
        `Unsupported image MIME type for magic-bytes validation: ${mimeType}`
    );
}

/**
 * Upload a buffer to Gemini Files API
 * 
 * @param buffer - Image data to upload
 * @param mimeType - MIME type (e.g., 'image/png')
 * @param displayName - Human-readable name for the file
 * @param requestId - For logging context
 * @returns GeminiFileInfo with URI and expiration
 */
export async function uploadToGeminiFiles(
    buffer: Buffer,
    mimeType: string,
    displayName: string,
    requestId: string = "gemini-upload"
): Promise<GeminiFileInfo> {
    const logContext = createLogContext("render", requestId, "upload", { displayName, mimeType });

    logger.info(logContext, `Uploading to Gemini Files API: ${displayName} (${buffer.length} bytes)`);

    const startTime = Date.now();

    try {
        // Hard guard: validate bytes match MIME
        validateMagicBytes(buffer, mimeType);

        const client = getGeminiClient();

        // Convert Buffer to Blob for upload
        // The SDK accepts Blob in Node.js environment
        const blob = new Blob([buffer as any], { type: mimeType });

        const uploadResult = await client.files.upload({
            file: blob,
            config: {
                mimeType,
                displayName,
            },
        });

        const duration = Date.now() - startTime;

        // Parse expiration time from response
        // The SDK returns expirationTime as a string in ISO format
        let expiresAt: Date;
        if (uploadResult.expirationTime) {
            expiresAt = new Date(uploadResult.expirationTime);
        } else {
            // Fallback: assume 48h validity, minus safety buffer
            expiresAt = new Date(Date.now() + GEMINI_FILE_VALIDITY_HOURS * 60 * 60 * 1000);
        }

        logger.info(
            { ...logContext, stage: "complete" },
            `Gemini file uploaded in ${duration}ms: ${uploadResult.uri} (expires: ${expiresAt.toISOString()})`
        );

        return {
            uri: uploadResult.uri!,
            name: uploadResult.name!,
            mimeType: uploadResult.mimeType || mimeType,
            expiresAt,
        };
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(
            { ...logContext, stage: "error" },
            `Gemini file upload failed after ${duration}ms`,
            error
        );
        throw error;
    }
}

/**
 * Check if a Gemini file URI is still valid (not expired)
 * Uses a safety buffer of 1 hour before actual expiration
 * 
 * @param expiresAt - Expiration timestamp from database
 * @returns true if file is still valid
 */
export function isGeminiFileValid(expiresAt: Date | null | undefined): boolean {
    if (!expiresAt) return false;

    // Add 1 hour safety buffer
    const safetyBuffer = 60 * 60 * 1000; // 1 hour in ms
    const now = Date.now();
    const expirationTime = expiresAt.getTime();

    return now < (expirationTime - safetyBuffer);
}

/**
 * Get existing Gemini file or upload a new one if expired/missing
 * 
 * @param existingUri - Existing URI from database (may be null/expired)
 * @param existingExpiry - Existing expiration from database
 * @param buffer - Image buffer to upload if needed
 * @param mimeType - MIME type
 * @param displayName - Display name for new upload
 * @param requestId - For logging
 * @returns GeminiFileInfo (either existing or newly uploaded)
 */
export async function getOrRefreshGeminiFile(
    existingUri: string | null | undefined,
    existingExpiry: Date | null | undefined,
    buffer: Buffer,
    mimeType: string,
    displayName: string,
    requestId: string = "gemini-refresh"
): Promise<GeminiFileInfo> {
    // Check if existing file is still valid
    if (existingUri && isGeminiFileValid(existingExpiry)) {
        logger.info(
            createLogContext("render", requestId, "cache-hit", { displayName }),
            `Using cached Gemini file: ${existingUri}`
        );

        return {
            uri: existingUri,
            name: existingUri.split('/').pop() || 'unknown',
            mimeType,
            expiresAt: existingExpiry!,
        };
    }

    // Need to upload new file
    logger.info(
        createLogContext("render", requestId, "cache-miss", { displayName }),
        `Gemini file expired or missing, uploading new file`
    );

    return uploadToGeminiFiles(buffer, mimeType, displayName, requestId);
}

/**
 * Upload a file from a URL to Gemini Files API
 * Downloads the file first, then uploads to Gemini
 * 
 * @param url - URL to download from (must be trusted: Shopify CDN or GCS)
 * @param mimeType - MIME type
 * @param displayName - Display name
 * @param requestId - For logging
 * @returns GeminiFileInfo
 */
export async function uploadUrlToGeminiFiles(
    url: string,
    mimeType: string,
    displayName: string,
    requestId: string = "gemini-url-upload"
): Promise<GeminiFileInfo> {
    const logContext = createLogContext("render", requestId, "url-upload", { displayName });

    logger.info(logContext, `Downloading and uploading to Gemini: ${url.substring(0, 80)}...`);

    try {
        // Download the file
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to Gemini
        return uploadToGeminiFiles(buffer, mimeType, displayName, requestId);
    } catch (error) {
        logger.error(
            { ...logContext, stage: "error" },
            "Failed to download and upload to Gemini",
            error
        );
        throw error;
    }
}
