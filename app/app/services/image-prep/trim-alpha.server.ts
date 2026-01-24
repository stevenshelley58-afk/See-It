import sharp from "sharp";

export class TrimAlphaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrimAlphaError";
  }
}

/**
 * Deterministically trim fully/near-fully transparent padding from a PNG by scanning alpha bounds.
 *
 * - Requires a real alpha channel (metadata.hasAlpha === true)
 * - Uses threshold alpha > 1 for bounds inclusion
 * - Throws if fully transparent
 */
export async function trimTransparentPaddingPng(pngBuffer: Buffer): Promise<Buffer> {
  if (!pngBuffer || pngBuffer.length === 0) {
    throw new TrimAlphaError("Input PNG buffer is empty");
  }

  const meta = await sharp(pngBuffer).metadata();
  if (meta.format !== "png") {
    throw new TrimAlphaError(`Expected PNG input, got format=${meta.format || "unknown"}`);
  }
  if (!meta.hasAlpha) {
    throw new TrimAlphaError("PNG does not have an alpha channel");
  }

  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  if (!width || !height || channels < 4) {
    throw new TrimAlphaError("Invalid decoded PNG data");
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  // Alpha channel is byte 3 in RGBA
  const ALPHA_THRESHOLD = 1;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * channels;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * channels + 3;
      const a = data[idx];
      if (a > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    throw new TrimAlphaError("PNG is fully transparent (no alpha>1 pixels)");
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;

  // If already tight, re-encode anyway with fixed PNG options for determinism.
  const cropped = await sharp(pngBuffer)
    .extract({ left: minX, top: minY, width: cropWidth, height: cropHeight })
    .png({
      force: true,
      compressionLevel: 9,
      adaptiveFiltering: false,
      palette: false,
    })
    .toBuffer();

  return cropped;
}

