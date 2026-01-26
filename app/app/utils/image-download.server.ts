/**
 * Consolidated image download utilities.
 *
 * Provides functions to download images from trusted URLs with
 * various processing options (resize, format conversion).
 */

import sharp from "sharp";
import { validateTrustedUrl } from "./validate-shopify-url.server";
import { logger, createLogContext } from "./logger.server";

/**
 * Image metadata returned after processing.
 */
export interface ImageMeta {
  width: number;
  height: number;
  bytes: number;
  format: string;
}

/**
 * Download an image with a size limit (no processing).
 * Used for room image uploads where we need the raw bytes.
 *
 * @param url - The URL to download from
 * @param maxBytes - Maximum allowed file size in bytes
 * @returns Buffer containing the image data
 */
export async function downloadWithSizeLimit(
  url: string,
  maxBytes: number
): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to download image: ${res.status}`);
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > maxBytes) {
        throw new Error(
          `Image too large (${Math.round(len / 1024 / 1024)}MB). Please upload a smaller image.`
        );
      }
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(
        `Image too large (${Math.round(buf.length / 1024 / 1024)}MB). Please upload a smaller image.`
      );
    }
    if (buf.length === 0) {
      throw new Error("Empty image");
    }
    return buf;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "name" in err && err.name === "AbortError") {
      throw new Error("Timed out downloading image. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Download and process an image with resize and format conversion.
 * Validates URL is from a trusted source (Shopify CDN or GCS).
 *
 * @param url - The URL to download from (must be trusted)
 * @param logContext - Logger context for tracing
 * @param maxDimension - Maximum width/height to resize to (default: 2048)
 * @param format - Output format: 'png' or 'jpeg' (default: 'png')
 * @returns Object with buffer and metadata
 */
export async function downloadAndProcessImage(
  url: string,
  logContext: ReturnType<typeof createLogContext>,
  maxDimension: number = 2048,
  format: "png" | "jpeg" = "png"
): Promise<{ buffer: Buffer; meta: ImageMeta }> {
  validateTrustedUrl(url, "image URL");

  logger.info(
    { ...logContext, stage: "download", format },
    `Downloading image: ${url.substring(0, 80)}...`
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  // Resize and normalize with EXIF auto-orientation
  const pipeline = sharp(inputBuffer)
    .rotate() // Auto-orient based on EXIF, then strip EXIF orientation tag
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

  const { data: buffer, info } =
    format === "png"
      ? await pipeline.png({ force: true }).toBuffer({ resolveWithObject: true })
      : await pipeline
          .jpeg({ quality: 90, force: true })
          .toBuffer({ resolveWithObject: true });

  const meta: ImageMeta = {
    width: info.width || 0,
    height: info.height || 0,
    bytes: buffer.length,
    format,
  };

  logger.info(
    { ...logContext, stage: "download" },
    `Downloaded & Optimized (${format}): ${buffer.length} bytes`
  );

  return { buffer, meta };
}

/**
 * Download a raw image without processing (but with URL validation).
 * Used when the image has already been processed and we just need the bytes.
 *
 * @param url - The URL to download from (must be trusted)
 * @param logContext - Logger context for tracing
 * @returns Buffer containing the raw image data
 */
export async function downloadRawImage(
  url: string,
  logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
  validateTrustedUrl(url, "image URL");

  logger.info(
    { ...logContext, stage: "download-raw" },
    `Downloading raw image: ${url.substring(0, 80)}...`
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new Error("Downloaded image was empty");
  }
  return buffer;
}
