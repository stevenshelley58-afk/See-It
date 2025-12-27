/**
 * Image Removal Service - Vertex AI Imagen 3
 * 
 * Uses Vertex AI Imagen 3 model for object removal (inpainting).
 * Model: imagen-3.0-capability-001
 * Method: REST API via google-auth-library
 */

import { GoogleAuth } from 'google-auth-library';
import { logger, createLogContext } from '../utils/logger.server';

const LOCATION = "us-central1";
const MODEL_ID = "imagen-3.0-capability-001";

/**
 * Get Google Auth client - handles Railway Base64 encoded credentials
 */
function getAuthClient(): GoogleAuth {
    let credentials: object | undefined;

    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        // Decode the Base64 string from Railway
        const jsonString = Buffer.from(process.env.GOOGLE_CREDENTIALS_JSON, 'base64').toString('utf-8');
        credentials = JSON.parse(jsonString);
    }

    return new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
}

/**
 * Get Project ID from credentials or environment
 */
function getProjectId(): string {
    // Try environment variable first
    if (process.env.GOOGLE_CLOUD_PROJECT) {
        return process.env.GOOGLE_CLOUD_PROJECT;
    }

    // Try to extract from credentials
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        try {
            const jsonString = Buffer.from(process.env.GOOGLE_CREDENTIALS_JSON, 'base64').toString('utf-8');
            const credentials = JSON.parse(jsonString);
            if (credentials.project_id) {
                return credentials.project_id;
            }
        } catch {
            // Ignore parse errors
        }
    }

    throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required');
}

export interface RemovalResult {
    imageBase64: string;
    raiReasoning?: string;
}

/**
 * Removes an object from an image using Vertex AI Imagen 3.
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
    const logContext = createLogContext('image-removal', requestId, 'start', {});

    const projectId = getProjectId();

    logger.info(
        { ...logContext, stage: 'auth' },
        `Authenticating with Vertex AI for project: ${projectId}`
    );

    // 1. Authenticate
    const auth = getAuthClient();
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
        throw new Error('Failed to obtain access token');
    }

    // 2. API Endpoint
    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;

    // 3. Payload
    const payload = {
        instances: [
            {
                prompt: "", // CRITICAL: Empty string triggers pure removal logic
                referenceImages: [
                    {
                        referenceType: "REFERENCE_TYPE_RAW",
                        referenceImage: { bytesBase64Encoded: imageBase64 }
                    },
                    {
                        referenceType: "REFERENCE_TYPE_MASK",
                        referenceImage: { bytesBase64Encoded: maskBase64 },
                        maskImageConfig: {
                            maskMode: "MASK_MODE_USER_PROVIDED",
                            dilation: 0.03 // Expands mask slightly to catch edges
                        }
                    }
                ]
            }
        ],
        parameters: {
            editMode: "EDIT_MODE_INPAINT_REMOVAL",
            sampleCount: 1,
            includeRaiReasoning: true
        }
    };

    logger.info(
        { ...logContext, stage: 'request' },
        `Calling Vertex AI Imagen 3 API`
    );

    // 4. Request
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error(
            { ...logContext, stage: 'error', status: response.status },
            `Imagen API Failed: ${errorText}`
        );
        throw new Error(`Imagen API Failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // 5. Output
    if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
        logger.info(
            { ...logContext, stage: 'complete' },
            `Object removal completed successfully`
        );

        return {
            imageBase64: data.predictions[0].bytesBase64Encoded,
            raiReasoning: data.predictions[0].raiFilteredReason
        };
    } else {
        const raiReason = data.predictions?.[0]?.raiFilteredReason || 'Unknown';
        logger.error(
            { ...logContext, stage: 'no-output', raiReason },
            `API returned no image. RAI reason: ${raiReason}`
        );
        throw new Error(`API returned no image. Safety/RAI filter reason: ${raiReason}`);
    }
}
