import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    DataTable,
    Text,
    BlockStack,
    InlineStack,
    ProgressBar,
    Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    let shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });

    if (!shop) {
        // Create shop if it doesn't exist
        const { PLANS } = await import("../billing");
        shop = await prisma.shop.create({
            data: {
                shopDomain: session.shop,
                plan: PLANS.FREE.id,
                dailyQuota: PLANS.FREE.dailyQuota,
                monthlyQuota: PLANS.FREE.monthlyQuota,
                geminiApiKey: process.env.GEMINI_API_KEY || ""
            }
        });
    }

    // Recent jobs
    const recentJobs = await prisma.renderJob.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
            id: true,
            productId: true,
            status: true,
            stylePreset: true,
            createdAt: true,
            completedAt: true,
            errorMessage: true
        }
    });

    // Success rate (completed vs failed only)
    const statusCounts = await prisma.renderJob.groupBy({
        by: ['status'],
        where: {
            shopId: shop.id,
            status: { in: ['completed', 'failed'] }
        },
        _count: true
    });

    const completed = statusCounts.find(s => s.status === 'completed')?._count || 0;
    const failed = statusCounts.find(s => s.status === 'failed')?._count || 0;
    const successRate = completed + failed > 0 ? (completed / (completed + failed)) * 100 : 0;

    // Style preset popularity
    const presetStats = await prisma.renderJob.groupBy({
        by: ['stylePreset'],
        where: { shopId: shop.id, status: 'completed' },
        _count: true
    });

    return json({ recentJobs, successRate, presetStats, completed, failed });
};

export default function Analytics() {
    const { recentJobs, successRate, presetStats, completed, failed } = useLoaderData();

    const rows = recentJobs.map(job => [
        new Date(job.createdAt).toLocaleString(),
        job.productId.split('/').pop(),
        <Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'critical' : 'info'}>
            {job.status}
        </Badge>,
        job.stylePreset || 'Default',
        job.completedAt ? `${Math.round((new Date(job.completedAt) - new Date(job.createdAt)) / 1000)}s` : '-',
    ]);

    const presetRows = presetStats.map(stat => [
        stat.stylePreset || 'Default',
        stat._count.toString(),
        `${Math.round((stat._count / completed) * 100)}%`
    ]);

    return (
        <Page title="Analytics" backAction={{ url: "/app" }}>
            <Layout>
                <Layout.Section>
                    <BlockStack gap="400">
                        <Card>
                            <BlockStack gap="200">
                                <Text variant="headingMd" as="h2">Success Rate</Text>
                                <InlineStack gap="200" align="space-between">
                                    <Text variant="bodyLg" as="p">
                                        {successRate.toFixed(1)}% successful
                                    </Text>
                                    <Text variant="bodySm" tone="subdued">
                                        {completed} completed, {failed} failed
                                    </Text>
                                </InlineStack>
                                <ProgressBar progress={successRate} tone="success" />
                            </BlockStack>
                        </Card>

                        <Card>
                            <BlockStack gap="400">
                                <Text variant="headingMd" as="h2">Recent Render Jobs</Text>
                                <DataTable
                                    columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                                    headings={['Date', 'Product ID', 'Status', 'Style Preset', 'Duration']}
                                    rows={rows}
                                />
                            </BlockStack>
                        </Card>

                        {presetStats.length > 0 && (
                            <Card>
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Style Preset Popularity</Text>
                                    <DataTable
                                        columnContentTypes={['text', 'numeric', 'numeric']}
                                        headings={['Preset', 'Count', 'Percentage']}
                                        rows={presetRows}
                                    />
                                </BlockStack>
                            </Card>
                        )}
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
