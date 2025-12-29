# See It Widget Implementation — Complete Rebuild

## Overview

Update the See It customer widget with:
1. Clean Position screen (no labels, resize handles)
2. Result screen with Share, Try Again, Try Another Product, Email capture
3. Tinder-style product swiper with auto collection detection
4. Email capture to database
5. Code cleanup and consistency improvements

**Files to modify:**
- `extensions/see-it-extension/blocks/see-it-button.liquid`
- `extensions/see-it-extension/assets/see-it-modal.js`
- `extensions/see-it-extension/assets/see-it-modal.css`
- `prisma/schema.prisma`

**Files to create:**
- `app/routes/app-proxy.capture.ts`
- `app/routes/app-proxy.collection-products.ts`

---

## STEP 1: Prisma Schema — Add SeeItCapture Model

Add to `prisma/schema.prisma`:

```prisma
model SeeItCapture {
  id            String   @id @default(uuid())
  shopId        String   @map("shop_id")
  email         String
  productId     String   @map("product_id")
  productTitle  String?  @map("product_title")
  renderJobId   String?  @map("render_job_id")
  imageUrl      String?  @map("image_url")
  createdAt     DateTime @default(now()) @map("created_at")

  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)

  @@index([shopId, email])
  @@index([shopId, createdAt])
  @@map("see_it_captures")
}
```

Add to Shop model relations:
```prisma
seeItCaptures SeeItCapture[]
```

Run: `npx prisma db push`

---

## STEP 2: Create Email Capture Endpoint

Create `app/routes/app-proxy.capture.ts`:

```typescript
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { email, product_id, product_title, render_job_id, image_url } = body;

    if (!email || !product_id) {
      return json({ error: "Email and product_id required" }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return json({ error: "Invalid email format" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop }
    });

    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    const capture = await prisma.seeItCapture.create({
      data: {
        shopId: shop.id,
        email: email.toLowerCase().trim(),
        productId: String(product_id),
        productTitle: product_title || null,
        renderJobId: render_job_id || null,
        imageUrl: image_url || null
      }
    });

    console.log(`[See It] Email captured: ${email} for product ${product_id}`);

    return json({ success: true, id: capture.id });
  } catch (error) {
    console.error("[See It] Capture error:", error);
    return json({ error: "Failed to save email" }, { status: 500 });
  }
};
```

---

## STEP 3: Create Collection Products Endpoint

Create `app/routes/app-proxy.collection-products.ts`:

```typescript
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
```

---

## STEP 4: Update Liquid Template

Replace entire `see-it-button.liquid` with:

