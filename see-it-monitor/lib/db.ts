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

function isRailwayInternalHost(urlString: string): boolean {
  return urlString.includes(".railway.internal");
}

function getDatabaseUrl(): string {
  const privateUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;

  // Prefer the public URL if DATABASE_URL is Railway-internal (Vercel can't reach it).
  const baseUrl =
    privateUrl && !isRailwayInternalHost(privateUrl) ? privateUrl : publicUrl;
  if (!baseUrl) {
    throw new Error("DATABASE_URL or DATABASE_PUBLIC_URL environment variable is not set");
  }

  // Check if URL already has pool settings
  const url = new URL(baseUrl);
  const searchParams = url.searchParams;

  // Set defaults if not already specified
  if (!searchParams.has("connection_limit")) {
    searchParams.set("connection_limit", process.env.DB_POOL_SIZE || "5");
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
