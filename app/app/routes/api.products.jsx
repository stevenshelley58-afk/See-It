import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /api/products — list products with See It status (spec Routes → Admin API)
export const loader = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);

    // Fetch products via Shopify GraphQL (paginated)
    let allProducts = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
        const response = await admin.graphql(
            `#graphql
            query getProducts($cursor: String) {
                products(first: 50, after: $cursor) {
                    edges {
                        node {
                            id
                            title
                            handle
                            featuredImage {
                                id
                                url
                                altText
                            }
                        }
                        cursor
                    }
                    pageInfo {
                        hasNextPage
                    }
                }
            }`,
            { variables: { cursor } }
        );

        const responseJson = await response.json();

        // Handle GraphQL errors
        if (!responseJson.data || !responseJson.data.products) {
            const errorMessage = responseJson.errors
                ? responseJson.errors.map(e => e.message).join(', ')
                : 'Unknown GraphQL error';

            console.error('[Products] GraphQL query failed:', {
                errors: responseJson.errors,
                hasData: !!responseJson.data
            });

            return json(
                {
                    error: 'Failed to fetch products from Shopify',
                    message: errorMessage,
                    products: [],
                    status_counts: { ready: 0, pending: 0, processing: 0, failed: 0, stale: 0, unprepared: 0 }
                },
                { status: responseJson.errors ? 502 : 500 }
            );
        }

        const { edges, pageInfo } = responseJson.data.products;

        allProducts = [...allProducts, ...edges.map((edge) => edge.node)];
        hasNextPage = pageInfo.hasNextPage;

        if (edges.length > 0) {
            cursor = edges[edges.length - 1].cursor;
        }
    }

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
    });

    let assetsMap = {};
    let statusCounts = { ready: 0, pending: 0, processing: 0, failed: 0, stale: 0, unprepared: 0 };

    if (shop) {
        const assets = await prisma.productAsset.findMany({
            where: { shopId: shop.id }
        });
        assets.forEach(a => {
            assetsMap[a.productId] = a;
            statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
        });
    }

    statusCounts.unprepared = allProducts.length - Object.keys(assetsMap).length;

    return json({
        products: allProducts.map((p) => {
            const asset = assetsMap[p.id];
            return {
                id: p.id,
                title: p.title,
                handle: p.handle,
                featured_image: p.featuredImage,
                status: asset?.status || "unprepared",
                prepared_image_url: asset?.preparedImageUrl || null,
                source_image_url: asset?.sourceImageUrl || null,
                asset_id: asset?.id || null,
                updated_at: asset?.updatedAt || null
            };
        }),
        status_counts: statusCounts
    });
};




