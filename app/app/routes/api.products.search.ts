import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";
    const limit = parseInt(url.searchParams.get("limit") || "10");

    if (!query || query.length < 2) {
        return json({ products: [], orders: [], draftOrders: [] });
    }

    try {
        // Search products
        const productsResponse = await admin.graphql(
            `#graphql
            query searchProducts($query: String!, $first: Int!) {
                products(first: $first, query: $query) {
                    edges {
                        node {
                            id
                            title
                            handle
                            status
                            totalInventory
                            priceRangeV2 {
                                minVariantPrice { amount currencyCode }
                            }
                            featuredImage { id url altText }
                        }
                    }
                }
            }`,
            { variables: { query: `title:*${query}* OR tag:*${query}*`, first: limit } }
        );

        const productsData = await productsResponse.json();
        const products = productsData.data?.products?.edges?.map((edge: any) => edge.node) || [];

        // Search orders (if needed - you can add this later)
        // For now, we'll just return products
        const orders: any[] = [];
        const draftOrders: any[] = [];

        return json({
            products,
            orders,
            draftOrders,
            query
        });
    } catch (error) {
        console.error("Search error:", error);
        return json({ products: [], orders: [], draftOrders: [], error: "Search failed" }, { status: 500 });
    }
};
