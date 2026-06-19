import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { STORAGE_BUCKETS } from "@/lib/storage/paths";
import { readSupabaseEnv } from "@/lib/env";
import { loadScriptEnv } from "./script-env";

loadScriptEnv();

const env = readSupabaseEnv();
const client = createSupabaseServiceClient(env);
const { data: buckets, error: listError } = await client.storage.listBuckets();

if (listError) {
  throw new Error("Supabase storage bucket listing failed: " + listError.message);
}

const existing = new Set((buckets ?? []).map((bucket) => bucket.name));

for (const bucket of STORAGE_BUCKETS) {
  if (existing.has(bucket)) {
    continue;
  }
  const { error } = await client.storage.createBucket(bucket, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error("Supabase storage bucket create failed for " + bucket + ": " + error.message);
  }
}

const smokeId = randomUUID();
const roomKey = "rooms/storage-verify-" + smokeId + "/original.jpg";
const signedUpload = await client.storage.from("rooms").createSignedUploadUrl(roomKey);
if (signedUpload.error) {
  throw new Error("Supabase rooms signed upload verification failed: " + signedUpload.error.message);
}

const renderKey = "renders/storage-verify-" + smokeId + "/pixel.png";
const upload = await client.storage.from("renders").upload(renderKey, Buffer.from("iVBORw0KGgo=", "base64"), {
  contentType: "image/png",
  upsert: true
});
if (upload.error) {
  throw new Error("Supabase renders upload verification failed: " + upload.error.message);
}
const signedRead = await client.storage.from("renders").createSignedUrl(renderKey, 60);
if (signedRead.error) {
  throw new Error("Supabase renders signed read verification failed: " + signedRead.error.message);
}
const cleanup = await client.storage.from("renders").remove([renderKey]);
if (cleanup.error) {
  throw new Error("Supabase storage smoke cleanup failed: " + cleanup.error.message);
}

console.log("Supabase storage verified buckets: " + STORAGE_BUCKETS.join(", "));
