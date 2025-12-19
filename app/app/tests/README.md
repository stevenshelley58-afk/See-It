# Test Harness

This directory contains test utilities and integration tests for the See It app.

## Structure

- `flows/` - Flow harness helpers that call the same internal functions as the app
- `pipeline/` - Unit tests for the image processing pipeline
- `integration/` - Integration tests for API routes

## Usage

### Flow Harness

The flow harness allows you to test prepare flows with injectable failure scenarios:

```typescript
import { runPrepareFlowForProduct } from "./flows/prepareFlow.test";

// Test with valid product
const result = await runPrepareFlowForProduct({
    shopId: "test-shop-id",
    productId: "test-product-id",
    sourceImageUrl: "https://cdn.shopify.com/...",
});

// Test with simulated CDN failure
const result = await runPrepareFlowForProduct({
    shopId: "test-shop-id",
    productId: "test-product-id",
    sourceImageUrl: "https://cdn.shopify.com/...",
    simulate: { brokenCdn: true },
});
```

### Pipeline Tests

Test the image processing pipeline with fixtures:

1. Create test fixtures in `app/tests/fixtures/`:
   - `test-product.png`
   - `test-product.jpg`
   - `test-product.webp`

2. Run tests:
```typescript
import { runAllPipelineTests } from "./pipeline/imagePipeline.test";
const results = await runAllPipelineTests();
```

### Integration Tests

Test the prepare route with various scenarios:

```typescript
import { runAllPrepareRouteTests } from "./integration/prepareRoute.test";
const results = await runAllPrepareRouteTests(
    "test-shop-id",
    "test-product-id",
    "https://cdn.shopify.com/..."
);
```

## Running Tests

These tests are designed to run locally against a test database. They don't require external test frameworks, but you can integrate them with Jest/Vitest if desired.

To run manually:

```bash
cd app
node -r ts-node/register app/tests/pipeline/imagePipeline.test.ts
```

## Notes

- Tests use the same internal functions as the app, ensuring realistic behavior
- Failure scenarios are simulated via options, not by mocking external services
- All tests use the structured logger for consistent output
- Tests clean up after themselves (or should be run in a test database)





