import { spawnSync } from "node:child_process";
import fs from "node:fs";

/**
 * Check if URL points to Railway's internal networking.
 */
function isRailwayInternalHost(urlString) {
  const s = String(urlString ?? "");
  return s.includes(".railway.internal");
}

/**
 * Resolve DATABASE_URL for Prisma generate.
 *
 * Prisma schema requires DATABASE_URL to exist at generate time.
 * In this repo, Vercel often has DATABASE_PUBLIC_URL (from Railway integration)
 * but not DATABASE_URL. Prisma does not support env var fallbacks in schema,
 * so we resolve the URL here before running prisma generate.
 *
 * Priority:
 * 1. DATABASE_URL (if not Railway internal)
 * 2. DATABASE_PUBLIC_URL (fallback)
 *
 * This mirrors the logic in app/lib/db-url.js for consistency.
 */
function resolveDatabaseUrlForPrisma() {
  const privateUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;

  // No DATABASE_URL but have DATABASE_PUBLIC_URL
  if (!privateUrl && publicUrl) {
    return publicUrl;
  }

  // DATABASE_URL is Railway internal - use public URL if available
  if (privateUrl && isRailwayInternalHost(privateUrl) && publicUrl) {
    return publicUrl;
  }

  // Use DATABASE_URL as-is (or undefined if not set)
  return privateUrl;
}

// Set DATABASE_URL for Prisma
const resolvedUrl = resolveDatabaseUrlForPrisma();
if (resolvedUrl) {
  process.env.DATABASE_URL = resolvedUrl;
}

const isWin = process.platform === "win32";

const localPrismaCandidates = isWin
  ? [
      "node_modules\\.bin\\prisma.cmd",
      "..\\app\\node_modules\\.bin\\prisma.cmd",
      "..\\node_modules\\.bin\\prisma.cmd",
    ]
  : ["node_modules/.bin/prisma", "../app/node_modules/.bin/prisma", "../node_modules/.bin/prisma"];

const resolvedLocalPrisma = localPrismaCandidates.find((p) => fs.existsSync(p));
const useLocalPrisma = Boolean(resolvedLocalPrisma);

const command = isWin ? "cmd.exe" : useLocalPrisma ? resolvedLocalPrisma : "npx";
const args = isWin
  ? [
      "/d",
      "/s",
      "/c",
      useLocalPrisma
        ? `${resolvedLocalPrisma} generate --schema=./prisma/schema.prisma`
        : "npx prisma generate --schema=./prisma/schema.prisma",
    ]
  : useLocalPrisma
    ? ["generate", "--schema=./prisma/schema.prisma"]
    : ["prisma", "generate", "--schema=./prisma/schema.prisma"];

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("Failed to run Prisma generate:", result.error);
}

if (typeof result.status === "number" && result.status !== 0) {
  console.error(`Prisma generate failed with exit code ${result.status}`);
}

process.exit(result.status ?? 1);

