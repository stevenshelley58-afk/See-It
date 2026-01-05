/**
 * Run Prisma migration script
 * Can be executed via Railway: railway run node scripts/run-migration.js
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Running Prisma migration...');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');

try {
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
