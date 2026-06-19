const SECRET_KEYS = ["authorization", "api_key", "apikey", "token", "secret", "password", "signedurl", "uploadtoken", "access_token"];

function looksSignedUrl(value: string) {
  return /[?&](token|signature|x-amz-signature|expires|x-goog-signature)=/i.test(value);
}

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.replace(/[_-]/g, "").toLowerCase();
      if (SECRET_KEYS.some((secret) => normalized.includes(secret))) {
        output[key] = "[redacted]";
      } else {
        output[key] = redactSecrets(inner);
      }
    }
    return output as T;
  }
  if (typeof value === "string" && looksSignedUrl(value)) {
    return "[redacted-url]" as T;
  }
  return value;
}
