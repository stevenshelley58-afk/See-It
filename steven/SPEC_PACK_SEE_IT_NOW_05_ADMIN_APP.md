# 05 — Admin App

## Purpose
This document specifies the Shopify embedded admin app for merchants to configure See It Now.

---

## App Structure

The admin app is a Remix application embedded in Shopify Admin using Polaris.

### Route Structure

```
app/routes/
├── app.jsx                     # Root layout with AppProvider
├── app._index.jsx              # Dashboard / home
├── app.products.jsx            # Product list and management
├── app.settings.jsx            # Shop-level settings
├── api.products.jsx            # Internal API: list products
├── api.products.prepare.jsx    # Internal API: prepare product
├── api.settings.jsx            # Internal API: get/save settings
└── auth.login/
    └── route.jsx               # OAuth flow
```

---

## Navigation

Polaris `Navigation` sidebar:

```jsx
<Navigation location={location.pathname}>
  <Navigation.Section
    items={[
      {
        url: "/app",
        label: "Dashboard",
        icon: HomeIcon,
        selected: location.pathname === "/app"
      },
      {
        url: "/app/products",
        label: "Products",
        icon: ProductIcon,
        selected: location.pathname.startsWith("/app/products")
      },
      {
        url: "/app/settings",
        label: "Settings",
        icon: SettingsIcon,
        selected: location.pathname === "/app/settings"
      }
    ]}
  />
</Navigation>
```

---

## Dashboard Page (`/app`)

### Layout

```jsx
<Page title="See It Now">
  <Layout>
    <Layout.Section>
      <Card>
        <Text variant="headingMd">Quick Stats</Text>
        <Text>Products enabled: {enabledCount}</Text>
        <Text>Renders this month: {monthlyRenders}</Text>
      </Card>
    </Layout.Section>
    
    <Layout.Section>
      <Card>
        <Text variant="headingMd">Getting Started</Text>
        <List>
          <List.Item>1. Prepare product images (remove backgrounds)</List.Item>
          <List.Item>2. Enable products for See It Now</List.Item>
          <List.Item>3. Add the See It Now block to your theme</List.Item>
        </List>
      </Card>
    </Layout.Section>
  </Layout>
</Page>
```

### Data Requirements

```typescript
interface DashboardData {
  enabledProductCount: number;
  totalProductCount: number;
  monthlyRenderCount: number;
  monthlyQuota: number;
  plan: string;
}
```

---

## Products Page (`/app/products`)

### Layout

```jsx
<Page
  title="Products"
  primaryAction={{
    content: "Refresh",
    onAction: handleRefresh
  }}
>
  <Card>
    <ResourceList
      resourceName={{ singular: "product", plural: "products" }}
      items={products}
      renderItem={renderProductItem}
      filterControl={
        <Filters
          filters={[
            {
              key: "status",
              label: "Status",
              filter: (
                <ChoiceList
                  choices={[
                    { label: "All", value: "all" },
                    { label: "Live", value: "live" },
                    { label: "Ready", value: "ready" },
                    { label: "Unprepared", value: "unprepared" }
                  ]}
                  selected={statusFilter}
                  onChange={setStatusFilter}
                />
              )
            }
          ]}
        />
      }
    />
  </Card>
</Page>
```

### Product List Item

```jsx
function renderProductItem(item) {
  const { id, productTitle, status, preparedImageUrl, sourceImageUrl } = item;
  
  const statusBadge = {
    live: <Badge tone="success">Live</Badge>,
    ready: <Badge tone="info">Ready</Badge>,
    preparing: <Badge tone="attention">Preparing</Badge>,
    unprepared: <Badge>Unprepared</Badge>,
    failed: <Badge tone="critical">Failed</Badge>
  }[status];

  return (
    <ResourceItem
      id={id}
      media={
        <Thumbnail
          source={preparedImageUrl || sourceImageUrl}
          alt={productTitle}
        />
      }
      accessibilityLabel={productTitle}
    >
      <InlineStack gap="200" align="space-between">
        <Text variant="bodyMd" fontWeight="bold">{productTitle}</Text>
        {statusBadge}
      </InlineStack>
      
      <InlineStack gap="200">
        {status === "unprepared" && (
          <Button size="slim" onClick={() => handlePrepare(id)}>
            Prepare
          </Button>
        )}
        {status === "ready" && (
          <Button size="slim" onClick={() => handleEnable(id)}>
            Enable
          </Button>
        )}
        {status === "live" && (
          <Button size="slim" onClick={() => handleDisable(id)}>
            Disable
          </Button>
        )}
        <Button size="slim" variant="plain" onClick={() => handleEdit(id)}>
          Edit
        </Button>
      </InlineStack>
    </ResourceItem>
  );
}
```

### Product Status Flow

```
unprepared → (prepare) → preparing → ready → (enable) → live
                              ↓
                           failed
```

---

## Product Edit Modal

When clicking "Edit" on a product:

```jsx
<Modal
  open={editModalOpen}
  onClose={() => setEditModalOpen(false)}
  title={`Edit: ${product.productTitle}`}
  primaryAction={{
    content: "Save",
    onAction: handleSave
  }}
  secondaryActions={[
    { content: "Cancel", onAction: () => setEditModalOpen(false) }
  ]}
>
  <Modal.Section>
    <FormLayout>
      <Thumbnail
        source={product.preparedImageUrl}
        size="large"
        alt="Prepared cutout"
      />
      
      <TextField
        label="See It Now Instructions"
        value={renderInstructionsSeeItNow}
        onChange={setRenderInstructionsSeeItNow}
        multiline={4}
        helpText="Custom placement instructions for this product"
      />
      
      <Text variant="headingMd">Selected Variants</Text>
      <ChoiceList
        allowMultiple
        choices={VARIANT_LIBRARY.map(v => ({
          label: v.id,
          value: v.id,
          helpText: v.prompt.substring(0, 80) + "..."
        }))}
        selected={selectedVariants}
        onChange={setSelectedVariants}
      />
    </FormLayout>
  </Modal.Section>
</Modal>
```

### Product Edit Data

```typescript
interface ProductEditData {
  id: string;
  productTitle: string;
  preparedImageUrl: string | null;
  renderInstructionsSeeItNow: string | null;
  seeItNowVariants: Array<{ id: string; prompt: string }> | null;
}
```

---

## Settings Page (`/app/settings`)

### Layout

```jsx
<Page title="Settings">
  <Layout>
    <Layout.AnnotatedSection
      title="See It Now Prompt"
      description="Default prompt used for all See It Now generations"
    >
      <Card>
        <FormLayout>
          <TextField
            label="Global See It Now Prompt"
            value={seeItNowPrompt}
            onChange={setSeeItNowPrompt}
            multiline={6}
            helpText="This prompt is prepended to all generation requests"
          />
          <Button onClick={handleSaveSettings} loading={saving}>
            Save
          </Button>
        </FormLayout>
      </Card>
    </Layout.AnnotatedSection>
    
    <Layout.AnnotatedSection
      title="Theme Setup"
      description="Add the See It Now block to your product pages"
    >
      <Card>
        <Text>
          1. Go to Online Store → Themes → Customize
        </Text>
        <Text>
          2. Navigate to a product page template
        </Text>
        <Text>
          3. Add the "See It Now" block from the app section
        </Text>
        <Text>
          4. Configure button style and required tag
        </Text>
      </Card>
    </Layout.AnnotatedSection>
  </Layout>
</Page>
```

### Settings Data

```typescript
interface ShopSettings {
  seeItNowPrompt: string;
  seeItNowVariants?: Array<{ id: string; prompt: string }>;
}
```

Settings are stored in `Shop.settingsJson` as JSON:

```json
{
  "seeItNowPrompt": "Create a professional lifestyle photograph..."
}
```

---

## Internal API Routes

### GET /api/products

```typescript
// Request
GET /api/products?status=all&page=1&limit=20

// Response
{
  "products": [
    {
      "id": "asset-uuid",
      "productId": "shopify-product-id",
      "productTitle": "Oak Dining Table",
      "status": "live",
      "sourceImageUrl": "https://cdn.shopify.com/...",
      "preparedImageUrl": "https://storage.googleapis.com/...",
      "renderInstructionsSeeItNow": "...",
      "seeItNowVariants": [...]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "hasMore": true
  }
}
```

### POST /api/products/prepare

```typescript
// Request
POST /api/products/prepare
{
  "productId": "shopify-product-id"
}

// Response
{
  "success": true,
  "assetId": "asset-uuid",
  "status": "preparing"
}
```

### POST /api/settings

```typescript
// Request
POST /api/settings
{
  "seeItNowPrompt": "..."
}

// Response
{
  "success": true
}
```

### GET /api/settings

```typescript
// Response
{
  "seeItNowPrompt": "...",
  "plan": "free",
  "monthlyQuota": 100,
  "monthlyUsage": 45
}
```

---

## Authentication

All admin routes use Shopify session authentication:

```typescript
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  // session.shop is the authenticated shop domain
  // admin is the GraphQL client for Shopify Admin API
};
```

---

## Shopify Admin GraphQL Queries

### Fetch Products

```graphql
query GetProducts($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        title
        handle
        featuredImage {
          url
        }
        tags
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### Fetch Single Product

```graphql
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    featuredImage {
      url
    }
    images(first: 10) {
      edges {
        node {
          url
        }
      }
    }
    tags
  }
}
```

---

## Polaris Components Used

- `Page` - Page wrapper with title and actions
- `Layout` - Page sections
- `Card` - Content containers
- `ResourceList` - Product list
- `ResourceItem` - Individual product row
- `Thumbnail` - Product images
- `Badge` - Status indicators
- `Button` - Actions
- `TextField` - Text inputs
- `ChoiceList` - Multi-select
- `FormLayout` - Form structure
- `Modal` - Edit dialogs
- `Toast` - Success/error messages
- `Banner` - Info/warning banners
- `InlineStack` - Horizontal layout
- `Text` - Typography

---

## Error Handling

Use Polaris `Toast` for feedback:

```jsx
const [toastActive, setToastActive] = useState(false);
const [toastContent, setToastContent] = useState("");
const [toastError, setToastError] = useState(false);

function showToast(message, isError = false) {
  setToastContent(message);
  setToastError(isError);
  setToastActive(true);
}

// In render
{toastActive && (
  <Toast
    content={toastContent}
    error={toastError}
    onDismiss={() => setToastActive(false)}
  />
)}
```

---

## Loading States

Use Polaris `Spinner` and `SkeletonBodyText`:

```jsx
if (loading) {
  return (
    <Page title="Products">
      <Card>
        <SkeletonBodyText lines={5} />
      </Card>
    </Page>
  );
}
```

For buttons:

```jsx
<Button loading={preparing} onClick={handlePrepare}>
  Prepare
</Button>
```
