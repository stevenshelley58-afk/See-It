import { existsSync, readFileSync, statSync } from "node:fs";
import { globSync } from "node:fs";

const required = ["BUILD-SPEC.md", "AGENTS.md", "supabase/migrations/0001_initial.sql", "src/lib/ai/router.ts", "extension/assets/widget.js"];
for (const file of required) {
  if (!existsSync(file)) {
    throw new Error("Missing required file: " + file);
  }
}

const srcFiles = globSync("src/**/*.{ts,tsx}");
for (const file of srcFiles) {
  if (file.replace(/\\/g, "/") !== "src/lib/env.ts") {
    const text = readFileSync(file, "utf8");
    if (text.includes("process.env")) {
      throw new Error("process.env outside src/lib/env.ts: " + file);
    }
  }
}

const widgetBytes = statSync("extension/assets/widget.js").size;
if (widgetBytes > 30 * 1024) {
  throw new Error("Widget initial JS over 30KB: " + widgetBytes);
}

console.log("static verify passed");
