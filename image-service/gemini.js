// Updated to use the new @google/genai SDK (November 2025)
// Using Gemini 3 Pro Image Preview (Nano Banana Pro) - the LATEST image model
// See: https://ai.google.dev/gemini-api/docs/image-generation
// Changelog: https://ai.google.dev/gemini-api/docs/changelog

import { GoogleGenAI } from "@google/genai";
import sharp from 'sharp';
import { downloadToBuffer, uploadBufferToGCS } from './storage.js';

// Initialize the new GenAI client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Models as of November 2025 - Nano Banana release!
// See: https://ai.google.dev/gemini-api/docs/image-generation
// - gemini-3-pro-image-preview (Nano Banana Pro): Professional, 4K, thinking mode, up to 14 reference images
// - gemini-2.5-flash-image (Nano Banana): Fast, efficient, 1024px, high-volume
const IMAGE_MODEL_PRO = "gemini-3-pro-image-preview";   // For high-quality composites (4K)
const IMAGE_MODEL_FAST = "gemini-2.5-flash-image";      // For quick operations like bg removal

async function callGemini(promptText, imageBuffers, options = {}) {
    const {
        model = IMAGE_MODEL_PRO,
        aspectRatio = null,
        imageSize = null,  // "1K", "2K", "4K" (only for gemini-3-pro-image-preview)
    } = options;

    console.log(`Calling Gemini model: ${model}`);

    // Build the content parts array
    const parts = [];

    // Text prompt first
    parts.push({ text: promptText });

    // Add all image buffers as inline data
    const bufferArray = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];
    for (const buffer of bufferArray) {
        if (buffer) {
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: buffer.toString('base64')
                }
            });
        }
    }

    // Build config with Nano Banana options
    const config = {
        responseModalities: ['IMAGE'],  // Request image output
    };

    // Add imageConfig for aspect ratio and resolution (Gemini 3 Pro supports 4K!)
    if (aspectRatio || imageSize) {
        config.imageConfig = {};
        if (aspectRatio) config.imageConfig.aspectRatio = aspectRatio;
        if (imageSize) config.imageConfig.imageSize = imageSize;  // "1K", "2K", "4K"
    }

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: parts,
            config: config,
        });

        // Extract image data from response - handle both old and new SDK structures
        const candidates = response.candidates;
        if (!candidates || !candidates[0]?.content?.parts) {
            // Try alternate structure for newer SDK
            if (response.parts) {
                for (const part of response.parts) {
                    if (part.inlineData) {
                        return part.inlineData.data;
                    }
                }
            }
            throw new Error("No content in response");
        }

        // Find the inline image data in the response parts
        for (const part of candidates[0].content.parts) {
            if (part.inlineData) {
                return part.inlineData.data;
            }
        }

        throw new Error("No image data in response");
    } catch (error) {
        console.error(`Error with model ${model}:`, error.message);
        
        // Fallback to fast model if pro fails
        if (model === IMAGE_MODEL_PRO) {
            console.log('Falling back to Nano Banana (fast model)');
            return callGemini(promptText, imageBuffers, { ...options, model: IMAGE_MODEL_FAST });
        }
        throw error;
    }
}

export async function prepareProduct(sourceImageUrl, shopId, productId, assetId) {
    console.log(`Preparing product: ${shopId}/${productId}/${assetId}`);
    const imageBuffer = await downloadToBuffer(sourceImageUrl);

    // Use the FAST model for background removal (high-volume, quick operation)
    const prompt = `Remove the background from this product image completely. 
Make the background fully transparent (alpha = 0). 
Keep the product exactly as it is - do not modify the product's shape, color, texture, or any details.
Output as PNG with transparency.`;

    const base64Data = await callGemini(prompt, imageBuffer, {
        model: IMAGE_MODEL_FAST,  // Nano Banana for fast bg removal
        aspectRatio: "1:1"
    });
    const outputBuffer = Buffer.from(base64Data, 'base64');

    const key = `products/${shopId}/${productId}/${assetId}_prepared.png`;
    return await uploadBufferToGCS(process.env.GCS_BUCKET, key, outputBuffer, 'image/png');
}

