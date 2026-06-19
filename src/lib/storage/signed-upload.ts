import { roomOriginalPath } from "@/lib/storage/paths";

export function createSignedUpload(roomSessionId: string, fileName: string, mimeType: string) {
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