```liquid
{% schema %}
{
  "name": "See It Button",
  "target": "section",
  "stylesheet": "see-it-modal.css",
  "javascript": "see-it-modal.js",
  "templates": ["product"],
  "settings": [
    {
      "type": "text",
      "id": "button_label",
      "label": "Button Label",
      "default": "See it in your room"
    },
    {
      "type": "select",
      "id": "button_style",
      "label": "Button Style",
      "options": [
        { "value": "primary", "label": "Primary" },
        { "value": "secondary", "label": "Secondary" }
      ],
      "default": "primary"
    }
  ]
}
{% endschema %}

{% if product != blank and product.featured_image != blank %}
  {% assign product_image_url = product.featured_image | image_url: width: 800 %}
  {% assign product_title = product.title | default: "Product" %}
  {% assign product_price = product.price | money %}
  {% assign product_collection = product.collections.first.handle | default: '' %}
  
  {% assign btn_class = 'see-it-btn-primary-pill' %}
  {% if block.settings.button_style == 'secondary' %}
    {% assign btn_class = 'see-it-btn-outline-pill' %}
  {% endif %}

  <!-- Widget Container -->
  <div class="see-it-widget-hook">
    <div class="see-it-widget-content">
      <div class="see-it-widget-text">
        <span class="see-it-widget-title">Try it in Your Home</span>
        <span class="see-it-widget-description">Get a real view of this in your space.</span>
      </div>
    </div>
    
    <button
      id="see-it-trigger"
      class="{{ btn_class }}"
      data-product-id="{{ product.id }}"
      data-product-handle="{{ product.handle }}"
      data-product-image="{{ product_image_url }}"
      data-product-title="{{ product_title | escape }}"
      data-product-price="{{ product_price | escape }}"
      data-product-collection="{{ product_collection }}"
      data-shop-domain="{{ shop.domain }}"
      type="button"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2 L22 7 L22 17 L12 22 L2 17 L2 7 Z"/>
        <path d="M12 2 L12 22"/>
        <path d="M22 7 L12 12 L2 7"/>
      </svg>
      {{ block.settings.button_label | default: "See it in your room" }}
    </button>
  </div>

  <!-- Modal -->
  <div id="see-it-modal" class="see-it-modal hidden">
    <div class="see-it-modal-content">
      <div id="see-it-global-error" class="see-it-hidden"></div>

      <!-- ENTRY SCREEN -->
      <div id="see-it-screen-entry" class="see-it-screen see-it-screen-entry active">
        <div class="see-it-header">
          <button class="see-it-btn-icon" id="see-it-close-entry" aria-label="Close">
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          <div class="see-it-header-spacer"></div>
        </div>

        <div class="see-it-entry-content">
          <div class="see-it-product-card-compact">
            <img src="{{ product_image_url }}" alt="">
            <div class="see-it-product-info-compact">
              <p class="see-it-product-title-compact">{{ product_title }}</p>
            </div>
          </div>

          <h1 class="see-it-entry-title">See it in your space</h1>
          <p class="see-it-entry-description">Take a photo of your room to see how this looks instantly.</p>

          <div class="see-it-entry-actions">
            <button class="see-it-btn-primary-pill" id="see-it-btn-take-photo">
              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/></svg>
              Take Photo
            </button>
            <button class="see-it-btn-outline-pill" id="see-it-btn-upload">Upload</button>
          </div>
        </div>
      </div>

      <!-- PREPARE SCREEN -->
      <div id="see-it-screen-prepare" class="see-it-screen see-it-screen-prepare">
        <div class="see-it-header">
          <button class="see-it-btn-icon" id="see-it-back-prepare" aria-label="Back">
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div class="see-it-header-spacer"></div>
        </div>

        <div class="see-it-canvas-container">
          <img id="see-it-room-preview" class="see-it-room-preview" src="" alt="Room">
          <canvas id="see-it-mask-canvas" class="see-it-mask-canvas"></canvas>
        </div>

        <div class="see-it-prepare-footer">
          <p class="see-it-prepare-hint">Paint over objects to remove them</p>
          <div class="see-it-brush-control">
            <span>Brush Size</span>
            <input type="range" id="see-it-brush-slider" class="see-it-brush-slider" min="10" max="80" value="40">
          </div>
          <div class="see-it-prepare-actions">
            <button class="see-it-btn-outline-pill see-it-btn-sm" id="see-it-undo-btn" disabled>Undo</button>
            <button class="see-it-btn-outline-pill see-it-btn-sm" id="see-it-remove-btn">Erase</button>
            <button class="see-it-btn-primary-pill see-it-btn-sm" id="see-it-confirm-room">Continue</button>
          </div>
        </div>
      </div>

      <!-- POSITION SCREEN -->
      <div id="see-it-screen-position" class="see-it-screen see-it-screen-position">
        <div class="see-it-header">
          <button class="see-it-btn-icon" id="see-it-back-position" aria-label="Back">
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div class="see-it-header-spacer"></div>
        </div>

        <div class="see-it-canvas-container" id="see-it-position-container">
          <img id="see-it-room-image" src="" alt="Room">
          <div id="see-it-product-overlay" class="see-it-product-overlay">
            <img id="see-it-product-image" src="" alt="Product" draggable="false">
            <div class="see-it-resize-handle see-it-resize-nw"></div>
            <div class="see-it-resize-handle see-it-resize-ne"></div>
            <div class="see-it-resize-handle see-it-resize-sw"></div>
            <div class="see-it-resize-handle see-it-resize-se"></div>
          </div>
          <div id="see-it-position-hint" class="see-it-position-hint">Drag to move • Pinch to resize</div>
        </div>

        <div class="see-it-position-footer">
          <button class="see-it-btn-primary-pill" id="see-it-generate">Generate View</button>
        </div>
      </div>

      <!-- LOADING SCREEN -->
      <div id="see-it-screen-loading" class="see-it-screen see-it-screen-loading">
        <div class="see-it-header">
          <button class="see-it-btn-icon" disabled style="opacity:0.3">
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div class="see-it-header-spacer"></div>
        </div>

        <div class="see-it-loading-content">
          <div class="see-it-spinner"></div>
          <p class="see-it-loading-text">Creating your view...</p>
        </div>
      </div>

      <!-- RESULT SCREEN -->
      <div id="see-it-screen-result" class="see-it-screen see-it-screen-result">
        <div class="see-it-header">
          <button class="see-it-btn-icon" id="see-it-back-result" aria-label="Back">
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div style="flex:1"></div>
          <button class="see-it-btn-icon" id="see-it-close-result" aria-label="Close">
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="see-it-result-container">
          <img id="see-it-result-image" src="" alt="Your visualization">
        </div>

        <div class="see-it-result-actions">
          <button class="see-it-btn-primary-pill" id="see-it-share">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
            Share
          </button>
          <div class="see-it-result-secondary">
            <button class="see-it-btn-text" id="see-it-try-again">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              Try Again
            </button>
            <button class="see-it-btn-text" id="see-it-try-another">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              Try Another Product
            </button>
          </div>
        </div>

        <div class="see-it-email-section">
          <div id="see-it-email-form-wrap">
            <p class="see-it-email-label">Save this to your inbox</p>
            <form id="see-it-email-form" class="see-it-email-form">
              <input type="email" id="see-it-email-input" placeholder="your@email.com" required>
              <button type="submit" id="see-it-email-submit">Send</button>
            </form>
          </div>
          <div id="see-it-email-success" class="see-it-hidden">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            <span>Sent! Check your inbox.</span>
          </div>
        </div>

        <!-- Product Swiper Overlay -->
        <div id="see-it-swiper" class="see-it-swiper">
          <button class="see-it-swiper-close" id="see-it-swiper-close">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          
          <div class="see-it-swiper-nav" id="see-it-swiper-nav">
            <button id="see-it-swiper-prev">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <button id="see-it-swiper-next">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
          
          <div class="see-it-swiper-card" id="see-it-swiper-card">
            <img id="see-it-swiper-img" src="" alt="Product">
            <div class="see-it-swiper-info">
              <div class="see-it-swiper-name" id="see-it-swiper-name"></div>
              <div class="see-it-swiper-collection" id="see-it-swiper-collection"></div>
            </div>
          </div>

          <p class="see-it-swiper-hint">Swipe to browse • Tap ✓ to try</p>

          <div class="see-it-swiper-actions">
            <button class="see-it-swiper-btn see-it-swiper-btn-skip" id="see-it-swiper-skip-left">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <button class="see-it-swiper-btn see-it-swiper-btn-select" id="see-it-swiper-select">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            </button>
            <button class="see-it-swiper-btn see-it-swiper-btn-skip" id="see-it-swiper-skip-right">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Hidden File Inputs -->
      <input type="file" id="see-it-upload-input" accept="image/*" style="display: none;">
      <input type="file" id="see-it-camera-input" accept="image/*" capture="environment" style="display: none;">
    </div>
  </div>
{% endif %}
```

