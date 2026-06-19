import { createHash } from "node:crypto";
import { readEnv, type AppEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase";

function resolveEnv(env?: AppEnv) {
  if (env) {
    return env;
  }
  try {
    return readEnv();
  } catch {
    return undefined;
  }
}

export function base64Sha256(base64: string) {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

export async function uploadGeneratedBase64Asset(bucket: string, storageKey: string, base64: string, mimeType: string, env?: AppEnv) {
  const resolvedEnv = resolveEnv(env);
  const sha256 = base64Sha256(base64);
  if (!resolvedEnv || resolvedEnv.APP_ENV === "test" || resolvedEnv.SUPABASE_URL.includes("supabase.local")) {
    return { storageKey, sha256, bytes: Buffer.byteLength(base64, "base64"), stored: false };
  }
  const client = createSupabaseServiceClient(resolvedEnv);
  const { error } = await client.storage.from(bucket).upload(storageKey, Buffer.from(base64, "base64"), {
    contentType: mimeType,
    upsert: true
  });
  if (error) {
    throw new Error("supabase_generated_upload_failed: " + error.message);
  }
  return { storageKey, sha256, bytes: Buffer.byteLength(base64, "base64"), stored: true };
}
