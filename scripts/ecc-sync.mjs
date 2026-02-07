import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ECC_REPO = "affaan-m/everything-claude-code";
const ECC_REF = "90ad2f3885033c981ae1ab72120cef252296aa6c";

const COMMON_FILES = [
  "agents.md",
  "coding-style.md",
  "git-workflow.md",
  "hooks.md",
  "patterns.md",
  "performance.md",
  "security.md",
  "testing.md",
];

const TYPESCRIPT_FILES = [
  "coding-style.md",
  "hooks.md",
  "patterns.md",
  "security.md",
  "testing.md",
];

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function fetchTextOrThrow(url) {
  const res = await fetch(url, { headers: { "User-Agent": "see-it/ecc-sync" } });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.text();
}

async function writeRuleFile(outputDir, filename, content) {
  const dest = path.join(outputDir, filename);
  await fs.writeFile(dest, content, "utf8");
  return { filename, sha256: sha256Hex(content) };
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..");
  const outputDir = path.join(repoRoot, ".claude", "rules");

  await fs.mkdir(outputDir, { recursive: true });

  const written = [];

  // 1) Common rules (required)
  for (const filename of COMMON_FILES) {
    const url = `https://raw.githubusercontent.com/${ECC_REPO}/${ECC_REF}/rules/common/${filename}`;
    const content = await fetchTextOrThrow(url);
    written.push(await writeRuleFile(outputDir, filename, content));
  }

  // 2) TypeScript rules (overrides common where names overlap)
  for (const filename of TYPESCRIPT_FILES) {
    const url = `https://raw.githubusercontent.com/${ECC_REPO}/${ECC_REF}/rules/typescript/${filename}`;
    const content = await fetchTextOrThrow(url);
    written.push(await writeRuleFile(outputDir, filename, content));
  }

  const versionFile = path.join(outputDir, ".ecc-version.json");
  const versionPayload = {
    repo: ECC_REPO,
    ref: ECC_REF,
    files: Object.fromEntries(written.map((w) => [w.filename, w.sha256])),
  };

  await fs.writeFile(versionFile, JSON.stringify(versionPayload, null, 2) + "\n", "utf8");

  process.stdout.write(
    `ECC rules synced -> ${path.relative(repoRoot, outputDir)} (ref ${ECC_REF.slice(0, 12)})\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

