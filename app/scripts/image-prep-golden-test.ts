import { readdir, readFile } from "fs/promises";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { prepareProductImage } from "../app/services/image-prep/product-prep.server";
import { validateMagicBytes } from "../app/services/gemini-files.server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SAMPLES_DIR = join(__dirname, "golden", "product-samples");

function contentTypeFromExt(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function assertTrimIsTight(png: Buffer) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (!width || !height || channels < 4) throw new Error("Invalid decoded PNG");

  const alphaAt = (x: number, y: number) => data[(y * width + x) * channels + 3];
  const hasAlphaOnTop = Array.from({ length: width }).some((_, x) => alphaAt(x, 0) > 1);
  const hasAlphaOnBottom = Array.from({ length: width }).some((_, x) => alphaAt(x, height - 1) > 1);
  const hasAlphaOnLeft = Array.from({ length: height }).some((_, y) => alphaAt(0, y) > 1);
  const hasAlphaOnRight = Array.from({ length: height }).some((_, y) => alphaAt(width - 1, y) > 1);

  if (!hasAlphaOnTop || !hasAlphaOnBottom || !hasAlphaOnLeft || !hasAlphaOnRight) {
    throw new Error("Trim is not tight (at least one edge has no alpha>1 pixels)");
  }
}

async function main() {
  if (!process.env.PHOTOROOM_API_KEY) {
    console.error("PHOTOROOM_API_KEY is required to run golden test");
    process.exit(1);
  }

  const entries = await readdir(SAMPLES_DIR).catch(() => []);
  const files = entries
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => join(SAMPLES_DIR, f));

  if (files.length === 0) {
    console.error(`No sample images found in ${SAMPLES_DIR}`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const filePath of files) {
    const name = filePath.split(/[/\\]/).pop() || filePath;
    const input = await readFile(filePath);
    const contentType = contentTypeFromExt(filePath);

    const startedAt = Date.now();
    try {
      const { preparedPng } = await prepareProductImage({
        sourceBuffer: input,
        sourceContentType: contentType,
        requestId: "golden-test",
        strategy: "golden-test",
      });

      validateMagicBytes(preparedPng, "image/png");
      const meta = await sharp(preparedPng).metadata();
      if (!meta.hasAlpha) throw new Error("Missing alpha channel");
      if (!meta.width || !meta.height) throw new Error("Missing dimensions");

      await assertTrimIsTight(preparedPng);

      const ms = Date.now() - startedAt;
      console.log(`[PASS] ${name} (${meta.width}x${meta.height}, ${preparedPng.length} bytes, ${ms}ms)`);
      passed += 1;
    } catch (err) {
      const ms = Date.now() - startedAt;
      console.error(`[FAIL] ${name} (${ms}ms): ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }

  console.log(`Golden test summary: passed=${passed}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

