import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.public.appProxy(request);

    if (!session || !admin) {
        return json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const productId = url.searchParams.get("product_id");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 20);

    if (!productId) {
        return json({ error: "product_id required" }, { status: 400 });
    }

    try {
        // First, get the product's collections
        const productResponse = await admin.graphql(`
      query getProductCollections($id: ID!) {
        product(id: $id) {
          id
          collections(first: 1) {
            edges {
              node {
                id
                handle
                title
              }
            }
          }
        }
      }
    `, {
            variables: { id: `gid://shopify/Product/${productId}` }
        });

        const productData = await productResponse.json();
        const collections = productData.data?.product?.collections?.edges || [];

        if (collections.length === 0) {
            // No collection found, return empty
            return json({ products: [], collection: null });
        }

        const collection = collections[0].node;

        // Get products from that collection (excluding current product)
        const collectionResponse = await admin.graphql(`
      query getCollectionProducts($id: ID!, $first: Int!) {
        collection(id: $id) {
          products(first: $first) {
            edges {
              node {
                id
                title
                handle
                featuredImage {
                  url
                  altText
                }
                priceRange {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    `, {
            variables: { id: collection.id, first: limit + 1 } // +1 to account for current product
        });

        const collectionData = await collectionResponse.json();
        const allProducts = collectionData.data?.collection?.products?.edges || [];

        // Filter out current product and format
        const products = allProducts
            .map((edge: any) => edge.node)
            .filter((p: any) => !p.id.includes(productId))
            .slice(0, limit)
            .map((p: any) => ({
                id: p.id.replace("gid://shopify/Product/", ""),
                title: p.title,
                handle: p.handle,
                image: p.featuredImage?.url || null,
                price: p.priceRange?.minVariantPrice?.amount || null,
                currency: p.priceRange?.minVariantPrice?.currencyCode || "USD"
            }));

        return json({
            products,
            collection: {
                id: collection.id,
                handle: collection.handle,
                title: collection.title
            }
        });
    } catch (error) {
        console.error("[See It] Collection products error:", error);
        return json({ error: "Failed to fetch products" }, { status: 500 });
    }
};
