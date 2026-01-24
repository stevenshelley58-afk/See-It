import sharp from "sharp";
import { validateMagicBytes } from "./gemini-files.server";
import { logger, createLogContext } from "../utils/logger.server";

const PHOTOROOM_API_URL = "https://image-api.photoroom.com/v2/edit";

function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredBackoffMs(attempt: number): number {
  // 250ms, 500ms, 1000ms... with 0-150ms jitter
  const base = 250 * Math.pow(2, Math.max(0, attempt));
  const jitter = Math.floor(Math.random() * 150);
  return base + jitter;
}

export class PhotoRoomTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`PhotoRoom request timed out after ${timeoutMs}ms`);
    this.name = "PhotoRoomTimeoutError";
  }
}

export class PhotoRoomRateLimitError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(message: string, opts: { status: number; retryAfterMs?: number }) {
    super(message);
    this.name = "PhotoRoomRateLimitError";
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export class PhotoRoomBadResponseError extends Error {
  status?: number;
  constructor(message: string, opts?: { status?: number }) {
    super(message);
    this.name = "PhotoRoomBadResponseError";
    this.status = opts?.status;
  }
}

export async function photoroomRemoveBackground(opts: {
  buffer: Buffer;
  contentType: string;
  requestId: string;
  mode?: "standard" | "hd_auto";
}): Promise<Buffer> {
  const {
    buffer,
    contentType,
    requestId,
    mode = "standard",
  } = opts;

  if (!process.env.PHOTOROOM_API_KEY) {
    throw new Error("PHOTOROOM_API_KEY environment variable is not set");
  }

  // PhotoRoom max input is 30MB per docs.
  const MAX_BYTES = 30 * 1024 * 1024;
  if (buffer.length > MAX_BYTES) {
    throw new PhotoRoomBadResponseError(
      `Input image exceeds PhotoRoom max size (${buffer.length} > ${MAX_BYTES} bytes)`
    );
  }

  const timeoutMs = getEnvInt("PHOTOROOM_TIMEOUT_MS", 30_000);
  const retryMax = getEnvInt("PHOTOROOM_RETRY_MAX", 1);
  const deadlineAt = Date.now() + timeoutMs;

  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= retryMax) {
    const attemptStart = Date.now();
    const remainingMs = deadlineAt - attemptStart;
    if (remainingMs <= 0) {
      throw new PhotoRoomTimeoutError(timeoutMs);
    }

    const logContext = createLogContext("prepare", requestId, "photoroom", {
      attempt,
      mode,
      inputBytes: buffer.length,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), remainingMs);

    try {
      const form = new FormData();
      form.append("imageFile", new Blob([buffer as any], { type: contentType }), "image");
      form.append("export.format", "png");
      form.append("outputSize", "originalImage");
      form.append("removeBackground", "true");

      const headers: Record<string, string> = {
        "x-api-key": process.env.PHOTOROOM_API_KEY,
        Accept: "image/png, application/json",
      };

      if (mode === "hd_auto") {
        // HD background removal: auto mode (per PhotoRoom docs).
        headers["pr-hd-background-removal"] = "auto";
      }

      const resp = await fetch(PHOTOROOM_API_URL, {
        method: "POST",
        headers,
        body: form as any,
        signal: controller.signal,
      });

      const durationMs = Date.now() - attemptStart;

      // Rate limit handling (retry only on 429)
      if (resp.status === 429) {
        const retryAfter = resp.headers.get("retry-after");
        const retryAfterMs = retryAfter ? Math.max(0, Number(retryAfter) * 1000) : undefined;
        const waitMs = retryAfterMs ?? jitteredBackoffMs(attempt);

        logger.warn(
          { ...logContext, stage: "rate-limit", status: resp.status, durationMs, waitMs },
          "PhotoRoom rate-limited (429)"
        );

        if (attempt >= retryMax) {
          throw new PhotoRoomRateLimitError("PhotoRoom rate-limited (429) and retries exhausted", {
            status: 429,
            retryAfterMs: waitMs,
          });
        }

        const remainingAfterWait = deadlineAt - Date.now();
        if (remainingAfterWait <= waitMs) {
          throw new PhotoRoomTimeoutError(timeoutMs);
        }

        await sleep(waitMs);
        attempt += 1;
        continue;
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        logger.warn(
          { ...logContext, stage: "bad-status", status: resp.status, durationMs, bodyPreview: text.slice(0, 200) },
          "PhotoRoom returned non-OK response"
        );
        throw new PhotoRoomBadResponseError(
          `PhotoRoom request failed (HTTP ${resp.status})`,
          { status: resp.status }
        );
      }

      const arr = await resp.arrayBuffer();
      let out: Buffer<ArrayBufferLike> = Buffer.from(arr);

      logger.info(
        { ...logContext, stage: "ok", status: resp.status, durationMs, outputBytes: out.length },
        "PhotoRoom edit completed"
      );

      // Force/verify PNG output invariants
      try {
        validateMagicBytes(out, "image/png");
      } catch {
        // Provider returned something unexpected; force PNG.
        out = (await sharp(out).png({ force: true }).toBuffer()) as Buffer<ArrayBufferLike>;
        validateMagicBytes(out, "image/png");
      }

      return out;
    } catch (err: any) {
      lastErr = err;

      // AbortController timeout
      if (err?.name === "AbortError") {
        logger.warn({ ...logContext, stage: "timeout" }, "PhotoRoom request aborted (timeout)");
        throw new PhotoRoomTimeoutError(timeoutMs);
      }

      // Non-429 errors are not retried here (by spec).
      logger.warn({ ...logContext, stage: "error" }, "PhotoRoom request failed", err);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new PhotoRoomBadResponseError("PhotoRoom request failed");
}

