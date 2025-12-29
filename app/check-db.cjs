
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const assetsCount = await prisma.productAsset.count();
    const pendingAssets = await prisma.productAsset.findMany({
        where: { status: 'pending' }
    });
    const processingAssets = await prisma.productAsset.findMany({
        where: { status: 'processing' }
    });
    const failedAssets = await prisma.productAsset.findMany({
        where: { status: 'failed' }
    });
    const readyAssets = await prisma.productAsset.findMany({
        where: { status: 'ready' }
    });

    console.log('--- ProductAssets ---');
    console.log(`Total: ${assetsCount}`);
    console.log(`Pending: ${pendingAssets.length}`);
    console.log(`Processing: ${processingAssets.length}`);
    console.log(`Failed: ${failedAssets.length}`);
    console.log(`Ready: ${readyAssets.length}`);

    if (pendingAssets.length > 0) {
        console.log('Pending Asset Example:', pendingAssets[0]);
    }
    if (failedAssets.length > 0) {
        console.log('Failed Asset Example (first 3):', failedAssets.slice(0, 3).map(a => ({ id: a.id, error: a.errorMessage, retry: a.retryCount })));
    }

    const jobsCount = await prisma.renderJob.count();
    const queuedJobs = await prisma.renderJob.findMany({
        where: { status: 'queued' }
    });
    const processingJobs = await prisma.renderJob.findMany({
        where: { status: 'processing' }
    });
    const completedJobs = await prisma.renderJob.findMany({
        where: { status: 'completed' }
    });
    const failedJobs = await prisma.renderJob.findMany({
        where: { status: 'failed' }
    });

    console.log('\n--- RenderJobs ---');
    console.log(`Total: ${jobsCount}`);
    console.log(`Queued: ${queuedJobs.length}`);
    console.log(`Processing: ${processingJobs.length}`);
    console.log(`Completed: ${completedJobs.length}`);
    console.log(`Failed: ${failedJobs.length}`);

    if (queuedJobs.length > 0) {
        console.log('Queued Job Example:', queuedJobs[0]);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
