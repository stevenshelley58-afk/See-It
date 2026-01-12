/**
 * Check and fix ProductAsset status to ensure 'live' products are actually 'live'
 * 
 * Products should be:
 * - 'live' when they have a prepared image AND are enabled for storefront
 * - 'ready' when they have a prepared image but are NOT enabled
 * - 'unprepared', 'preparing', or 'failed' for other states
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const { Client } = pg;
let db;

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (!key) continue;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch { }
}

async function main() {
  // Load env
  loadEnvFile(path.join(__dirname, '.env'));
  loadEnvFile(path.join(__dirname, '.env.local'));
  loadEnvFile(path.join(__dirname, '.env.production'));

  // Prefer public URL when running locally (internal URLs only work inside Railway)
  let connectionString = process.env.DATABASE_URL;
  if (connectionString && connectionString.includes('.railway.internal')) {
    connectionString = process.env.DATABASE_PUBLIC_URL || connectionString;
  }
  connectionString = connectionString || process.env.DATABASE_PUBLIC_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const wantsSsl = connectionString.includes('sslmode=require') || 
                   connectionString.includes('ssl=true') || 
                   connectionString.includes('.proxy.rlwy.net');

  db = new Client({
    connectionString,
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
  });

  await db.connect();
  console.log('Connected to database\n');

  // Check current state
  console.log('=== Current ProductAsset Status ===\n');
  const counts = await db.query(`
    SELECT status, enabled, COUNT(*)::int as count 
    FROM product_assets 
    GROUP BY status, enabled 
    ORDER BY status, enabled
  `);
  
  console.log('Status    | Enabled | Count');
  console.log('----------|---------|------');
  for (const row of counts.rows) {
    console.log(`${row.status.padEnd(10)}| ${String(row.enabled).padEnd(8)}| ${row.count}`);
  }

  // Find products that should be live (have prepared image AND enabled=true)
  // Or products that have prepared_image_url but status is not 'live' or 'ready'
  const needsLive = await db.query(`
    SELECT id, product_id, product_title, status, enabled, 
           prepared_image_url IS NOT NULL as has_prepared
    FROM product_assets 
    WHERE prepared_image_url IS NOT NULL 
      AND enabled = true
      AND status != 'live'
  `);

  if (needsLive.rows.length > 0) {
    console.log('\n=== Products that should be LIVE (have prepared image + enabled) ===\n');
    for (const row of needsLive.rows) {
      console.log(`- ${row.product_title || row.product_id}: status=${row.status}, enabled=${row.enabled}`);
    }

    // Check if --fix flag was passed
    if (process.argv.includes('--fix')) {
      console.log(`\n🔧 Fixing: Setting ${needsLive.rows.length} products to status='live'...`);
      
      const result = await db.query(`
        UPDATE product_assets 
        SET status = 'live', updated_at = NOW()
        WHERE prepared_image_url IS NOT NULL 
          AND enabled = true 
          AND status != 'live'
      `);
      
      console.log(`✅ Updated ${result.rowCount} products to 'live' status`);
    } else {
      console.log(`\n⚠️  Run with --fix flag to update these products to 'live' status`);
    }
  } else {
    console.log('\n✅ No products need status update to live');
  }

  // Also check for products that have prepared image but enabled=false
  // These should have status='ready' not 'live'
  const shouldBeReady = await db.query(`
    SELECT id, product_id, product_title, status, enabled
    FROM product_assets 
    WHERE prepared_image_url IS NOT NULL 
      AND enabled = false
      AND status = 'live'
  `);

  if (shouldBeReady.rows.length > 0) {
    console.log('\n=== Products incorrectly marked as LIVE (enabled=false) ===\n');
    for (const row of shouldBeReady.rows) {
      console.log(`- ${row.product_title || row.product_id}: status=${row.status}, enabled=${row.enabled}`);
    }

    if (process.argv.includes('--fix')) {
      console.log(`\n🔧 Fixing: Setting ${shouldBeReady.rows.length} disabled products to status='ready'...`);
      
      const result = await db.query(`
        UPDATE product_assets 
        SET status = 'ready', updated_at = NOW()
        WHERE prepared_image_url IS NOT NULL 
          AND enabled = false 
          AND status = 'live'
      `);
      
      console.log(`✅ Updated ${result.rowCount} products to 'ready' status`);
    }
  }

  // Show final state after fix
  if (process.argv.includes('--fix')) {
    console.log('\n=== Final ProductAsset Status ===\n');
    const finalCounts = await db.query(`
      SELECT status, enabled, COUNT(*)::int as count 
      FROM product_assets 
      GROUP BY status, enabled 
      ORDER BY status, enabled
    `);
    
    console.log('Status    | Enabled | Count');
    console.log('----------|---------|------');
    for (const row of finalCounts.rows) {
      console.log(`${row.status.padEnd(10)}| ${String(row.enabled).padEnd(8)}| ${row.count}`);
    }
  }
}

main()
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    if (db) await db.end();
  });
