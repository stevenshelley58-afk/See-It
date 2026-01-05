import type { Config } from 'drizzle-kit';

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
  
  // Railway requires SSL - use require mode (will accept self-signed)
  return `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=require`;
}

const connectionString = getDatabaseUrl();

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
    ssl: connectionString.includes('railway') || connectionString.includes('rlwy.net')
      ? { rejectUnauthorized: false } // Railway uses self-signed certs
      : undefined,
  },
} satisfies Config;
