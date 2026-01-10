/**
 * Migration script: See It Status System Overhaul (Phase 7)
 *
 * Migrates existing ProductAsset records from old status values to new ones.
 * Run this AFTER deploying Phases 1-6 code changes.
 *
 * Status Mapping:
 *   - ready (with preparedImageUrl) → ready, enabled=false
 *   - ready (without preparedImageUrl) → unprepared, enabled=false
 *   - pending → preparing, enabled=false
 *   - processing → preparing, enabled=false
 *   - failed → failed (no change), enabled=false
 *   - stale → unprepared, enabled=false
 *   - orphaned → unprepared, enabled=false
 *
 * Usage:
 *   cd app
 *   DATABASE_URL="your-db-url" node scripts/migrate-statuses.js
 *
 * Or with .env file:
 *   npx dotenv -e .env.production -- node scripts/migrate-statuses.js
 *
 * Options:
 *   --dry-run    Show what would be migrated without making changes
 *   --rollback   Revert preparing back to pending (partial rollback)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const isDryRun = process.argv.includes('--dry-run');
const isRollback = process.argv.includes('--rollback');

async function getStatusCounts() {
  const counts = await prisma.productAsset.groupBy({
    by: ['status', 'enabled'],
    _count: { status: true }
  });

  return counts.map(c => ({
    status: c.status,
    enabled: c.enabled,
    count: c._count.status
  }));
}

async function printStatusCounts(label) {
  const counts = await getStatusCounts();
  console.log(`\n📊 ${label}:`);

  if (counts.length === 0) {
    console.log('   (no records)');
    return;
  }

  // Sort by status then enabled
  counts.sort((a, b) => {
    if (a.status !== b.status) return a.status.localeCompare(b.status);
    return a.enabled === b.enabled ? 0 : (a.enabled ? 1 : -1);
  });

  counts.forEach(c => {
    console.log(`   ${c.status} (enabled=${c.enabled}): ${c.count}`);
  });
}

async function migrateStatuses() {
  console.log('🚀 Starting status migration...');
  if (isDryRun) {
    console.log('   ⚠️  DRY RUN MODE - No changes will be made\n');
  }

  await printStatusCounts('Current status distribution');

  // Step 1: Set enabled=false for all existing records (safety)
  console.log('\n📝 Step 1: Setting enabled=false for all records...');
  if (!isDryRun) {
    const setEnabled = await prisma.productAsset.updateMany({
      where: {
        OR: [
          { enabled: null },
          { enabled: true }
        ]
      },
      data: { enabled: false }
    });
    console.log(`   ✅ Set enabled=false for ${setEnabled.count} records`);
  } else {
    const toUpdate = await prisma.productAsset.count({
      where: {
        OR: [
          { enabled: null },
          { enabled: true }
        ]
      }
    });
    console.log(`   Would set enabled=false for ${toUpdate} records`);
  }

  // Step 2: ready with preparedImageUrl stays as ready
  console.log('\n📝 Step 2: Confirming ready records with prepared images...');
  if (!isDryRun) {
    const readyWithImage = await prisma.productAsset.updateMany({
      where: {
        status: 'ready',
        preparedImageUrl: { not: null }
      },
      data: { status: 'ready', enabled: false }
    });
    console.log(`   ✅ Confirmed ${readyWithImage.count} ready records with images`);
  } else {
    const count = await prisma.productAsset.count({
      where: {
        status: 'ready',
        preparedImageUrl: { not: null }
      }
    });
    console.log(`   Would confirm ${count} ready records with images`);
  }

  // Step 3: ready without preparedImageUrl → unprepared
  console.log('\n📝 Step 3: Resetting ready records WITHOUT prepared images to unprepared...');
  if (!isDryRun) {
    const readyNoImage = await prisma.productAsset.updateMany({
      where: {
        status: 'ready',
        preparedImageUrl: null
      },
      data: { status: 'unprepared', enabled: false }
    });
    console.log(`   ✅ Reset ${readyNoImage.count} invalid ready records to unprepared`);
  } else {
    const count = await prisma.productAsset.count({
      where: {
        status: 'ready',
        preparedImageUrl: null
      }
    });
    console.log(`   Would reset ${count} invalid ready records to unprepared`);
  }

  // Step 4: pending/processing → preparing
  console.log('\n📝 Step 4: Migrating pending/processing to preparing...');
  if (!isDryRun) {
    const pending = await prisma.productAsset.updateMany({
      where: {
        status: { in: ['pending', 'processing'] }
      },
      data: { status: 'preparing', enabled: false }
    });
    console.log(`   ✅ Migrated ${pending.count} pending/processing to preparing`);
  } else {
    const count = await prisma.productAsset.count({
      where: {
        status: { in: ['pending', 'processing'] }
      }
    });
    console.log(`   Would migrate ${count} pending/processing to preparing`);
  }

  // Step 5: stale/orphaned → unprepared
  console.log('\n📝 Step 5: Resetting stale/orphaned to unprepared...');
  if (!isDryRun) {
    const stale = await prisma.productAsset.updateMany({
      where: {
        status: { in: ['stale', 'orphaned'] }
      },
      data: { status: 'unprepared', enabled: false }
    });
    console.log(`   ✅ Reset ${stale.count} stale/orphaned to unprepared`);
  } else {
    const count = await prisma.productAsset.count({
      where: {
        status: { in: ['stale', 'orphaned'] }
      }
    });
    console.log(`   Would reset ${count} stale/orphaned to unprepared`);
  }

  // Step 6: Verify no invalid statuses remain
  console.log('\n📝 Step 6: Checking for invalid statuses...');
  const validStatuses = ['unprepared', 'preparing', 'ready', 'live', 'failed'];
  const invalidRecords = await prisma.productAsset.findMany({
    where: {
      status: { notIn: validStatuses }
    },
    select: {
      id: true,
      status: true,
      productId: true,
      shopId: true
    },
    take: 10
  });

  if (invalidRecords.length > 0) {
    console.log(`   ⚠️  Found ${invalidRecords.length} records with invalid statuses:`);
    invalidRecords.forEach(r => {
      console.log(`      - ${r.id}: status="${r.status}" (product=${r.productId})`);
    });
  } else {
    console.log('   ✅ No invalid statuses found');
  }

  // Final counts
  await printStatusCounts('Final status distribution');

  if (isDryRun) {
    console.log('\n⚠️  DRY RUN COMPLETE - No changes were made');
    console.log('   Run without --dry-run to apply changes');
  } else {
    console.log('\n🎉 Migration complete!');
  }
}

async function rollbackStatuses() {
  console.log('🔄 Starting rollback (partial)...');
  console.log('   ⚠️  Note: Full rollback is not possible without a backup\n');

  if (isDryRun) {
    console.log('   ⚠️  DRY RUN MODE - No changes will be made\n');
  }

  await printStatusCounts('Current status distribution');

  // Revert preparing back to pending
  console.log('\n📝 Reverting preparing back to pending...');
  if (!isDryRun) {
    const reverted = await prisma.productAsset.updateMany({
      where: { status: 'preparing' },
      data: { status: 'pending' }
    });
    console.log(`   ✅ Reverted ${reverted.count} preparing records to pending`);
  } else {
    const count = await prisma.productAsset.count({
      where: { status: 'preparing' }
    });
    console.log(`   Would revert ${count} preparing records to pending`);
  }

  // Ensure all enabled=false
  console.log('\n📝 Setting enabled=false for all records...');
  if (!isDryRun) {
    const disabled = await prisma.productAsset.updateMany({
      where: { enabled: true },
      data: { enabled: false }
    });
    console.log(`   ✅ Disabled ${disabled.count} records`);
  } else {
    const count = await prisma.productAsset.count({
      where: { enabled: true }
    });
    console.log(`   Would disable ${count} records`);
  }

  await printStatusCounts('Status distribution after rollback');

  if (isDryRun) {
    console.log('\n⚠️  DRY RUN COMPLETE - No changes were made');
  } else {
    console.log('\n🔄 Rollback complete (partial)');
    console.log('   Note: Records that were changed to unprepared cannot be automatically restored');
    console.log('   Use a database backup for full rollback');
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('   See It Status Migration - Phase 7');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    if (isRollback) {
      await rollbackStatuses();
    } else {
      await migrateStatuses();
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
