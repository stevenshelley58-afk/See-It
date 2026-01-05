const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: 'bohoem58.myshopify.com' } });
    if (!shop) {
        console.log('Shop not found');
        return;
    }

    const productId = '9877007368477';
    const asset = await prisma.productAsset.findFirst({
        where: { shopId: shop.id, productId: productId },
        orderBy: { updatedAt: 'desc' }
    });

    const job = await prisma.renderJob.findFirst({
        where: { shopId: shop.id, productId: productId },
        orderBy: { createdAt: 'desc' }
    });

    console.log('--- Product Asset ---');
    console.log(JSON.stringify(asset, null, 2));
    console.log('\n--- Render Job ---');
    console.log(JSON.stringify(job, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