// Cleanup room using drawn mask (white = remove, black = keep)
export async function cleanupRoom(roomImageUrl, maskDataUrl) {
    console.log('Processing room cleanup with drawn mask');
    
    // Download the room image
    const roomBuffer = await downloadToBuffer(roomImageUrl);
    
    // Parse the mask from base64 data URL
    // Format: "data:image/png;base64,iVBORw0KGgo..."
    const maskBase64 = maskDataUrl.split(',')[1];
    const maskBuffer = Buffer.from(maskBase64, 'base64');

    const prompt = `Using the provided room image and mask image:
The white regions in the mask indicate objects to be removed.
Remove objects in the masked (white) areas and fill with appropriate background.
Match the surrounding context - floor, wall, or whatever is around the masked area.
Do NOT alter any pixels outside the masked region.
Maintain consistent lighting and perspective.
The result should look natural, as if nothing was ever there.`;

    const base64Data = await callGemini(prompt, [roomBuffer, maskBuffer], {
        model: IMAGE_MODEL_PRO,
        imageSize: "2K"
    });
    const outputBuffer = Buffer.from(base64Data, 'base64');

    const key = `cleaned/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    return await uploadBufferToGCS(process.env.GCS_BUCKET, key, outputBuffer, 'image/jpeg');
}

export async function compositeScene(preparedProductImageUrl, roomImageUrl, placement, stylePreset) {
    console.log('Processing scene composite');
    const productBuffer = await downloadToBuffer(preparedProductImageUrl);
    const roomBuffer = await downloadToBuffer(roomImageUrl);

    // Step 1: Mechanical Placement with Sharp
    const roomMetadata = await sharp(roomBuffer).metadata();
    const roomWidth = roomMetadata.width;
    const roomHeight = roomMetadata.height;

    const pixelX = Math.round(roomWidth * placement.x);
    const pixelY = Math.round(roomHeight * placement.y);

    // Resize product based on scale
    const productMetadata = await sharp(productBuffer).metadata();
    const newWidth = Math.round(productMetadata.width * placement.scale);

    // Ensure the product is placed correctly (centered at the placement point)
    const resizedProduct = await sharp(productBuffer)
        .resize({ width: newWidth })
        .toBuffer();

    const resizedProductMeta = await sharp(resizedProduct).metadata();
    const adjustedX = Math.max(0, pixelX - Math.round(resizedProductMeta.width / 2));
    const adjustedY = Math.max(0, pixelY - Math.round(resizedProductMeta.height / 2));

    const guideImageBuffer = await sharp(roomBuffer)
        .composite([{
            input: resizedProduct,
            top: adjustedY,
            left: adjustedX
        }])
        .toBuffer();

    // Step 2: AI Polish using Gemini 3 Pro (best quality for final output)
    const styleDescription = stylePreset === 'neutral' ? 'natural and realistic' : stylePreset;
    const prompt = `This image shows a product that has been placed into a room scene.
The product is already positioned - do NOT move, resize, reposition, or warp the product.
Your task is to make the composite look photorealistic by:
1. Harmonizing the lighting on the product to match the room's light sources
2. Adding appropriate shadows beneath and around the product
3. Adding subtle reflections if on a reflective surface
4. Ensuring color temperature consistency
Style: ${styleDescription}
Keep the product's exact position, size, and shape unchanged.`;

    // Use Gemini 3 Pro for best quality composite with 2K output
    const base64Data = await callGemini(prompt, guideImageBuffer, {
        model: IMAGE_MODEL_PRO,
        imageSize: "2K",  // High resolution output
        aspectRatio: roomWidth > roomHeight ? "16:9" : roomHeight > roomWidth ? "9:16" : "1:1"
    });
    const outputBuffer = Buffer.from(base64Data, 'base64');

    const key = `composite/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    return await uploadBufferToGCS(process.env.GCS_BUCKET, key, outputBuffer, 'image/jpeg');
}
