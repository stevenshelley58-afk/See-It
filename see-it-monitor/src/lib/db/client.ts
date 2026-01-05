/**
 * Database client for See It Monitor
 * Uses Drizzle ORM with pg driver and connection pooling
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Support both DATABASE_URL and Railway's individual variables
function getDatabaseUrl(): string {
  // Prefer DATABASE_URL if set
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  
  // Use DATABASE_PUBLIC_URL if available (Railway provides this)
  if (process.env.DATABASE_PUBLIC_URL) {
    return process.env.DATABASE_PUBLIC_URL;
  }
  
  // Construct from Railway's individual Postgres variables
  const host = process.env.PGHOST || process.env.POSTGRES_HOST;
  const port = process.env.PGPORT || process.env.POSTGRES_PORT || '5432';
  const user = process.env.PGUSER || process.env.POSTGRES_USER || 'postgres';
  const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
  const database = process.env.PGDATABASE || process.env.POSTGRES_DB || 'railway';
  
  if (!host || !password) {
    throw new Error('Database connection details are required. Set DATABASE_URL, DATABASE_PUBLIC_URL, or Railway Postgres variables.');
  }
  
  return `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=require`;
}

const connectionString = getDatabaseUrl();

// Create connection pool with SSL for production
// Railway requires SSL but uses self-signed certs, so we don't reject unauthorized
const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('railway') || process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create Drizzle instance
export const db = drizzle(pool, { schema });

// Export schema for use in other files
export * from './schema';
