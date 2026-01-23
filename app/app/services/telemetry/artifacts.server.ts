/**
 * Telemetry Artifacts
 *
 * Store large payloads in GCS and index them in MonitorArtifact table.
 *
 * CRITICAL: Never throw on hot path. Artifact storage is best-effort.
 */

import crypto from "crypto";
import prisma from "~/db.server";
import { StorageService } from "~/services/storage.server";
import { RetentionClass, RETENTION_DAYS } from "./constants";
import type { ArtifactInput } from "./types";

/**
 * Store an artifact in GCS and create index record.
 * Returns artifact ID on success, null on failure.
 *
 * NEVER throws.
 */
export async function storeArtifact(
  input: ArtifactInput
): Promise<string | null> {
  try {
    const artifactId = crypto.randomUUID();
    const retention = input.retentionClass || RetentionClass.STANDARD;
    const retentionDays = RETENTION_DAYS[retention] || 30;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    let gcsKey: string;
    let byteSize: number;
    let sha256: string | undefined;

    if (input.buffer) {
      // Upload new artifact to GCS
      const prefix = input.runId
        ? `monitor/${input.shopId}/${input.runId}`
        : `monitor/${input.shopId}/${input.requestId}`;

      const ext = getExtension(input.contentType);
      gcsKey = `${prefix}/${artifactId}.${ext}`;

      await StorageService.uploadBuffer(input.buffer, gcsKey, input.contentType);

      byteSize = input.buffer.length;
      sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
    } else if (input.existingGcsKey) {
      // Index existing file (don't re-upload)
      gcsKey = input.existingGcsKey;
      byteSize = 0; // Unknown for existing files
    } else {
      console.error("[Artifacts] Must provide either buffer or existingGcsKey");
      return null;
    }

    // Create index record
    await prisma.monitorArtifact.create({
      data: {
        id: artifactId,
        shopId: input.shopId,
        requestId: input.requestId,
        runId: input.runId,
        variantId: input.variantId,
        type: input.type,
        gcsKey,
        contentType: input.contentType,
        byteSize,
        sha256,
        width: input.width,
        height: input.height,
        retentionClass: retention,
        expiresAt,
        meta: input.meta,
      },
    });

    return artifactId;
  } catch (error) {
    console.error("[Artifacts] Failed to store artifact:", error);
    return null;
  }
}

/**
 * Get a signed URL for an artifact.
 * Returns URL on success, null on failure.
 *
 * NEVER throws.
 */
export async function getArtifactUrl(
  artifactId: string,
  ttlMs: number = 60 * 60 * 1000 // 1 hour default
): Promise<string | null> {
  try {
    const artifact = await prisma.monitorArtifact.findUnique({
      where: { id: artifactId },
      select: { gcsKey: true },
    });

    if (!artifact) {
      console.error("[Artifacts] Artifact not found:", artifactId);
      return null;
    }

    return StorageService.getSignedReadUrl(artifact.gcsKey, ttlMs);
  } catch (error) {
    console.error("[Artifacts] Failed to get artifact URL:", error);
    return null;
  }
}

/**
 * Get signed URL directly from GCS key (bypass artifact lookup).
 * Returns URL on success, null on failure.
 *
 * NEVER throws.
 */
export async function getSignedUrl(
  gcsKey: string,
  ttlMs: number = 60 * 60 * 1000
): Promise<string | null> {
  try {
    return StorageService.getSignedReadUrl(gcsKey, ttlMs);
  } catch (error) {
    console.error("[Artifacts] Failed to get signed URL:", error);
    return null;
  }
}

/**
 * Index an existing GCS file as an artifact (no upload).
 * Returns artifact ID on success, null on failure.
 */
export async function indexExistingArtifact(
  input: Omit<ArtifactInput, "buffer"> & { gcsKey: string; byteSize?: number }
): Promise<string | null> {
  try {
    const artifactId = crypto.randomUUID();
    const retention = input.retentionClass || RetentionClass.STANDARD;
    const retentionDays = RETENTION_DAYS[retention] || 30;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    await prisma.monitorArtifact.create({
      data: {
        id: artifactId,
        shopId: input.shopId,
        requestId: input.requestId,
        runId: input.runId,
        variantId: input.variantId,
        type: input.type,
        gcsKey: input.gcsKey,
        contentType: input.contentType,
        byteSize: input.byteSize || 0,
        width: input.width,
        height: input.height,
        retentionClass: retention,
        expiresAt,
        meta: input.meta,
      },
    });

    return artifactId;
  } catch (error) {
    console.error("[Artifacts] Failed to index artifact:", error);
    return null;
  }
}

/**
 * Get file extension from content type.
 */
function getExtension(contentType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/json": "json",
    "text/plain": "txt",
    "application/zip": "zip",
  };
  return map[contentType] || "bin";
}
