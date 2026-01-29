/**
 * Run Prisma migration script
 * Can be executed via Railway: railway run node scripts/run-migration.js
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  resolveDatabaseUrl,
  logConnectionInfo,
} from '../lib/db-url.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Prisma migration...');

try {
  // Resolve and validate DATABASE_URL
  const resolved = resolveDatabaseUrl();
  logConnectionInfo(resolved);

  // Set DATABASE_URL for Prisma (it needs this env var)
  process.env.DATABASE_URL = resolved.url;

  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: process.env,
  });
  console.log('✅ Migration completed successfully');
  process.exit(0);
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
}
