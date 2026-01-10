/**
 * Backfill script to populate productType for existing ProductAsset records
 * 
 * Fetches productType from Shopify GraphQL API and updates ProductAsset records
 * that have null productType.
 * 
 * Usage:
 *   cd app
 *   DATABASE_URL="your-db-url" SHOPIFY_API_VERSION="2025-01" SHOPIFY_API_KEY="your-key" SHOPIFY_API_SECRET="your-secret" node scripts/backfill-product-type.js [shop-domain]
 * 
 * If shop-domain is provided, only that shop will be backfilled.
 * If not provided, all shops will be processed.
 * 
 * Or with .env file:
 *   npx dotenv -e .env.production -- node scripts/backfill-product-type.js [shop-domain]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
const BATCH_SIZE = 50; // Shopify allows up to 50 nodes per query

async function fetchProductTypesFromShopify(shopDomain, accessToken, productIds) {
  const shopifyUrl = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  // Convert product IDs to GID format if needed
  const productGids = productIds.map(id => 
    String(id).startsWith('gid://') ? id : `gid://shopify/Product/${id}`
  );

  const query = `
    query getProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          productType
        }
      }
    }
  `;

  try {
    const response = await fetch(shopifyUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { ids: productGids },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors && data.errors.length > 0) {
      throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(', ')}`);
    }

    return data.data?.nodes || [];
  } catch (error) {
    console.error(`❌ GraphQL error for ${shopDomain}:`, error.message);
    throw error;
  }
}

async function backfillShop(shopDomain) {
  console.log(`\n📦 Processing shop: ${shopDomain}`);

  // Find the shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true, accessToken: true }
  });

  if (!shop) {
    console.error(`❌ Shop not found: ${shopDomain}`);
    return { shopDomain, updated: 0, errors: [] };
  }

  if (!shop.accessToken || shop.accessToken === 'pending') {
    console.error(`❌ Shop has no valid access token: ${shopDomain}`);
    return { shopDomain, updated: 0, errors: ['No access token'] };
  }

  // Find all ProductAsset records with null productType
  const assetsWithNullType = await prisma.productAsset.findMany({
    where: {
      shopId: shop.id,
      productType: null,
    },
    select: {
      id: true,
      productId: true,
    },
  });

  if (assetsWithNullType.length === 0) {
    console.log(`   ✅ No records need backfilling (all have productType)`);
    return { shopDomain, updated: 0, errors: [] };
  }

  console.log(`   📊 Found ${assetsWithNullType.length} records with null productType`);

  // Extract unique product IDs
  const uniqueProductIds = [...new Set(assetsWithNullType.map(a => a.productId))];
  console.log(`   🔍 Fetching productType for ${uniqueProductIds.length} unique products`);

  // Batch process products
  let updated = 0;
  const errors = [];

  for (let i = 0; i < uniqueProductIds.length; i += BATCH_SIZE) {
    const batch = uniqueProductIds.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueProductIds.length / BATCH_SIZE);

    console.log(`   📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} products)...`);

    try {
      const products = await fetchProductTypesFromShopify(
        shop.shopDomain,
        shop.accessToken,
        batch
      );

      // Create a map of product ID -> productType
      const productTypeMap = new Map();
      products.forEach(product => {
        if (product && product.id) {
          // Extract numeric ID from GID
          const numericId = product.id.split('/').pop();
          productTypeMap.set(numericId, product.productType || null);
        }
      });

      // Update all ProductAsset records for products in this batch
      for (const productId of batch) {
        const productType = productTypeMap.get(String(productId));

        // Update all assets with this productId
        const result = await prisma.productAsset.updateMany({
          where: {
            shopId: shop.id,
            productId: String(productId),
            productType: null, // Only update if still null
          },
          data: {
            productType: productType,
          },
        });

        updated += result.count;
      }

      console.log(`   ✅ Batch ${batchNum} complete (${updated} total updated so far)`);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      console.error(`   ❌ Batch ${batchNum} failed:`, errorMsg);
      errors.push(`Batch ${batchNum}: ${errorMsg}`);
    }
  }

  console.log(`   ✅ Completed: ${updated} records updated, ${errors.length} errors`);
  return { shopDomain, updated, errors };
}

async function main() {
  const targetShopDomain = process.argv[2];

  try {
    if (targetShopDomain) {
      // Backfill specific shop
      const result = await backfillShop(targetShopDomain);
      console.log(`\n🎉 Backfill complete for ${result.shopDomain}`);
      console.log(`   Updated: ${result.updated} records`);
      if (result.errors.length > 0) {
        console.log(`   Errors: ${result.errors.length}`);
        result.errors.forEach(err => console.log(`     - ${err}`));
      }
    } else {
      // Backfill all shops
      console.log('🌍 Backfilling all shops...\n');

      const shops = await prisma.shop.findMany({
        select: { shopDomain: true },
        orderBy: { shopDomain: 'asc' },
      });

      if (shops.length === 0) {
        console.log('❌ No shops found in database');
        process.exit(1);
      }

      console.log(`Found ${shops.length} shop(s) to process\n`);

      let totalUpdated = 0;
      const allErrors = [];

      for (const shop of shops) {
        const result = await backfillShop(shop.shopDomain);
        totalUpdated += result.updated;
        allErrors.push(...result.errors.map(err => `${shop.shopDomain}: ${err}`));

        // Small delay between shops
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`\n🎉 Backfill complete for all shops!`);
      console.log(`   Total updated: ${totalUpdated} records`);
      if (allErrors.length > 0) {
        console.log(`   Total errors: ${allErrors.length}`);
        allErrors.forEach(err => console.log(`     - ${err}`));
      }
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
