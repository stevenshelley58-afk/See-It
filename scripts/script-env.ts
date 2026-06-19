import { existsSync, readFileSync } from "node:fs";

export function loadScriptEnv() {
  for (const path of [".env", ".env.local"]) {
    if (!existsSync(path)) {
      continue;
    }
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) {
        continue;
      }
      const [key, ...parts] = line.split("=");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = parts.join("=").replace(/^["']|["']$/g, "");
    }
  }
}
