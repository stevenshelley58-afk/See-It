import { createHmac, timingSafeEqual } from "node:crypto";

export function signShopifyParams(params: Record<string, string>, secret: string) {
  const message = Object.entries(params)
    .filter(([key]) => key !== "signature" && key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("");
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function verifyShopifyHmac(params: URLSearchParams, secret: string) {
  const provided = params.get("hmac") ?? params.get("signature");
  if (!provided) {
    return false;
  }
  const record: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key !== "hmac" && key !== "signature") {
      record[key] = value;
    }
  });
  const expected = signShopifyParams(record, secret);
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAppProxySignature(params: Record<string, string>, secret: string) {
  return signShopifyParams(params, secret);
}
