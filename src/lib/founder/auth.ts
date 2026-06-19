import { readEnv, type AppEnv } from "@/lib/env";

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createFounderSessionToken(password: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode("see-it-founder:" + password));
  return toHex(signature);
}

export async function isFounderPasswordValid(password: string, env: Pick<AppEnv, "FOUNDER_PASSWORD"> = readEnv()) {
  return password.length > 0 && password === env.FOUNDER_PASSWORD;
}

export async function isFounderSessionTokenValid(token: string | undefined, env: Pick<AppEnv, "FOUNDER_PASSWORD" | "ENCRYPTION_KEY"> = readEnv()) {
  if (!token) {
    return false;
  }
  return token === await createFounderSessionToken(env.FOUNDER_PASSWORD, env.ENCRYPTION_KEY);
}

export async function isFounderHeaderValid(headerValue: string | null, env: Pick<AppEnv, "FOUNDER_PASSWORD"> = readEnv()) {
  return Boolean(headerValue) && await isFounderPasswordValid(headerValue ?? "", env);
}
