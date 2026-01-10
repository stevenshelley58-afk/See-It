const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Find BHM shop
    const shops = await prisma.shop.findMany({
        where: {
            shopDomain: {
                contains: 'bhm'
            }
        },
        select: {
            id: true,
            shopDomain: true,
            plan: true,
            createdAt: true
        }
    });

    console.log('\n=== BHM SHOPS FOUND ===');
    console.log(JSON.stringify(shops, null, 2));

    if (shops.length === 0) {
        // Try broader search
        const allShops = await prisma.shop.findMany({
            select: { id: true, shopDomain: true }
        });
        console.log('\n=== ALL SHOPS ===');
        console.log(JSON.stringify(allShops, null, 2));
        return;
    }

    const shopId = shops[0].id;

    // Find product assets for this shop - look for mirror products
    const assets = await prisma.productAsset.findMany({
        where: {
            shopId: shopId
        },
        select: {
            id: true,
            productId: true,
            productTitle: true,
            productType: true,
            status: true,
            enabled: true,
            preparedImageUrl: true,
            preparedImageKey: true,
            sourceImageUrl: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true
        },
        orderBy: {
            updatedAt: 'desc'
        },
        take: 20
    });

    console.log('\n=== PRODUCT ASSETS (most recent 20) ===');
    assets.forEach(a => {
        console.log(`\n--- ${a.productTitle || 'Unknown'} ---`);
        console.log(`  Product ID: ${a.productId}`);
        console.log(`  Status: ${a.status}`);
        console.log(`  Enabled: ${a.enabled}`);
        console.log(`  Has Prepared Image URL: ${!!a.preparedImageUrl}`);
        console.log(`  Has Prepared Image Key: ${!!a.preparedImageKey}`);
        if (a.preparedImageKey) {
            console.log(`  Prepared Key: ${a.preparedImageKey}`);
        }
        if (a.errorMessage) {
            console.log(`  ERROR: ${a.errorMessage}`);
        }
        console.log(`  Updated: ${a.updatedAt}`);
    });

    // Look specifically for mirror-related products
    const mirrorAssets = assets.filter(a => 
        a.productTitle?.toLowerCase().includes('mirror') ||
        a.productTitle?.toLowerCase().includes('sundar')
    );

    if (mirrorAssets.length > 0) {
        console.log('\n=== MIRROR PRODUCTS FOUND ===');
        console.log(JSON.stringify(mirrorAssets, null, 2));
    }

    // Check room sessions too
    const roomSessions = await prisma.roomSession.findMany({
        where: { shopId: shopId },
        orderBy: { createdAt: 'desc' },
        take: 5
    });

    console.log('\n=== RECENT ROOM SESSIONS ===');
    console.log(JSON.stringify(roomSessions, null, 2));

    // Check render jobs
    const renderJobs = await prisma.renderJob.findMany({
        where: { shopId: shopId },
        orderBy: { createdAt: 'desc' },
        take: 10
    });

    console.log('\n=== RECENT RENDER JOBS ===');
    renderJobs.forEach(j => {
        console.log(`\n--- Job ${j.id.slice(0,8)} ---`);
        console.log(`  Status: ${j.status}`);
        console.log(`  Product: ${j.productId}`);
        console.log(`  Has Image: ${!!j.imageUrl || !!j.imageKey}`);
        if (j.errorMessage) {
            console.log(`  ERROR: ${j.errorMessage}`);
        }
        console.log(`  Created: ${j.createdAt}`);
    });
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