---

## STEP 5: Update CSS

Add to end of `see-it-modal.css`:

```css
/* =========================================
   Header Spacer
   ========================================= */
.see-it-header-spacer {
  width: 40px;
}

/* =========================================
   Canvas Container (Shared)
   ========================================= */
.see-it-canvas-container {
  flex: 1;
  position: relative;
  background: #f0f0f0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.see-it-canvas-container img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* =========================================
   Prepare Screen Footer
   ========================================= */
.see-it-prepare-footer {
  padding: 16px 20px;
  background: var(--si-surface);
  border-top: 1px solid var(--si-border-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.see-it-prepare-hint {
  text-align: center;
  color: var(--si-muted);
  font-size: 13px;
  margin: 0;
}

.see-it-brush-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

.see-it-brush-control span {
  font-size: 13px;
  color: var(--si-muted);
  white-space: nowrap;
}

.see-it-brush-slider {
  flex: 1;
  height: 2px;
  -webkit-appearance: none;
  appearance: none;
  background: #d4d4d4;
  border-radius: 1px;
  outline: none;
}

.see-it-brush-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: var(--si-cta);
  border-radius: 50%;
  cursor: pointer;
}

.see-it-brush-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--si-cta);
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

.see-it-prepare-actions {
  display: flex;
  gap: 8px;
}

.see-it-btn-sm {
  flex: 1;
  min-height: 44px;
}

/* =========================================
   Position Screen Footer
   ========================================= */
.see-it-position-footer {
  padding: 16px 20px;
  background: var(--si-surface);
  border-top: 1px solid var(--si-border-soft);
}

.see-it-position-hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.7);
  color: #fff;
  padding: 8px 16px;
  border-radius: 100px;
  font-size: 12px;
  font-weight: 500;
  pointer-events: none;
  white-space: nowrap;
  transition: opacity 0.3s;
  z-index: 5;
}

.see-it-position-hint.see-it-hidden {
  opacity: 0;
}

/* =========================================
   Loading Screen
   ========================================= */
.see-it-loading-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.see-it-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e5e5e5;
  border-top-color: var(--si-cta);
  border-radius: 50%;
  animation: see-it-spin 0.8s linear infinite;
}

@keyframes see-it-spin {
  to { transform: rotate(360deg); }
}

.see-it-loading-text {
  font-size: 14px;
  color: var(--si-muted);
  font-weight: 500;
}

/* =========================================
   Result Screen
   ========================================= */
.see-it-result-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.see-it-result-container img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.see-it-result-actions {
  padding: 16px 20px;
  background: var(--si-surface);
  border-top: 1px solid var(--si-border-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.see-it-result-secondary {
  display: flex;
  justify-content: center;
  gap: 4px;
}

.see-it-btn-text {
  background: none;
  border: none;
  color: var(--si-muted);
  font-size: 13px;
  font-weight: 500;
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}

.see-it-btn-text:hover {
  color: var(--si-text);
  background: var(--si-border-soft);
}

/* =========================================
   Email Section
   ========================================= */
.see-it-email-section {
  padding: 16px 20px;
  background: #fafafa;
  border-top: 1px solid var(--si-border-soft);
}

.see-it-email-label {
  font-size: 13px;
  color: var(--si-muted);
  margin: 0 0 10px 0;
  font-weight: 500;
}

.see-it-email-form {
  display: flex;
  gap: 8px;
}

.see-it-email-form input {
  flex: 1;
  padding: 12px 14px;
  border: 1px solid var(--si-border);
  border-radius: 10px;
  font-size: 14px;
  font-family: var(--si-font);
  outline: none;
  transition: border-color 0.15s;
  background: #fff;
  min-width: 0;
}

.see-it-email-form input:focus {
  border-color: var(--si-text);
}

.see-it-email-form input::placeholder {
  color: var(--si-muted-2);
}

.see-it-email-form button {
  padding: 12px 20px;
  background: var(--si-cta);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  font-family: var(--si-font);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.see-it-email-form button:hover {
  background: var(--si-cta-hover);
}

.see-it-email-form button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

#see-it-email-success {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--si-success);
  font-size: 14px;
  font-weight: 500;
}

#see-it-email-success.see-it-hidden {
  display: none;
}

/* =========================================
   Product Swiper
   ========================================= */
.see-it-swiper {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.85);
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 30;
  padding: 20px;
}

.see-it-swiper.see-it-active {
  display: flex;
}

.see-it-swiper-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(255,255,255,0.2);
  border: none;
  border-radius: 50%;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #fff;
}

.see-it-swiper-card {
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  width: 100%;
  max-width: 280px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.3);
  transition: transform 0.2s ease;
}

.see-it-swiper-card.swiping-left {
  transform: translateX(-20px) rotate(-5deg);
}

.see-it-swiper-card.swiping-right {
  transform: translateX(20px) rotate(5deg);
}

.see-it-swiper-card img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: #f5f5f5;
}

.see-it-swiper-info {
  padding: 16px;
  text-align: center;
}

.see-it-swiper-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--si-text);
  margin-bottom: 4px;
}

.see-it-swiper-collection {
  font-size: 12px;
  color: var(--si-muted);
}

.see-it-swiper-hint {
  color: rgba(255,255,255,0.6);
  font-size: 12px;
  margin-top: 16px;
}

.see-it-swiper-actions {
  display: flex;
  gap: 16px;
  margin-top: 20px;
}

.see-it-swiper-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s;
}

.see-it-swiper-btn:hover {
  transform: scale(1.1);
}

.see-it-swiper-btn:active {
  transform: scale(0.95);
}

.see-it-swiper-btn-skip {
  background: rgba(255,255,255,0.2);
  color: #fff;
}

.see-it-swiper-btn-select {
  background: #fff;
  color: var(--si-text);
}

.see-it-swiper-btn svg {
  width: 24px;
  height: 24px;
}

/* Desktop nav arrows */
.see-it-swiper-nav {
  display: none;
}

@media (min-width: 768px) {
  .see-it-swiper-card {
    max-width: 320px;
  }

  .see-it-swiper-nav {
    display: flex;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: calc(100% - 80px);
    justify-content: space-between;
    pointer-events: none;
  }

  .see-it-swiper-nav button {
    pointer-events: auto;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.9);
    color: var(--si-text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
  }

  .see-it-swiper-nav button:hover {
    transform: scale(1.1);
  }

  .see-it-swiper-hint {
    display: none;
  }

  /* Desktop result actions horizontal */
  .see-it-result-actions {
    flex-direction: row;
    align-items: center;
    gap: 16px;
  }

  .see-it-result-actions .see-it-btn-primary-pill {
    width: auto;
    flex: 0 0 auto;
  }

  .see-it-result-secondary {
    flex: 1;
    justify-content: flex-start;
  }

  .see-it-email-section {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .see-it-email-label {
    margin: 0;
    white-space: nowrap;
  }

  .see-it-email-form {
    flex: 1;
    max-width: 400px;
  }
}

/* =========================================
   Remove old unused styles
   ========================================= */
/* DELETE: .see-it-position-controls (replaced by .see-it-position-footer) */
/* DELETE: .see-it-save-room-row (removed feature) */
/* DELETE: .see-it-result-success (replaced) */
/* DELETE: .see-it-prepare-bottom (replaced by .see-it-prepare-footer) */
```

