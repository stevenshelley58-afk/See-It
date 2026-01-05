/**
 * Image Removal Service - Gemini 2.5 Flash
 * 
 * Uses Google Gemini 2.5 Flash for object removal (inpainting) using a mask.
 * Capabilities: Understands scene geometry and reconstructs background naturally.
 */

import { logger, createLogContext } from '../utils/logger.server';
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import crypto from 'crypto';

// Initialize Gemini SDK with API key from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Validation for API Key
if (!GEMINI_API_KEY) {
    // Logic inside function handles expected errors
}

export interface RemovalResult {
    imageBase64: string;
}

function getHash(data: string): string {
    return crypto.createHash('sha256').update(data.substring(0, 1000)).digest('hex').substring(0, 8);
}

/**
 * Removes an object from an image using Gemini 2.5 Flash.
 * 
 * @param imageBase64 - Original image (Base64 string).
 * @param maskBase64 - Mask image (Base64 string). White pixels = Remove.
 * @param requestId - Request ID for logging
 * @returns The cleaned image as a Base64 string.
 */
export async function removeObject(
    imageBase64: string,
    maskBase64: string,
    requestId: string = 'image-removal'
): Promise<RemovalResult> {
    const logContext = createLogContext('cleanup', requestId, 'start', {});
    const inputHash = getHash(imageBase64);
    const maskHash = getHash(maskBase64);

    logger.info(
        { ...logContext, stage: 'auth', inputHash, maskHash },
        `Using Gemini 2.5 Flash for Object Removal (Model: gemini-2.5-flash-image)`
    );

    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY environment variable is required');
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    try {
        // 1. Detect format of Input Image (mimic file.type from reference)
        // We use the original data to avoid re-encoding overhead/changes.
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const metadata = await sharp(imageBuffer).metadata();
        let mimeType = 'image/png'; // Default
        if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
            mimeType = 'image/jpeg';
        } else if (metadata.format === 'webp') {
            mimeType = 'image/webp';
        } else if (metadata.format === 'png') {
            mimeType = 'image/png';
        } else {
            // Fallback for uncommon types: convert to PNG
            logger.info({ ...logContext }, `Converting ${metadata.format} to PNG`);
            const convertedBuffer = await sharp(imageBuffer).toFormat('png').toBuffer();
            imageBase64 = convertedBuffer.toString('base64');
            mimeType = 'image/png';
        }

        logger.info(
            { ...logContext, stage: 'detect-mime', mimeType, format: metadata.format },
            `Input image detected as ${mimeType}`
        );

        // 2. Pass Mask as-is (Caller is responsible for PNG format, mostly)
        // Reference code: const maskBase64 = await fileToSib64(maskBlob);
        // We trust maskBase64 is already a valid PNG (backend usually ensures this).
        // If needed we can verify but reference code doesn't.

        logger.info(
            { ...logContext, stage: 'request' },
            `Calling Gemini generateContent`
        );

        // Using EXACT model from working reference: 'gemini-2.5-flash-image'
        // Best practices: text first, then images, with explicit removal-only instructions
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    {
                        text: `You are performing inpainting for OBJECT REMOVAL ONLY.

Inputs:
- Image 1: source photograph
- Image 2: mask where white indicates the region to remove; black indicates the region to preserve as much as possible.

Goal:
Remove the object(s) indicated by the white mask and reconstruct the natural background (walls/floor/etc.) behind them.

Rules:
1) Remove ALL parts of the object(s) indicated by the mask. If small parts of the same object extend slightly outside the white mask, you may remove those remnants too.
2) Preserve everything else. Do not change furniture, layout, colors, or details outside the removal area, except for minimal blending near the boundary to make the edit seamless.
3) Reconstruct ONLY background surfaces that would naturally be behind the removed object. Match surrounding lighting, texture, shadows, and perspective.
4) Do NOT add or invent any new objects, furniture, decorations, text, patterns, or elements. Do not "replace" the removed object with anything.
5) If the mask includes some true background, reconstruct it to match the surrounding background exactly.

Output:
Return only the edited image.`,
                    },
                    {
                        inlineData: {
                            data: imageBase64,
                            mimeType: mimeType,
                        },
                    },
                    {
                        inlineData: {
                            data: maskBase64,
                            mimeType: 'image/png',
                        },
                    },
                ],
            },
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
            },
        });

        const finishReason = response.candidates?.[0]?.finishReason;
        logger.info(
            { ...logContext, stage: 'response', finishReason },
            `Gemini response received`
        );

        const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

        if (!imagePart || !imagePart.inlineData || !imagePart.inlineData.data) {
            logger.error(
                { ...logContext, stage: 'error', response: JSON.stringify(response) },
                `Gemini API did not return an image. FinishReason: ${finishReason}`
            );
            throw new Error(`Gemini API did not return a valid result. Reason: ${finishReason}`);
        }

        const resultBase64 = imagePart.inlineData.data;
        const outputHash = getHash(resultBase64);

        if (inputHash === outputHash) {
            logger.warn(
                { ...logContext, stage: 'warning' },
                `Gemini returned original image! (Input Hash == Output Hash)`
            );
        }

        logger.info(
            { ...logContext, stage: 'complete', outputHash },
            `Object removal completed successfully`
        );

        return {
            imageBase64: resultBase64,
        };

    } catch (error: any) {
        logger.error(
            { ...logContext, stage: 'error', error: error.message },
            `Gemini API Failed: ${error.message}`
        );
        throw new Error(`Gemini API Failed: ${error.message}`);
    }
}
