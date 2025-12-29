/**
 * Image Removal Service - Clipdrop Cleanup API
 * 
 * Uses Clipdrop Cleanup API for object removal (inpainting).
 * Endpoint: https://clipdrop-api.co/cleanup/v1
 * Method: REST API with multipart/form-data
 */

import { logger, createLogContext } from '../utils/logger.server';

const CLIPDROP_ENDPOINT = 'https://clipdrop-api.co/cleanup/v1';

/**
 * Get Clipdrop API key from environment
 */
function getApiKey(): string {
    const apiKey = process.env.CLIPDROP_API_KEY;
    if (!apiKey) {
        throw new Error('CLIPDROP_API_KEY environment variable is required');
    }
    return apiKey;
}

export interface RemovalResult {
    imageBase64: string;
}

/**
 * Removes an object from an image using Clipdrop Cleanup API.
 * 
 * @param imageBase64 - Original image (Base64 string, no data URI prefix).
 * @param maskBase64 - Mask image (Base64 string, no data URI prefix).
 *                     White pixels = Remove. Black pixels = Keep.
 * @param requestId - Request ID for logging
 * @returns The cleaned image as a Base64 string.
 */
export async function removeObject(
    imageBase64: string,
    maskBase64: string,
    requestId: string = 'image-removal'
): Promise<RemovalResult> {
    const logContext = createLogContext('cleanup', requestId, 'start', {});

    logger.info(
        { ...logContext, stage: 'auth' },
        `Using Clipdrop Cleanup API`
    );

    const apiKey = getApiKey();

    // Convert base64 strings to Blobs for FormData
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const maskBuffer = Buffer.from(maskBase64, 'base64');

    const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
    const maskBlob = new Blob([maskBuffer], { type: 'image/png' });

    // Build FormData
    const formData = new FormData();
    formData.append('image_file', imageBlob, 'image.png');
    formData.append('mask_file', maskBlob, 'mask.png');
    formData.append('mode', 'quality');  // Use quality mode for better reconstruction

    logger.info(
        { ...logContext, stage: 'request' },
        `Calling Clipdrop Cleanup API`
    );

    // Make request
    const response = await fetch(CLIPDROP_ENDPOINT, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error(
            { ...logContext, stage: 'error', status: response.status },
            `Clipdrop API Failed: ${errorText}`
        );
        throw new Error(`Clipdrop API Failed (${response.status}): ${errorText}`);
    }

    // Clipdrop returns the image as a blob, convert to base64
    const resultBuffer = Buffer.from(await response.arrayBuffer());
    const resultBase64 = resultBuffer.toString('base64');

    logger.info(
        { ...logContext, stage: 'complete' },
        `Object removal completed successfully`
    );

    return {
        imageBase64: resultBase64,
    };
}