---

## STEP 6: Update JavaScript

Replace `see-it-modal.js` with the cleaned up version. Key changes:

### 6.1 Add new element references (near top):

```javascript
// Result screen elements
const btnBackResult = $('see-it-back-result');
const btnCloseResult = $('see-it-close-result');
const resultImage = $('see-it-result-image');
const btnShare = $('see-it-share');
const btnTryAgain = $('see-it-try-again');
const btnTryAnother = $('see-it-try-another');

// Email capture elements
const emailForm = $('see-it-email-form');
const emailInput = $('see-it-email-input');
const emailSubmit = $('see-it-email-submit');
const emailFormWrap = $('see-it-email-form-wrap');
const emailSuccess = $('see-it-email-success');

// Swiper elements
const swiper = $('see-it-swiper');
const swiperClose = $('see-it-swiper-close');
const swiperCard = $('see-it-swiper-card');
const swiperImg = $('see-it-swiper-img');
const swiperName = $('see-it-swiper-name');
const swiperCollection = $('see-it-swiper-collection');
const swiperPrev = $('see-it-swiper-prev');
const swiperNext = $('see-it-swiper-next');
const swiperSkipLeft = $('see-it-swiper-skip-left');
const swiperSkipRight = $('see-it-swiper-skip-right');
const swiperSelect = $('see-it-swiper-select');

// Position hint
const positionHint = $('see-it-position-hint');

// Brush slider
const brushSlider = $('see-it-brush-slider');

// Loading screen
const screenLoading = $('see-it-screen-loading');
```

