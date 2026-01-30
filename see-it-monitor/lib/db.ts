// =============================================================================
// DATABASE CONNECTION - Prisma Client for See It Monitor
// Connects to the same database as the main app
// =============================================================================

import { PrismaClient } from "@prisma/client";

type ResolvedDatabaseUrl = {
  url: string;
  source: "DATABASE_URL" | "DATABASE_PUBLIC_URL";
  isRailwayInternal: boolean;
  warnings: string[];
};

// Extend the global namespace to include prisma for hot reloading
declare global {
  // eslint-disable-next-line no-var
  var prismaMonitor: PrismaClient | undefined;
}

function isPostgresUrl(value: string | undefined | null): boolean {
  const v = String(value ?? "");
  return v.startsWith("postgresql://") || v.startsWith("postgres://");
}

function isRailwayInternalHost(urlString: string | undefined | null): boolean {
  const s = String(urlString ?? "");
  return s.includes(".railway.internal");
}

function isRailwayTcpProxyHost(urlString: string | undefined | null): boolean {
  const s = String(urlString ?? "");
  return s.includes(".proxy.rlwy.net");
}

function shouldUseSsl(connectionString: string): boolean {
  return (
    connectionString.includes("sslmode=require") ||
    connectionString.includes("ssl=true") ||
    process.env.PGSSLMODE === "require" ||
    isRailwayTcpProxyHost(connectionString)
  );
}

function resolveDatabaseUrl(options: {
  throwOnMissing?: boolean;
  validateFormat?: boolean;
  checkPassword?: boolean;
} = {}): ResolvedDatabaseUrl {
  const {
    throwOnMissing = true,
    validateFormat = true,
    checkPassword = true,
  } = options;

  const warnings: string[] = [];
  const privateUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;

  let url: string | undefined;
  let source: ResolvedDatabaseUrl["source"] = "DATABASE_URL";
  let isRailwayInternal = false;

  if (privateUrl && !isRailwayInternalHost(privateUrl)) {
    url = privateUrl;
    source = "DATABASE_URL";
  } else if (privateUrl && isRailwayInternalHost(privateUrl)) {
    isRailwayInternal = true;
    if (publicUrl) {
      url = publicUrl;
      source = "DATABASE_PUBLIC_URL";
      warnings.push(
        "DATABASE_URL points to Railway internal host; using DATABASE_PUBLIC_URL"
      );
    } else {
      url = privateUrl;
      source = "DATABASE_URL";
      warnings.push(
        "DATABASE_URL points to Railway internal host but DATABASE_PUBLIC_URL is not set. Connection will fail from outside Railway."
      );
    }
  } else if (publicUrl) {
    url = publicUrl;
    source = "DATABASE_PUBLIC_URL";
  }

  if (!url) {
    if (throwOnMissing) {
      throw new Error(
        "Neither DATABASE_URL nor DATABASE_PUBLIC_URL environment variable is set"
      );
    }
    return {
      url: "",
      source: "DATABASE_URL",
      isRailwayInternal: false,
      warnings: ["No database URL configured"],
    };
  }

  if (validateFormat && !isPostgresUrl(url)) {
    const prefix = String(url).slice(0, 40);
    throw new Error(
      `Database URL must be a Postgres URL (postgres:// or postgresql://). Got: ${prefix}...`
    );
  }

  if (checkPassword) {
    try {
      const parsed = new URL(url);
      if (!parsed.password) {
        warnings.push(
          "Database URL is missing a password. Connection may fail with SCRAM authentication error."
        );
      }
    } catch {
      // Leave detailed error to the driver
    }
  }

  return { url, source, isRailwayInternal, warnings };
}

function applyPooling(connectionString: string): string {
  const parsed = new URL(connectionString);
  const searchParams = parsed.searchParams;

  if (!searchParams.has("connection_limit")) {
    const limit = process.env.DB_POOL_SIZE ?? "10";
    searchParams.set("connection_limit", String(limit));
  }

  if (!searchParams.has("pool_timeout")) {
    const timeout = process.env.DB_POOL_TIMEOUT ?? "20";
    searchParams.set("pool_timeout", String(timeout));
  }

  if (process.env.DB_PGBOUNCER === "true" && !searchParams.has("pgbouncer")) {
    searchParams.set("pgbouncer", "true");
  }

  // Ensure SSL is enabled for public Railway endpoints
  if (shouldUseSsl(parsed.toString()) && !searchParams.has("sslmode")) {
    searchParams.set("sslmode", "require");
  }

  return parsed.toString();
}

function logConnectionInfo(resolved: ResolvedDatabaseUrl): void {
  console.log(`[DB] Using ${resolved.source}`);
  if (resolved.isRailwayInternal) {
    console.log("[DB] Railway internal URL detected, using public fallback when available");
  }
  for (const warning of resolved.warnings) {
    console.warn(`[DB] Warning: ${warning}`);
  }
}

function createPrismaClient(): PrismaClient {
  const resolved = resolveDatabaseUrl();
  const urlWithPooling = applyPooling(resolved.url);
  logConnectionInfo(resolved);

  return new PrismaClient({
    datasources: {
      db: {
        url: urlWithPooling,
      },
    },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

// Use global singleton in development to prevent connection pool exhaustion during hot reload
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaMonitor) {
    global.prismaMonitor = createPrismaClient();
  }
}

const prisma = global.prismaMonitor ?? createPrismaClient();

export default prisma;
