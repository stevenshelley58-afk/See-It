/**
 * One-time migration script to add "see-it-live" tag to all products
 * that are currently in "live" status in the See It database.
 *
 * Run from the app directory: node scripts/sync-live-tags.js
 *
 * Requires environment variables:
 * - DATABASE_URL or DATABASE_PUBLIC_URL - PostgreSQL connection string
 * - SHOPIFY_API_KEY, SHOPIFY_API_SECRET for admin API access
 */

import pg from 'pg';
import {
  resolveDatabaseUrl,
  getSslConfig,
  logConnectionInfo,
} from '../lib/db-url.js';

const { Client } = pg;

const SEE_IT_LIVE_TAG = "see-it-live";

async function main() {
  console.log("🏷️  Starting live product tag sync...\n");

  const resolved = resolveDatabaseUrl();
  logConnectionInfo(resolved);

  const client = new Client({
    connectionString: resolved.url,
    ssl: getSslConfig(resolved.url),
  });

  try {
    await client.connect();
    console.log("✅ Connected to database\n");

    // Get all live products with their shop info
    const result = await client.query(`
      SELECT 
        pa.product_id,
        pa.product_title,
        s.shop_domain,
        s.access_token
      FROM product_assets pa
      JOIN shops s ON pa.shop_id = s.id
      WHERE pa.status = 'live'
      ORDER BY s.shop_domain, pa.product_title
    `);

    console.log(`Found ${result.rows.length} live product(s)\n`);

    if (result.rows.length === 0) {
      console.log("No live products to tag. Done!");
      return;
    }

    // Group by shop for efficient API calls
    const shopProducts = {};
    for (const row of result.rows) {
      if (!shopProducts[row.shop_domain]) {
        shopProducts[row.shop_domain] = {
          accessToken: row.access_token,
          products: []
        };
      }
      shopProducts[row.shop_domain].products.push({
        id: row.product_id,
        title: row.product_title
      });
    }

    let successCount = 0;
    let failCount = 0;

    for (const [shopDomain, shopData] of Object.entries(shopProducts)) {
      console.log(`\n📦 Processing ${shopDomain} (${shopData.products.length} products)...`);
      
      for (const product of shopData.products) {
        try {
          const gid = `gid://shopify/Product/${product.id}`;
          
          const response = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': shopData.accessToken
            },
            body: JSON.stringify({
              query: `
                mutation addTag($id: ID!, $tags: [String!]!) {
                  tagsAdd(id: $id, tags: $tags) {
                    node {
                      id
                    }
                    userErrors {
                      field
                      message
                    }
                  }
                }
              `,
              variables: {
                id: gid,
                tags: [SEE_IT_LIVE_TAG]
              }
            })
          });

          const data = await response.json();
          
          if (data.data?.tagsAdd?.userErrors?.length > 0) {
            console.log(`  ❌ ${product.title}: ${data.data.tagsAdd.userErrors[0].message}`);
            failCount++;
          } else if (data.errors) {
            console.log(`  ❌ ${product.title}: ${data.errors[0]?.message || 'Unknown error'}`);
            failCount++;
          } else {
            console.log(`  ✅ ${product.title}: Tagged`);
            successCount++;
          }
        } catch (error) {
          console.log(`  ❌ ${product.title}: ${error.message}`);
          failCount++;
        }
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`${'='.repeat(50)}\n`);

  } catch (error) {
    console.error("Database error:", error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