### 6.2 Add to state object:

```javascript
let state = {
  // ... existing state ...
  lastRenderJobId: null,
  lastResultUrl: null,
  collectionProducts: [],
  collectionInfo: null,
  swiperIndex: 0
};
```

### 6.3 Add brush slider handler:

```javascript
// Brush size slider
if (brushSlider) {
  brushSlider.addEventListener('input', (e) => {
    brushSize = parseInt(e.target.value);
    if (ctx) ctx.lineWidth = brushSize;
    if (maskCtx && state.normalizedWidth && maskCanvas) {
      const scale = state.normalizedWidth / maskCanvas.width;
      maskCtx.lineWidth = brushSize * scale;
    }
  });
}
```

### 6.4 Add email capture function:

```javascript
const captureEmail = async (email) => {
  try {
    const res = await fetch('/apps/see-it/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        product_id: state.productId,
        product_title: state.productTitle,
        render_job_id: state.lastRenderJobId,
        image_url: state.lastResultUrl
      })
    });
    return res.ok;
  } catch (e) {
    console.error('[See It] Email capture failed:', e);
    return false;
  }
};
```

### 6.5 Add collection products fetcher:

```javascript
const fetchCollectionProducts = async () => {
  try {
    const res = await fetch(`/apps/see-it/collection-products?product_id=${state.productId}&limit=10`);
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    state.collectionProducts = data.products || [];
    state.collectionInfo = data.collection || null;
    state.swiperIndex = 0;
    console.log('[See It] Collection products loaded:', state.collectionProducts.length);
  } catch (e) {
    console.error('[See It] Failed to load collection products:', e);
    state.collectionProducts = [];
  }
};
```

