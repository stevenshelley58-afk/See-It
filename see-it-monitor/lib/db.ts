// =============================================================================
// DATABASE CONNECTION - Prisma Client for See It Monitor
// Connects to the same database as the main app
// =============================================================================

import { PrismaClient } from "@prisma/client";

// Extend the global namespace to include prisma for hot reloading
declare global {
  // eslint-disable-next-line no-var
  var prismaMonitor: PrismaClient | undefined;
}

/**
 * Check if URL points to Railway's internal networking.
 */
function isRailwayInternalHost(urlString: string): boolean {
  return urlString.includes(".railway.internal");
}

/**
 * Resolve database URL with Railway/Vercel awareness and apply pool settings.
 *
 * Priority:
 * 1. DATABASE_URL (if not Railway internal)
 * 2. DATABASE_PUBLIC_URL (fallback)
 *
 * This mirrors the logic in app/lib/db-url.js for consistency.
 */
function getDatabaseUrl(): string {
  const privateUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;

  // Prefer the public URL if DATABASE_URL is Railway-internal (Vercel can't reach it).
  let baseUrl: string | undefined;
  if (privateUrl && !isRailwayInternalHost(privateUrl)) {
    baseUrl = privateUrl;
  } else if (publicUrl) {
    baseUrl = publicUrl;
  } else {
    baseUrl = privateUrl; // Will fail if Railway internal, but that's the right error
  }

  if (!baseUrl) {
    throw new Error(
      "Neither DATABASE_URL nor DATABASE_PUBLIC_URL environment variable is set"
    );
  }

  // Check if URL already has pool settings
  const url = new URL(baseUrl);
  const searchParams = url.searchParams;

  // Set defaults if not already specified - standardized to 10 (same as main app)
  if (!searchParams.has("connection_limit")) {
    searchParams.set("connection_limit", process.env.DB_POOL_SIZE || "10");
  }

  if (!searchParams.has("pool_timeout")) {
    searchParams.set("pool_timeout", process.env.DB_POOL_TIMEOUT || "20");
  }

  return url.toString();
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

  return client;
}

// Use global singleton in development to prevent connection pool exhaustion during hot reload
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaMonitor) {
    global.prismaMonitor = createPrismaClient();
  }
}

const prisma = global.prismaMonitor ?? createPrismaClient();

export default prisma;
