import { spawnSync } from "node:child_process";
import fs from "node:fs";

function isRailwayInternalHost(urlString) {
  const s = String(urlString ?? "");
  return s.includes(".railway.internal");
}

/**
 * Prisma schema requires DATABASE_URL to exist at generate time.
 *
 * In this repo, Vercel often has DATABASE_PUBLIC_URL (from Railway integration)
 * but not DATABASE_URL. Prisma does not support env var fallbacks in schema,
 * so we map DATABASE_PUBLIC_URL -> DATABASE_URL for the generate step.
 */
if (!process.env.DATABASE_URL && process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

// If DATABASE_URL exists but points at Railway private networking, prefer the public URL
// for build environments like Vercel that cannot reach .railway.internal.
if (
  process.env.DATABASE_URL &&
  isRailwayInternalHost(process.env.DATABASE_URL) &&
  process.env.DATABASE_PUBLIC_URL
) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
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

