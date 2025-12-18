/**
 * Integration test for the prepare route
 * 
 * Tests the prepare route with various scenarios using the flow harness
 */

import { runPrepareFlowForProduct } from "../flows/prepareFlow.test";
import prisma from "../../db.server";

/**
 * Test prepare route with valid product
 */
export async function testPrepareValidProduct(
    shopId: string,
    productId: string,
    sourceImageUrl: string
): Promise<{
    success: boolean;
    assetStatus?: string;
    error?: string;
}> {
    const result = await runPrepareFlowForProduct({
        shopId,
        productId,
        sourceImageUrl,
    });

    // Verify asset status in DB
    if (result.success) {
        const asset = await prisma.productAsset.findFirst({
            where: {
                shopId,
                productId,
            },
        });

        if (!asset || asset.status !== "ready") {
            return {
                success: false,
                error: `Expected asset status 'ready', got '${asset?.status}'`,
            };
        }

        if (!asset.preparedImageUrl) {
            return {
                success: false,
                error: "Asset missing preparedImageUrl",
            };
        }
    }

    return result;
}

/**
 * Test prepare route with invalid URL
 */
export async function testPrepareInvalidUrl(
    shopId: string,
    productId: string
): Promise<{
    success: boolean;
    assetStatus?: string;
    error?: string;
}> {
    const invalidUrl = "https://invalid-domain-that-does-not-exist.com/image.png";

    const result = await runPrepareFlowForProduct({
        shopId,
        productId,
        sourceImageUrl: invalidUrl,
        simulate: {
            brokenCdn: true,
        },
    });

    // Verify asset status is failed
    if (!result.success) {
        const asset = await prisma.productAsset.findFirst({
            where: {
                shopId,
                productId,
            },
        });

        if (asset && asset.status !== "failed") {
            return {
                success: false,
                error: `Expected asset status 'failed', got '${asset.status}'`,
            };
        }

        if (asset && !asset.errorMessage) {
            return {
                success: false,
                error: "Asset missing errorMessage on failure",
            };
        }
    }

    return result;
}

/**
 * Test prepare route with simulated storage failure
 */
export async function testPrepareStorageFailure(
    shopId: string,
    productId: string,
    sourceImageUrl: string
): Promise<{
    success: boolean;
    assetStatus?: string;
    error?: string;
}> {
    const result = await runPrepareFlowForProduct({
        shopId,
        productId,
        sourceImageUrl,
        simulate: {
            gcsFailure: true,
        },
    });

    // Verify asset status is failed
    if (!result.success) {
        const asset = await prisma.productAsset.findFirst({
            where: {
                shopId,
                productId,
            },
        });

        if (asset && asset.status !== "failed") {
            return {
                success: false,
                error: `Expected asset status 'failed', got '${asset.status}'`,
            };
        }
    }

    return result;
}

/**
 * Run all integration tests
 */
export async function runAllPrepareRouteTests(
    testShopId: string,
    testProductId: string,
    testImageUrl: string
): Promise<{
    valid: { success: boolean; error?: string };
    invalidUrl: { success: boolean; error?: string };
    storageFailure: { success: boolean; error?: string };
}> {
    console.log("Running prepare route integration tests...");

    const results = {
        valid: await testPrepareValidProduct(testShopId, testProductId, testImageUrl).catch(
            (err) => ({ success: false, error: String(err) })
        ),
        invalidUrl: await testPrepareInvalidUrl(testShopId, testProductId).catch(
            (err) => ({ success: false, error: String(err) })
        ),
        storageFailure: await testPrepareStorageFailure(
            testShopId,
            testProductId,
            testImageUrl
        ).catch((err) => ({ success: false, error: String(err) })),
    };

    console.log("Prepare route test results:", results);
    return results;
}



