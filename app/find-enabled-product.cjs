const pg = require('pg');

async function main() {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  await db.connect();
  
  // Get live products and their Shopify product handles (we need to find them on the store)
  const result = await db.query(`
    SELECT 
      pa.product_id, 
      pa.product_title, 
      pa.status, 
      pa.enabled,
      s.shop_domain
    FROM product_assets pa
    JOIN shops s ON pa.shop_id = s.id
    WHERE pa.status = 'live'
  `);
  
  console.log('=== Live Products ===\n');
  for (const row of result.rows) {
    console.log(`Shop: ${row.shop_domain}`);
    console.log(`Product ID: ${row.product_id}`);
    console.log(`Title: ${row.product_title}`);
    console.log(`Status: ${row.status}, Enabled: ${row.enabled}`);
    console.log();
  }
  
  await db.end();
}

main().catch(console.error);
