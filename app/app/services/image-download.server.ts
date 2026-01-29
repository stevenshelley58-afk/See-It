import sharp from "sharp";
import { logger, createLogContext } from "~/utils/logger.server";
import { validateTrustedUrl } from "~/utils/validate-shopify-url.server";

export type DownloadedImage = {
  buffer: Buffer;
  meta: {
    width: number;
    height: number;
    bytes: number;
    format: string;
  };
};

export async function downloadAndProcessImage(
  url: string,
  logContext: ReturnType<typeof createLogContext>,
  options: { maxDimension?: number; format?: "png" | "jpeg" } = {}
): Promise<DownloadedImage> {
  validateTrustedUrl(url, "image URL");

  const maxDimension = options.maxDimension ?? 2048;
  const format = options.format ?? "png";

  logger.info(
    { ...logContext, stage: "download", format },
    `[See It Now] Downloading image: ${url.substring(0, 80)}...`
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const pipeline = sharp(inputBuffer)
    .rotate() // Auto-orient based on EXIF
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

  const { data: buffer, info } =
    format === "png"
      ? await pipeline.png({ force: true }).toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: 90, force: true }).toBuffer({ resolveWithObject: true });

  const meta = {
    width: info.width || 0,
    height: info.height || 0,
    bytes: buffer.length,
    format: format,
  };

  logger.info(
    { ...logContext, stage: "download" },
    `[See It Now] Downloaded & Optimized (${format}): ${buffer.length} bytes`
  );

  return { buffer, meta };
}

export async function downloadRawImage(
  url: string,
  logContext: ReturnType<typeof createLogContext>
): Promise<Buffer> {
  validateTrustedUrl(url, "image URL");

  logger.info(
    { ...logContext, stage: "download-raw" },
    `[See It Now] Downloading raw image: ${url.substring(0, 80)}...`
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

