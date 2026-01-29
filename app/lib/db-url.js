/**
 * Unified DATABASE_URL resolver for Railway/Vercel environments.
 *
 * This module centralizes database URL resolution logic that was previously
 * fragmented across multiple files with inconsistent patterns:
 *
 * - Detects Railway internal hosts and falls back to public URL
 * - Validates postgres:// format
 * - Checks for missing password
 * - Returns source info for debugging
 * - Configures pool settings consistently
 *
 * @example
 * import { resolveDatabaseUrl, getDatabaseUrlWithPooling } from '../lib/db-url.js';
 *
 * // Basic resolution
 * const { url, source, warnings } = resolveDatabaseUrl();
 *
 * // With pool settings (for Prisma)
 * const urlWithPooling = getDatabaseUrlWithPooling();
 */

/**
 * Check if a URL is a valid Postgres connection string.
 * @param {string | undefined | null} value
 * @returns {boolean}
 */
export function isPostgresUrl(value) {
  const v = String(value ?? "");
  return v.startsWith("postgresql://") || v.startsWith("postgres://");
}

/**
 * Check if URL points to Railway's internal networking.
 * These hosts are only reachable from within Railway's network.
 * @param {string | undefined | null} urlString
 * @returns {boolean}
 */
export function isRailwayInternalHost(urlString) {
  const s = String(urlString ?? "");
  return s.includes(".railway.internal");
}

/**
 * Check if URL points to Railway's TCP proxy (public endpoint).
 * @param {string | undefined | null} urlString
 * @returns {boolean}
 */
export function isRailwayTcpProxyHost(urlString) {
  const s = String(urlString ?? "");
  return s.includes(".proxy.rlwy.net");
}

/**
 * Determine if SSL should be enabled for a connection string.
 * @param {string} connectionString
 * @returns {boolean}
 */
export function shouldUseSsl(connectionString) {
  return (
    connectionString.includes("sslmode=require") ||
    connectionString.includes("ssl=true") ||
    process.env.PGSSLMODE === "require" ||
    isRailwayTcpProxyHost(connectionString)
  );
}

/**
 * @typedef {Object} ResolvedDatabaseUrl
 * @property {string} url - The resolved database URL
 * @property {'DATABASE_URL' | 'DATABASE_PUBLIC_URL'} source - Which env var was used
 * @property {boolean} isRailwayInternal - Whether the original DATABASE_URL was Railway internal
 * @property {string[]} warnings - Any warnings about the configuration
 */

/**
 * Resolve the database URL with Railway/Vercel awareness.
 *
 * Priority:
 * 1. DATABASE_URL (if not Railway internal)
 * 2. DATABASE_PUBLIC_URL (fallback)
 *
 * @param {Object} [options]
 * @param {boolean} [options.throwOnMissing=true] - Throw if no URL is found
 * @param {boolean} [options.validateFormat=true] - Validate postgres:// format
 * @param {boolean} [options.checkPassword=true] - Warn if password is missing
 * @returns {ResolvedDatabaseUrl}
 * @throws {Error} If no valid database URL is found and throwOnMissing is true
 */
export function resolveDatabaseUrl(options = {}) {
  const {
    throwOnMissing = true,
    validateFormat = true,
    checkPassword = true,
  } = options;

  const warnings = [];
  const privateUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;

  let url;
  let source;
  let isRailwayInternal = false;

  // Determine which URL to use
  if (privateUrl && !isRailwayInternalHost(privateUrl)) {
    // DATABASE_URL exists and is not Railway internal - use it
    url = privateUrl;
    source = "DATABASE_URL";
  } else if (privateUrl && isRailwayInternalHost(privateUrl)) {
    // DATABASE_URL is Railway internal - need fallback
    isRailwayInternal = true;
    if (publicUrl) {
      url = publicUrl;
      source = "DATABASE_PUBLIC_URL";
      warnings.push(
        "DATABASE_URL points to Railway internal host; using DATABASE_PUBLIC_URL"
      );
    } else {
      // Railway internal but no public URL - this will fail from outside Railway
      url = privateUrl;
      source = "DATABASE_URL";
      warnings.push(
        "DATABASE_URL points to Railway internal host but DATABASE_PUBLIC_URL is not set. " +
          "Connection will fail from outside Railway network."
      );
    }
  } else if (publicUrl) {
    // No DATABASE_URL, but DATABASE_PUBLIC_URL exists
    url = publicUrl;
    source = "DATABASE_PUBLIC_URL";
  } else {
    // No URLs available
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

  // Validate postgres:// format
  if (validateFormat && !isPostgresUrl(url)) {
    const prefix = String(url).slice(0, 40);
    throw new Error(
      `Database URL must be a Postgres URL (postgres:// or postgresql://). Got: ${prefix}...`
    );
  }

  // Check for missing password
  if (checkPassword) {
    try {
      const parsed = new URL(url);
      if (!parsed.password) {
        warnings.push(
          "Database URL is missing a password. Connection may fail with SCRAM authentication error."
        );
      }
    } catch {
      // URL parsing failed - let the driver report the error
    }
  }

  return { url, source, isRailwayInternal, warnings };
}

/**
 * Get database URL with connection pool settings applied.
 *
 * This is the recommended way to get a database URL for Prisma clients.
 * It applies consistent pool settings across all services.
 *
 * Default pool settings (configurable via env vars):
 * - connection_limit: 10 (DB_POOL_SIZE)
 * - pool_timeout: 20 (DB_POOL_TIMEOUT)
 *
 * @param {Object} [options]
 * @param {number} [options.connectionLimit] - Override connection limit
 * @param {number} [options.poolTimeout] - Override pool timeout
 * @returns {string} Database URL with pool settings
 */
export function getDatabaseUrlWithPooling(options = {}) {
  const { url } = resolveDatabaseUrl();

  const parsed = new URL(url);
  const searchParams = parsed.searchParams;

  // Apply pool settings if not already specified
  if (!searchParams.has("connection_limit")) {
    const limit =
      options.connectionLimit ?? process.env.DB_POOL_SIZE ?? "10";
    searchParams.set("connection_limit", String(limit));
  }

  if (!searchParams.has("pool_timeout")) {
    const timeout =
      options.poolTimeout ?? process.env.DB_POOL_TIMEOUT ?? "20";
    searchParams.set("pool_timeout", String(timeout));
  }

  // Enable pgBouncer mode if configured
  if (process.env.DB_PGBOUNCER === "true" && !searchParams.has("pgbouncer")) {
    searchParams.set("pgbouncer", "true");
  }

  return parsed.toString();
}

/**
 * Get SSL configuration for pg Client based on connection string.
 *
 * @param {string} connectionString
 * @returns {{ rejectUnauthorized: boolean } | undefined}
 */
export function getSslConfig(connectionString) {
  return shouldUseSsl(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;
}

/**
 * Log database connection info for debugging.
 * Safe to call in production - doesn't expose credentials.
 *
 * @param {ResolvedDatabaseUrl} resolved
 */
export function logConnectionInfo(resolved) {
  console.log(`Database: ${resolved.source}`);
  if (resolved.isRailwayInternal) {
    console.log("  (Railway internal URL detected, using public fallback)");
  }
  for (const warning of resolved.warnings) {
    console.warn(`  Warning: ${warning}`);
  }
}
