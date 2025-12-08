import { PrismaClient } from "@prisma/client";

/**
 * Database Connection Pool Configuration
 *
 * Prisma uses a connection pool to manage database connections efficiently.
 * These settings prevent pool exhaustion under load.
 *
 * Pool settings are configured via DATABASE_URL query parameters:
 * - connection_limit: Max connections in pool (default: num_cpus * 2 + 1)
 * - pool_timeout: Seconds to wait for a connection (default: 10)
 *
 * Example: DATABASE_URL="postgresql://...?connection_limit=10&pool_timeout=20"
 *
 * For Railway/serverless environments, we use conservative defaults:
 * - connection_limit=10 (prevents overwhelming DB under burst traffic)
 * - pool_timeout=20 (longer timeout for cold starts)
 *
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-prismaclient/connection-pool
 */

// Parse existing DATABASE_URL and ensure pool settings
function getDatabaseUrl() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  // Check if URL already has pool settings
  const url = new URL(baseUrl);
  const searchParams = url.searchParams;

  // Set defaults if not already specified
  if (!searchParams.has("connection_limit")) {
    // Conservative limit for serverless/Railway environments
    // Adjust based on your database's max_connections setting
    searchParams.set("connection_limit", process.env.DB_POOL_SIZE || "10");
  }

  if (!searchParams.has("pool_timeout")) {
    // 20 seconds timeout (allows for cold starts)
    searchParams.set("pool_timeout", process.env.DB_POOL_TIMEOUT || "20");
  }

  // Enable connection pooling mode for pgBouncer compatibility if needed
  if (process.env.DB_PGBOUNCER === "true" && !searchParams.has("pgbouncer")) {
    searchParams.set("pgbouncer", "true");
  }

  return url.toString();
}

// Prisma client configuration
const prismaClientConfig = {
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
  log:
    process.env.NODE_ENV === "development"
      ? [
          { level: "query", emit: "event" },
          { level: "error", emit: "stdout" },
          { level: "warn", emit: "stdout" },
        ]
      : [{ level: "error", emit: "stdout" }],
};

// Create client with connection pool monitoring
function createPrismaClient() {
  const client = new PrismaClient(prismaClientConfig);

  // Log slow queries in development
  if (process.env.NODE_ENV === "development") {
    client.$on("query", (e) => {
      if (e.duration > 1000) {
        console.warn(`[Prisma] Slow query (${e.duration}ms):`, e.query);
      }
    });
  }

  // Graceful shutdown handler
  const shutdown = async () => {
    console.log("[Prisma] Disconnecting...");
    await client.$disconnect();
  };

  // Handle various shutdown signals
  process.on("beforeExit", shutdown);

  return client;
}

// Use global singleton in development to prevent connection pool exhaustion during hot reload
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

/**
 * Health check for database connection
 * Use this in /healthz endpoint to verify DB connectivity
 */
export async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true };
  } catch (error) {
    console.error("[Prisma] Health check failed:", error);
    return {
      connected: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get current pool metrics (for debugging)
 * Note: Prisma doesn't expose pool metrics directly,
 * but we can track active queries via middleware
 */
let activeQueries = 0;
let totalQueries = 0;

prisma.$use(async (params, next) => {
  activeQueries++;
  totalQueries++;

  const start = Date.now();

  try {
    return await next(params);
  } finally {
    activeQueries--;
    const duration = Date.now() - start;

    // Log slow queries in production
    if (duration > 5000) {
      console.warn(
        `[Prisma] Very slow query (${duration}ms): ${params.model}.${params.action}`
      );
    }
  }
});

export function getPoolMetrics() {
  return {
    activeQueries,
    totalQueries,
    poolSize: parseInt(process.env.DB_POOL_SIZE || "10", 10),
    poolTimeout: parseInt(process.env.DB_POOL_TIMEOUT || "20", 10),
  };
}

export default prisma;
