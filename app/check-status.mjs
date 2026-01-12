import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== ProductAsset Status Summary ===\n');
  
  const counts = await prisma.$queryRaw`
    SELECT status, enabled, COUNT(*)::int as count 
    FROM product_assets 
    GROUP BY status, enabled 
    ORDER BY status, enabled
  `;
  
  console.log('Status | Enabled | Count');
  console.log('-------|---------|------');
  for (const row of counts) {
    console.log(`${row.status.padEnd(7)}| ${String(row.enabled).padEnd(8)}| ${row.count}`);
  }
  
  // Show products that SHOULD be live (have prepared image but aren't live)
  const shouldBeLive = await prisma.$queryRaw`
    SELECT id, product_id, product_title, status, enabled, prepared_image_url IS NOT NULL as has_prepared
    FROM product_assets 
    WHERE prepared_image_url IS NOT NULL AND status != 'live'
    LIMIT 10
  `;
  
  if (shouldBeLive.length > 0) {
    console.log('\n=== Products that have prepared images but are NOT live ===');
    for (const row of shouldBeLive) {
      console.log(`- ${row.product_title || row.product_id}: status=${row.status}, enabled=${row.enabled}`);
    }
    console.log(`\nTotal: ${shouldBeLive.length} products need status set to 'live'`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
