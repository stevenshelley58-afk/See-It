import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ECC_REPO = "affaan-m/everything-claude-code";
const ECC_REF = "90ad2f3885033c981ae1ab72120cef252296aa6c";

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..");
  const rulesDir = path.join(repoRoot, ".claude", "rules");

  const versionFile = path.join(rulesDir, ".ecc-version.json");
  if (!(await fileExists(versionFile))) {
    throw new Error("Missing .claude/rules/.ecc-version.json. Run: node scripts/ecc-sync.mjs");
  }

  const raw = await fs.readFile(versionFile, "utf8");
  const parsed = JSON.parse(raw);

  if (parsed.repo !== ECC_REPO || parsed.ref !== ECC_REF) {
    throw new Error(
      `ECC version mismatch.\n` +
        `Expected: ${ECC_REPO}@${ECC_REF}\n` +
        `Found: ${parsed.repo}@${parsed.ref}\n` +
        `Run: node scripts/ecc-sync.mjs`
    );
  }

  const expectedFiles = parsed.files || {};
  const missing = [];
  const modified = [];

  for (const [filename, expectedHash] of Object.entries(expectedFiles)) {
    const filePath = path.join(rulesDir, filename);
    if (!(await fileExists(filePath))) {
      missing.push(filename);
      continue;
    }

    const content = await fs.readFile(filePath, "utf8");
    const actualHash = sha256Hex(content);
    if (actualHash !== expectedHash) {
      modified.push(filename);
    }
  }

  const seeItRule = path.join(rulesDir, "see-it.md");
  if (!(await fileExists(seeItRule))) {
    missing.push("see-it.md");
  }

  if (missing.length > 0 || modified.length > 0) {
    const lines = [];
    if (missing.length > 0) lines.push(`Missing: ${missing.join(", ")}`);
    if (modified.length > 0) lines.push(`Modified: ${modified.join(", ")}`);
    lines.push("Run: node scripts/ecc-sync.mjs");
    throw new Error(lines.join("\n"));
  }

  process.stdout.write("ECC rules verified.\n");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

