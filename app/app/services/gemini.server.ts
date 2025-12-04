// Gemini AI service - runs directly in Railway, no separate Cloud Run service
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { Storage } from "@google-cloud/storage";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize GCS
let storage: Storage;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
        let jsonString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
        if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
            jsonString = jsonString.slice(1, -1);
        }
        let credentials;
        try {
            const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
            if (decoded.startsWith('{')) {
                credentials = JSON.parse(decoded);
            } else {
                credentials = JSON.parse(jsonString);
            }
        } catch {
            credentials = JSON.parse(jsonString);
        }
        storage = new Storage({ credentials });
        console.log('[Gemini] GCS initialized with credentials');
    } catch (error) {
        console.error('[Gemini] Failed to parse GCS credentials:', error);
        storage = new Storage();
    }
} else {
    storage = new Storage();
}

const GCS_BUCKET = process.env.GCS_BUCKET || 'see-it-room';

// Verified working model names as of Dec 2024
const IMAGE_MODEL_PRO = "imagen-3.0-capability-001";
const IMAGE_MODEL_FAST = "gemini-2.5-flash-image-preview";

async function downloadToBuffer(url: string): Promise<Buffer> {
    console.log(`[Gemini] Downloading: ${url.substring(0, 80)}...`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function uploadToGCS(key: string, buffer: Buffer, contentType: string): Promise<string> {
    console.log(`[Gemini] Uploading to GCS: ${key}`);
    const bucket = storage.bucket(GCS_BUCKET);
    const file = bucket.file(key);
    
    await file.save(buffer, { contentType, resumable: false });
    
    const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });
    
    return signedUrl;
}

async function callGemini(
    prompt: string, 
    imageBuffers: Buffer | Buffer[], 
    options: { model?: string; aspectRatio?: string } = {}
): Promise<string> {
    const { model = IMAGE_MODEL_FAST, aspectRatio } = options;
    console.log(`[Gemini] Calling model: ${model}`);

    const parts: any[] = [{ text: prompt }];
    
    const buffers = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];
    for (const buffer of buffers) {
        if (buffer) {
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: buffer.toString('base64')
                }
            });
        }
    }

    const config: any = { responseModalities: ['IMAGE'] };
    if (aspectRatio) {
        config.imageConfig = { aspectRatio };
    }

    try {
        const response = await ai.models.generateContent({
            model,
            contents: parts,
            config,
        });

        // Extract image from response
        const candidates = response.candidates;
        if (candidates?.[0]?.content?.parts) {
            for (const part of candidates[0].content.parts) {
                if (part.inlineData) {
                    return part.inlineData.data;
                }
            }
        }
        
        // Try alternate structure
        if ((response as any).parts) {
            for (const part of (response as any).parts) {
                if (part.inlineData) {
                    return part.inlineData.data;
                }
            }
        }
        
        throw new Error("No image in response");
    } catch (error: any) {
        console.error(`[Gemini] Error with ${model}:`, error.message);
        
        // Fallback to fast model if pro fails
        if (model === IMAGE_MODEL_PRO) {
            console.log('[Gemini] Falling back to fast model');
            return callGemini(prompt, imageBuffers, { ...options, model: IMAGE_MODEL_FAST });
        }
        throw error;
    }
}

export async function prepareProduct(
    sourceImageUrl: string, 
    shopId: string, 
    productId: string, 
    assetId: string
): Promise<string> {
    console.log(`[Gemini] Preparing product: ${productId}`);
    const imageBuffer = await downloadToBuffer(sourceImageUrl);

    const prompt = `Remove the background from this product image completely. 
Make the background fully transparent (alpha = 0). 
Keep the product exactly as it is - do not modify the product's shape, color, texture, or any details.
Output as PNG with transparency.`;

    const base64Data = await callGemini(prompt, imageBuffer, {
        model: IMAGE_MODEL_FAST,
        aspectRatio: "1:1"
    });
    
    const outputBuffer = Buffer.from(base64Data, 'base64');
    const key = `products/${shopId}/${productId}/${assetId}_prepared.png`;
    return await uploadToGCS(key, outputBuffer, 'image/png');
}

export async function cleanupRoom(
    roomImageUrl: string, 
    maskDataUrl: string
): Promise<string> {
    console.log('[Gemini] Processing room cleanup');
    
    const maskBase64 = maskDataUrl.split(',')[1];
    const maskBuffer = Buffer.from(maskBase64, 'base64');
    const roomBuffer = await downloadToBuffer(roomImageUrl);

    const prompt = `Using the provided room image and mask image:
The white regions in the mask indicate objects to be removed.
Remove objects in the masked (white) areas and fill with appropriate background.
Match the surrounding context - floor, wall, or whatever is around the masked area.
Do NOT alter any pixels outside the masked region.
Maintain consistent lighting and perspective.
The result should look natural, as if nothing was ever there.`;

    const base64Data = await callGemini(prompt, [roomBuffer, maskBuffer], {
        model: IMAGE_MODEL_PRO
    });
    
    const outputBuffer = Buffer.from(base64Data, 'base64');
    const key = `cleaned/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    return await uploadToGCS(key, outputBuffer, 'image/jpeg');
}

export async function compositeScene(
    preparedProductImageUrl: string, 
    roomImageUrl: string, 
    placement: { x: number; y: number; scale: number },
    stylePreset: string = 'neutral'
): Promise<string> {
    console.log('[Gemini] Processing scene composite');
    
    const productBuffer = await downloadToBuffer(preparedProductImageUrl);
    const roomBuffer = await downloadToBuffer(roomImageUrl);

    // Step 1: Mechanical placement with Sharp
    const roomMetadata = await sharp(roomBuffer).metadata();
    const roomWidth = roomMetadata.width || 1920;
    const roomHeight = roomMetadata.height || 1080;

    const pixelX = Math.round(roomWidth * placement.x);
    const pixelY = Math.round(roomHeight * placement.y);

    const productMetadata = await sharp(productBuffer).metadata();
    const newWidth = Math.round((productMetadata.width || 500) * placement.scale);

    const resizedProduct = await sharp(productBuffer)
        .resize({ width: newWidth })
        .toBuffer();

    const resizedMeta = await sharp(resizedProduct).metadata();
    const adjustedX = Math.max(0, pixelX - Math.round((resizedMeta.width || 0) / 2));
    const adjustedY = Math.max(0, pixelY - Math.round((resizedMeta.height || 0) / 2));

    const guideImageBuffer = await sharp(roomBuffer)
        .composite([{ input: resizedProduct, top: adjustedY, left: adjustedX }])
        .toBuffer();

    // Step 2: AI polish
    const styleDescription = stylePreset === 'neutral' ? 'natural and realistic' : stylePreset;
    const prompt = `This image shows a product placed into a room scene.
The product is already positioned - do NOT move, resize, reposition, or warp the product.
Make the composite look photorealistic by:
1. Harmonizing the lighting on the product to match the room's light sources
2. Adding appropriate shadows beneath and around the product
3. Adding subtle reflections if on a reflective surface
4. Ensuring color temperature consistency
Style: ${styleDescription}
Keep the product's exact position, size, and shape unchanged.`;

    const aspectRatio = roomWidth > roomHeight ? "16:9" : roomHeight > roomWidth ? "9:16" : "1:1";
    
    const base64Data = await callGemini(prompt, guideImageBuffer, {
        model: IMAGE_MODEL_PRO,
        aspectRatio
    });
    
    const outputBuffer = Buffer.from(base64Data, 'base64');
    const key = `composite/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    return await uploadToGCS(key, outputBuffer, 'image/jpeg');
}