### 6.6 Add swiper functions:

```javascript
const showSwiper = () => {
  if (state.collectionProducts.length === 0) {
    console.log('[See It] No products to show in swiper');
    return;
  }
  updateSwiperCard();
  swiper?.classList.add('see-it-active');
};

const hideSwiper = () => {
  swiper?.classList.remove('see-it-active');
};

const updateSwiperCard = () => {
  const product = state.collectionProducts[state.swiperIndex];
  if (!product) return;
  
  if (swiperImg) swiperImg.src = product.image || '';
  if (swiperName) swiperName.textContent = product.title;
  if (swiperCollection && state.collectionInfo) {
    swiperCollection.textContent = state.collectionInfo.title;
  }
};

const swipeCard = (direction) => {
  swiperCard?.classList.add(direction === 'left' ? 'swiping-left' : 'swiping-right');
  
  setTimeout(() => {
    swiperCard?.classList.remove('swiping-left', 'swiping-right');
    
    if (direction === 'right') {
      state.swiperIndex = (state.swiperIndex + 1) % state.collectionProducts.length;
    } else {
      state.swiperIndex = (state.swiperIndex - 1 + state.collectionProducts.length) % state.collectionProducts.length;
    }
    updateSwiperCard();
  }, 150);
};

const selectSwiperProduct = () => {
  const product = state.collectionProducts[state.swiperIndex];
  if (!product) return;
  
  // Update state with new product
  state.productId = product.id;
  state.productTitle = product.title;
  state.productImageUrl = product.image;
  
  // Update product overlay image
  if (productImage) productImage.src = product.image;
  
  hideSwiper();
  showScreen('position');
};

// Swiper touch support
const setupSwiperTouch = () => {
  if (!swiperCard) return;
  
  let startX = 0;
  let currentX = 0;
  
  swiperCard.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
  });
  
  swiperCard.addEventListener('touchmove', (e) => {
    currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    swiperCard.style.transform = `translateX(${diff}px) rotate(${diff * 0.05}deg)`;
  });
  
  swiperCard.addEventListener('touchend', () => {
    const diff = currentX - startX;
    swiperCard.style.transform = '';
    
    if (Math.abs(diff) > 80) {
      swipeCard(diff > 0 ? 'right' : 'left');
    }
    startX = 0;
    currentX = 0;
  });
};
```

