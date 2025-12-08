/**
 * Unit tests for the image pipeline
 * 
 * Tests the prepare pipeline stages with recorded fixtures
 */

import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";

// Test fixtures directory (create these manually with real Shopify CDN responses)
const FIXTURES_DIR = join(__dirname, "../../../tests/fixtures");

/**
 * Test that PNG images pass through the pipeline
 */
export async function testPngPipeline(): Promise<boolean> {
    try {
        // Load fixture (create a test PNG file)
        const pngPath = join(FIXTURES_DIR, "test-product.png");
        const buffer = readFileSync(pngPath);

        // Stage: convert (should already be PNG, but test conversion)
        const converted = await sharp(buffer)
            .png({ force: true })
            .toBuffer();

        if (converted.length === 0) {
            throw new Error("PNG conversion produced empty buffer");
        }

        // Stage: bg-remove
        const resultBlob = await removeBackground(converted, {
            mimeType: 'image/png',
            output: {
                format: 'image/png',
                quality: 1.0
            }
        } as any);

        const arrayBuffer = await resultBlob.arrayBuffer();
        const outputBuffer = Buffer.from(arrayBuffer);

        if (outputBuffer.length === 0) {
            throw new Error("Background removal produced empty buffer");
        }

        // Verify it's still PNG
        const metadata = await sharp(outputBuffer).metadata();
        if (metadata.format !== "png") {
            throw new Error(`Expected PNG, got ${metadata.format}`);
        }

        return true;
    } catch (error) {
        console.error("PNG pipeline test failed:", error);
        return false;
    }
}

/**
 * Test that JPG images are converted to PNG
 */
export async function testJpgToPngPipeline(): Promise<boolean> {
    try {
        const jpgPath = join(FIXTURES_DIR, "test-product.jpg");
        const buffer = readFileSync(jpgPath);

        // Stage: convert JPG to PNG
        const pngBuffer = await sharp(buffer)
            .png({ force: true })
            .toBuffer();

        if (pngBuffer.length === 0) {
            throw new Error("JPG to PNG conversion produced empty buffer");
        }

        // Verify it's PNG
        const metadata = await sharp(pngBuffer).metadata();
        if (metadata.format !== "png") {
            throw new Error(`Expected PNG after conversion, got ${metadata.format}`);
        }

        // Stage: bg-remove
        const resultBlob = await removeBackground(pngBuffer, {
            mimeType: 'image/png',
            output: {
                format: 'image/png',
                quality: 1.0
            }
        } as any);

        const arrayBuffer = await resultBlob.arrayBuffer();
        const outputBuffer = Buffer.from(arrayBuffer);

        if (outputBuffer.length === 0) {
            throw new Error("Background removal produced empty buffer");
        }

        return true;
    } catch (error) {
        console.error("JPG to PNG pipeline test failed:", error);
        return false;
    }
}

/**
 * Test that WebP images are converted to PNG
 */
export async function testWebPToPngPipeline(): Promise<boolean> {
    try {
        const webpPath = join(FIXTURES_DIR, "test-product.webp");
        const buffer = readFileSync(webpPath);

        // Stage: convert WebP to PNG
        const pngBuffer = await sharp(buffer)
            .png({ force: true })
            .toBuffer();

        if (pngBuffer.length === 0) {
            throw new Error("WebP to PNG conversion produced empty buffer");
        }

        // Verify it's PNG
        const metadata = await sharp(pngBuffer).metadata();
        if (metadata.format !== "png") {
            throw new Error(`Expected PNG after conversion, got ${metadata.format}`);
        }

        return true;
    } catch (error) {
        console.error("WebP to PNG pipeline test failed:", error);
        return false;
    }
}

/**
 * Test that invalid/empty images are rejected
 */
export async function testInvalidImageRejection(): Promise<boolean> {
    try {
        // Test empty buffer
        const emptyBuffer = Buffer.alloc(0);
        try {
            await sharp(emptyBuffer).png().toBuffer();
            return false; // Should have thrown
        } catch {
            // Expected to fail
        }

        // Test invalid format
        const invalidBuffer = Buffer.from("not an image");
        try {
            await sharp(invalidBuffer).png().toBuffer();
            return false; // Should have thrown
        } catch {
            // Expected to fail
        }

        return true;
    } catch (error) {
        console.error("Invalid image rejection test failed:", error);
        return false;
    }
}

/**
 * Run all pipeline tests
 */
export async function runAllPipelineTests(): Promise<{
    png: boolean;
    jpg: boolean;
    webp: boolean;
    invalid: boolean;
}> {
    console.log("Running image pipeline tests...");

    const results = {
        png: await testPngPipeline().catch(() => false),
        jpg: await testJpgToPngPipeline().catch(() => false),
        webp: await testWebPToPngPipeline().catch(() => false),
        invalid: await testInvalidImageRejection().catch(() => false),
    };

    console.log("Pipeline test results:", results);
    return results;
}

