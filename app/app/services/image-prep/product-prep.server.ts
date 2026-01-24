import crypto from "crypto";
import sharp from "sharp";
import prisma from "../../db.server";
import { logger, createLogContext } from "../../utils/logger.server";
import { validateMagicBytes } from "../gemini-files.server";
import { photoroomRemoveBackground } from "../photoroom.server";
import { trimTransparentPaddingPng } from "./trim-alpha.server";

type PrepStrategy =
  | "batch_prepare"
  | "manual_remove_bg"
  | "manual_apply_mask_edge_assist"
  | "manual_upload_prepared"
  | "manual_use_original"
  | "manual_save_refined"
  | string;

function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

class Semaphore {
  private available: number;
  private queue: Array<(release: () => void) => void> = [];

  constructor(max: number) {
    this.available = Math.max(1, Math.floor(max));
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push((release) => resolve(release));
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) {
      next(() => this.release());
      return;
    }
    this.available += 1;
  }
}

let globalSemaphore: Semaphore | null = null;
function getGlobalSemaphore(): Semaphore {
  if (!globalSemaphore) {
    globalSemaphore = new Semaphore(getEnvInt("PHOTOROOM_CONCURRENCY_MAX", 3));
  }
  return globalSemaphore;
}

const inFlightByShop = new Map<string, Promise<void>>();

function shopLockKey64(shopId: string): bigint {
  // Deterministic 64-bit signed key for pg_advisory_* locks.
  const hash = crypto.createHash("sha256").update(shopId).digest();
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v = (v << 8n) | BigInt(hash[i]);
  }
  return BigInt.asIntN(64, v);
}

function isPostgresDatabase(): boolean {
  const url = process.env.DATABASE_URL || "";
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

async function withPerShopThrottle<T>(
  shopId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!shopId) return fn();

  // In-process throttle: serialize by shopId.
  const prev = inFlightByShop.get(shopId) || Promise.resolve();
  let releaseLocal: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLocal = resolve;
  });
  const chained = prev.then(() => current);
  inFlightByShop.set(shopId, chained);

  try {
    await prev;

    // Cross-process throttle: Postgres advisory lock (only when using Postgres).
    if (isPostgresDatabase()) {
      const key = shopLockKey64(shopId);
      return await prisma.$transaction(async (tx: any) => {
        // Use blocking lock; global concurrency cap keeps pool impact bounded.
        await tx.$executeRaw`SELECT pg_advisory_lock(${key})`;
        try {
          return await fn();
        } finally {
          await tx.$executeRaw`SELECT pg_advisory_unlock(${key})`;
        }
      });
    }

    return await fn();
  } finally {
    try {
      releaseLocal!();
    } finally {
      // Clean up map if nothing else is queued.
      if (inFlightByShop.get(shopId) === chained) {
        inFlightByShop.delete(shopId);
      }
    }
  }
}

export async function normalizeToPng(opts: {
  sourceBuffer: Buffer;
  maxEdgePx?: number;
}): Promise<Buffer> {
  const { sourceBuffer, maxEdgePx = 2048 } = opts;
  return sharp(sourceBuffer)
    .rotate()
    .resize({
      width: maxEdgePx,
      height: maxEdgePx,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ force: true })
    .toBuffer();
}

export async function prepareProductImage(opts: {
  sourceBuffer: Buffer;
  sourceContentType: string;
  requestId: string;
  shopId?: string;
  productAssetId?: string;
  strategy: PrepStrategy;
}): Promise<{ preparedPng: Buffer }> {
  const { sourceBuffer, requestId, shopId, productAssetId, strategy } = opts;

  const logContext = createLogContext("prepare", requestId, "product-prep", {
    shopId,
    productAssetId,
    strategy,
  });

  // Global PhotoRoom concurrency cap (all shops).
  const sem = getGlobalSemaphore();
  const release = await sem.acquire();

  try {
    return await withPerShopThrottle(shopId, async () => {
      const start = Date.now();

      // 1) Normalize to PNG (EXIF-rotate + resize max 2048px)
      const normalizedPng = await normalizeToPng({ sourceBuffer, maxEdgePx: 2048 });
      validateMagicBytes(normalizedPng, "image/png");

      // 2) Cutout (PhotoRoom) - keep original dimensions for alignment
      const cutoutPng = await photoroomRemoveBackground({
        buffer: normalizedPng,
        contentType: "image/png",
        requestId,
        mode: "standard",
      });

      // 3) Trim (alpha-bounds, deterministic) - always in our code
      const trimmedPng = await trimTransparentPaddingPng(cutoutPng);

      // 4) Validate invariants: PNG magic bytes + alpha channel
      validateMagicBytes(trimmedPng, "image/png");
      const meta = await sharp(trimmedPng).metadata();
      if (!meta.hasAlpha) {
        throw new Error("Prepared output must have alpha channel (hasAlpha=false)");
      }
      if (!meta.width || !meta.height) {
        throw new Error("Prepared output missing dimensions");
      }

      const durationMs = Date.now() - start;
      logger.info(
        { ...logContext, stage: "complete", durationMs, bytes: trimmedPng.length, width: meta.width, height: meta.height },
        "Prepared product image"
      );

      return { preparedPng: trimmedPng };
    });
  } finally {
    release();
  }
}