### 6.7 Update handleGenerate to save result info:

```javascript
const handleGenerate = async () => {
  if (!state.sessionId || !state.productId) {
    showError('Missing session or product');
    return;
  }

  showScreen('loading'); // Show loading screen
  resetError();

  try {
    const payload = {
      room_session_id: state.sessionId,
      product_id: state.productId,
      placement: { x: state.x, y: state.y, scale: state.scale || 1 },
      config: {
        style_preset: 'neutral',
        quality: 'standard',
        product_image_url: state.productImageUrl
      }
    };

    const res = await fetch('/apps/see-it/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.status === 'failed') {
      throw new Error(data.error || 'Render failed');
    }

    let imageUrl = null;
    let jobId = null;

    if (data.status === 'completed' && data.imageUrl) {
      imageUrl = data.imageUrl;
      jobId = data.job_id;
    } else if (data.job_id) {
      const result = await pollJobStatus(data.job_id);
      imageUrl = result.imageUrl || result.image_url;
      jobId = data.job_id;
    }

    if (imageUrl) {
      // Save for email capture
      state.lastRenderJobId = jobId;
      state.lastResultUrl = imageUrl;
      
      // Reset email form
      if (emailFormWrap) emailFormWrap.classList.remove('see-it-hidden');
      if (emailSuccess) emailSuccess.classList.add('see-it-hidden');
      if (emailInput) emailInput.value = '';
      
      // Set image and show result
      if (resultImage) resultImage.src = imageUrl;
      showScreen('result');
      
      // Prefetch collection products for swiper
      fetchCollectionProducts();
    }
  } catch (err) {
    console.error('[See It] Generate error:', err);
    showError('Generate failed: ' + err.message);
    showScreen('position'); // Go back on error
  }
};
```

### 6.8 Add event listeners:

```javascript
// Position hint - hide on first interaction
const hidePositionHint = () => {
  positionHint?.classList.add('see-it-hidden');
};

// Result screen navigation
btnBackResult?.addEventListener('click', () => {
  // Reset and go to entry
  state.sessionId = null;
  state.originalRoomImageUrl = null;
  state.cleanedRoomImageUrl = null;
  state.localImageDataUrl = null;
  state.uploadComplete = false;
  hasErased = false;
  strokes = [];
  showScreen('entry');
});

btnTryAgain?.addEventListener('click', () => {
  // Same as back - start fresh
  state.sessionId = null;
  state.originalRoomImageUrl = null;
  state.cleanedRoomImageUrl = null;
  state.localImageDataUrl = null;
  state.uploadComplete = false;
  hasErased = false;
  strokes = [];
  showScreen('entry');
});

btnTryAnother?.addEventListener('click', () => {
  if (state.collectionProducts.length > 0) {
    showSwiper();
  } else {
    showError('No other products available');
  }
});

// Email form
emailForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput?.value?.trim();
  if (!email) return;

  if (emailSubmit) {
    emailSubmit.disabled = true;
    emailSubmit.textContent = 'Sending...';
  }

  const success = await captureEmail(email);

  if (success) {
    if (emailFormWrap) emailFormWrap.classList.add('see-it-hidden');
    if (emailSuccess) emailSuccess.classList.remove('see-it-hidden');
  } else {
    if (emailSubmit) {
      emailSubmit.disabled = false;
      emailSubmit.textContent = 'Send';
    }
  }
});

// Swiper controls
swiperClose?.addEventListener('click', hideSwiper);
swiperPrev?.addEventListener('click', () => swipeCard('left'));
swiperNext?.addEventListener('click', () => swipeCard('right'));
swiperSkipLeft?.addEventListener('click', () => swipeCard('left'));
swiperSkipRight?.addEventListener('click', () => swipeCard('right'));
swiperSelect?.addEventListener('click', selectSwiperProduct);

// Share button
btnShare?.addEventListener('click', async () => {
  if (!state.lastResultUrl) return;

  try {
    if (navigator.share) {
      const response = await fetch(state.lastResultUrl);
      const blob = await response.blob();
      const file = new File([blob], 'see-it-room.jpg', { type: 'image/jpeg' });
      await navigator.share({ files: [file], title: state.productTitle || 'My room' });
    } else {
      // Fallback: download
      const a = document.createElement('a');
      a.href = state.lastResultUrl;
      a.download = 'see-it-room.jpg';
      a.click();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      // Fallback on error
      const a = document.createElement('a');
      a.href = state.lastResultUrl;
      a.download = 'see-it-room.jpg';
      a.click();
    }
  }
});

// Initialize swiper touch
setupSwiperTouch();
```

