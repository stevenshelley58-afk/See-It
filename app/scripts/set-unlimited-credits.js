/**
 * Script to give a shop unlimited credits
 * 
 * Usage:
 *   cd app
 *   DATABASE_URL="your-production-db-url" node scripts/set-unlimited-credits.js bohoem58.myshopify.com
 * 
 * Or with .env file:
 *   npx dotenv -e .env.production -- node scripts/set-unlimited-credits.js bohoem58.myshopify.com
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Effectively unlimited - 1 million per day/month
const UNLIMITED_DAILY = 1000000;
const UNLIMITED_MONTHLY = 10000000;

async function setUnlimitedCredits(shopDomain) {
  if (!shopDomain) {
    console.error('❌ Please provide a shop domain as argument');
    console.log('Usage: node scripts/set-unlimited-credits.js bohoem58.myshopify.com');
    process.exit(1);
  }

  try {
    // Find the shop
    const shop = await prisma.shop.findUnique({
      where: { shopDomain }
    });

    if (!shop) {
      console.error(`❌ Shop not found: ${shopDomain}`);
      console.log('\nAvailable shops:');
      const shops = await prisma.shop.findMany({
        select: { shopDomain: true, plan: true, dailyQuota: true }
      });
      shops.forEach(s => console.log(`  - ${s.shopDomain} (plan: ${s.plan}, daily: ${s.dailyQuota})`));
      process.exit(1);
    }

    console.log(`\n📍 Found shop: ${shop.shopDomain}`);
    console.log(`   Current plan: ${shop.plan}`);
    console.log(`   Current daily quota: ${shop.dailyQuota}`);
    console.log(`   Current monthly quota: ${shop.monthlyQuota}`);

    // Update to unlimited
    await prisma.shop.update({
      where: { shopDomain },
      data: {
        plan: 'unlimited',
        dailyQuota: UNLIMITED_DAILY,
        monthlyQuota: UNLIMITED_MONTHLY
      }
    });

    console.log('\n✅ Updated to UNLIMITED credits!');
    console.log(`   New daily quota: ${UNLIMITED_DAILY.toLocaleString()}`);
    console.log(`   New monthly quota: ${UNLIMITED_MONTHLY.toLocaleString()}`);
    console.log('\n🎉 Done! Your store now has unlimited credits.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Get shop domain from command line args
const shopDomain = process.argv[2];
setUnlimitedCredits(shopDomain);

