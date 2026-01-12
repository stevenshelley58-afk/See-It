const pg = require('pg');

async function main() {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  await db.connect();
  
  console.log('=== Live Products ===\n');
  const result = await db.query(`
    SELECT id, product_id, product_title, status, enabled, prepared_image_url IS NOT NULL as has_prepared
    FROM product_assets 
    WHERE status = 'live'
  `);
  
  for (const row of result.rows) {
    console.log(`Product: ${row.product_title || row.product_id}`);
    console.log(`  ID: ${row.product_id}`);
    console.log(`  Status: ${row.status}`);
    console.log(`  Enabled: ${row.enabled}`);
    console.log(`  Has Prepared Image: ${row.has_prepared}`);
    console.log();
  }
  
  if (result.rows.length === 0) {
    console.log('No live products found!');
  }
  
  await db.end();
}

main().catch(console.error);