### 6.9 Update drag handlers to hide hint:

In `handleDragStart`:
```javascript
const handleDragStart = (e) => {
  // ... existing code ...
  hidePositionHint(); // Add this line
  // ... rest of code ...
};
```

In `handleResizeStart`:
```javascript
const handleResizeStart = (e) => {
  // ... existing code ...
  hidePositionHint(); // Add this line
  // ... rest of code ...
};
```

### 6.10 Update showScreen to include loading:

```javascript
const showScreen = (screenName) => {
  const screens = {
    entry: screenEntry,
    prepare: screenPrepare,
    position: screenPosition,
    loading: screenLoading,
    result: screenResult
  };
  // ... rest stays the same
};
```

---

## STEP 7: Code Cleanup

### Remove from liquid:
- `see-it-save-room-toggle` checkbox and its row
- `POSITION`, `RESULT` header labels
- Old result screen markup

### Remove from CSS:
- `.see-it-position-controls` (old class)
- `.see-it-save-room-row` (removed feature)
- `.see-it-result-success` (old style)

### Remove from JS:
- `saveRoomToggle` reference
- `btnSaved` reference (if exists)
- Old `btnNewRoom` logic (now handled by `btnTryAgain`)
- Excessive console.log debug statements (keep key ones)

---

## STEP 8: Testing Checklist

1. **Entry screen**: Product shows without price
2. **Prepare screen**: Brush slider works, Undo/Erase/Continue all function
3. **Position screen**: 
   - No header label
   - Drag moves product
   - Pinch (mobile) / corner drag (desktop) resizes
   - Hint disappears after first interaction
4. **Loading screen**: Spinner shows during generation
5. **Result screen**:
   - Image displays correctly
   - Share downloads/shares image
   - Try Again resets to Entry
   - Try Another Product shows swiper with collection products
6. **Email capture**:
   - Form submits
   - Success message shows
   - Check database for captured email
7. **Swiper**:
   - Products from same collection load
   - Swipe/arrows navigate
   - Select loads product into position screen

---

## Key Consistency Patterns

### API Response Format
All app-proxy endpoints return:
```javascript
// Success
{ success: true, ...data }

// Error
{ error: "message" }
```

### Canvas/Image Sizing
- Room images normalized to Gemini-compatible ratios
- Canvas positioned to match image render area (object-fit: contain)
- Mask generated at native resolution, not UI size
- All dimensions stored in state, never hardcoded

### State Management
- Single `state` object for all widget state
- Reset appropriately on screen transitions
- Persist session across screen changes within same flow

---

## Files Summary

**Modified:**
- `extensions/see-it-extension/blocks/see-it-button.liquid`
- `extensions/see-it-extension/assets/see-it-modal.js`  
- `extensions/see-it-extension/assets/see-it-modal.css`
- `prisma/schema.prisma`

**Created:**
- `app/routes/app-proxy.capture.ts`
- `app/routes/app-proxy.collection-products.ts`

**Commands:**
```bash
npx prisma db push
npm run build
```
