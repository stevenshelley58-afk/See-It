import { roomOriginalPath } from "@/lib/storage/paths";
import { readEnv, type AppEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase";

function localSignedUpload(roomSessionId: string, fileName: string, mimeType: string) {
  const ext = fileName.split(".").pop() || (mimeType === "image/png" ? "png" : "jpg");
  const roomKey = roomOriginalPath(roomSessionId, ext);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  return {
    uploadUrl: "https://supabase.local/storage/v1/object/upload/sign/" + roomKey + "?token=redacted",
    uploadToken: crypto.randomUUID(),
    roomKey,
    expiresAt
  };
}

export async function createSignedUpload(roomSessionId: string, fileName: string, mimeType: string, env?: AppEnv) {
  const fallback = localSignedUpload(roomSessionId, fileName, mimeType);
  let resolvedEnv = env;
  if (!resolvedEnv) {
    try {
      resolvedEnv = readEnv();
    } catch {
      return fallback;
    }
  }
  if (resolvedEnv.APP_ENV === "test" || resolvedEnv.SUPABASE_URL.includes("supabase.local")) {
    return fallback;
  }
  const client = createSupabaseServiceClient(resolvedEnv);
  const { data, error } = await client.storage.from("rooms").createSignedUploadUrl(fallback.roomKey);
  if (error) {
    throw new Error("supabase_signed_upload_failed: " + error.message);
  }
  return {
    uploadUrl: data.signedUrl,
    uploadToken: data.token,
    roomKey: fallback.roomKey,
    expiresAt: fallback.expiresAt
  };
}

export function verifySignedUpload(input: { roomKey: string; mimeType: string; width?: number; height?: number; bytes?: number; expiresAt?: string }) {
  if (!input.roomKey.startsWith("rooms/")) {
    throw new Error("Invalid room storage key");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(input.mimeType)) {
    throw new Error("Invalid room MIME type");
  }
  if (input.bytes && input.bytes > 15 * 1024 * 1024) {
    throw new Error("Room upload too large");
  }
  if (input.expiresAt && new Date(input.expiresAt).getTime() < Date.now()) {
    throw new Error("room_upload_expired");
  }
  return { ok: true, width: input.width ?? 1600, height: input.height ?? 1200 };
}

export async function createSignedReadUrl(bucket: string, storageKey: string, ttlSeconds = 3600, env?: AppEnv) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const fallback = {
    url: "https://supabase.local/storage/v1/object/sign/" + bucket + "/" + storageKey + "?token=redacted",
    expiresAt
  };
  let resolvedEnv = env;
  if (!resolvedEnv) {
    try {
      resolvedEnv = readEnv();
    } catch {
      return fallback;
    }
  }
  if (resolvedEnv.APP_ENV === "test" || resolvedEnv.SUPABASE_URL.includes("supabase.local")) {
    return fallback;
  }
  const client = createSupabaseServiceClient(resolvedEnv);
  const { data, error } = await client.storage.from(bucket).createSignedUrl(storageKey, ttlSeconds);
  if (error) {
    throw new Error("supabase_signed_read_failed: " + error.message);
  }
  return { url: data.signedUrl, expiresAt };
}
