/**
 * Script to give a shop unlimited credits.
 *
 * Usage:
 *   cd app
 *   DATABASE_URL="postgres://..." node scripts/set-unlimited-credits.js myshop.myshopify.com [--dry-run]
 *
 * With .env:
 *   npx dotenv -e .env.production -- node scripts/set-unlimited-credits.js myshop.myshopify.com [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const shopDomain = args.find((arg) => !arg.startsWith("--"));

// Effectively unlimited - 1 million per day/month
const UNLIMITED_DAILY = 1_000_000;
const UNLIMITED_MONTHLY = 10_000_000;

async function setUnlimitedCredits(targetShopDomain) {
  if (!targetShopDomain) {
    console.error("ERROR: Please provide a shop domain as argument");
    console.log("Usage: node scripts/set-unlimited-credits.js <shop-domain> [--dry-run]");
    process.exit(1);
  }

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: targetShopDomain },
    });

    if (!shop) {
      console.error(`ERROR: Shop not found: ${targetShopDomain}`);
      console.log("\nAvailable shops:");
      const shops = await prisma.shop.findMany({
        select: { shopDomain: true, plan: true, dailyQuota: true },
      });
      shops.forEach((s) =>
        console.log(`  - ${s.shopDomain} (plan: ${s.plan}, daily: ${s.dailyQuota})`)
      );
      process.exit(1);
    }

    console.log(`\nFound shop: ${shop.shopDomain}`);
    console.log(`   Current plan: ${shop.plan}`);
    console.log(`   Current daily quota: ${shop.dailyQuota}`);
    console.log(`   Current monthly quota: ${shop.monthlyQuota}`);

    if (dryRun) {
      console.log("\n[DRY RUN] Would update shop to UNLIMITED credits with:");
      console.log(`   plan = "unlimited"`);
      console.log(`   dailyQuota = ${UNLIMITED_DAILY.toLocaleString()}`);
      console.log(`   monthlyQuota = ${UNLIMITED_MONTHLY.toLocaleString()}`);
    } else {
      await prisma.shop.update({
        where: { shopDomain: targetShopDomain },
        data: {
          plan: "unlimited",
          dailyQuota: UNLIMITED_DAILY,
          monthlyQuota: UNLIMITED_MONTHLY,
        },
      });

      console.log("\nUpdated to UNLIMITED credits!");
      console.log(`   New daily quota: ${UNLIMITED_DAILY.toLocaleString()}`);
      console.log(`   New monthly quota: ${UNLIMITED_MONTHLY.toLocaleString()}`);
      console.log("\nDone! Your store now has unlimited credits.");
    }
  } catch (error) {
    console.error("ERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setUnlimitedCredits(shopDomain);
