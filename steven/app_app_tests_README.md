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
import { runAllPipelineTests } from "./pipeline/imagePipeline.harness";
const results = await runAllPipelineTests();
```

### Integration Tests

Test the prepare route with various scenarios:

```typescript
import { runAllPrepareRouteTests } from "./integration/prepareRoute.harness";
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
node -r ts-node/register app/tests/pipeline/imagePipeline.harness.ts
```

## Prompt Control Plane Tests

The `prompt-control/` directory contains acceptance tests for the Prompt Control Plane feature per PRD Section 10:

### Test Files

1. **prompt-version-manager.test.ts** - Version management tests
   - AC #1: Create draft, edit, activate workflow
   - AC #2: Shop isolation (multi-tenancy)
   - AC #4: Rollback functionality
   - AC #10: Audit log completeness
   - AC #12: Concurrent version creation (race safety)
   - AC #13: Concurrent activation (single ACTIVE)

2. **prompt-resolver.test.ts** - Resolution and runtime config tests
   - AC #3: System tenant fallback
   - AC #5: Resolved config snapshot
   - AC #7: Disabled prompts blocked
   - AC #8: Force fallback model
   - AC #9: Model allow list enforcement
   - AC #14: Request hash with sorted images
   - AC #15: Template dot-path rendering

3. **llm-call-tracker.test.ts** - LLM call instrumentation tests
   - AC #6: View run's LLM calls
   - AC #11: Test panel isolation from production
   - Tracked call wrapper (success/failure/timeout)
   - Stats aggregation

4. **integration.test.ts** - End-to-end workflow tests
   - Full lifecycle workflows
   - Multi-tenant isolation
   - Concurrent operation safety
   - Audit trail completeness

### Running Prompt Control Tests

```bash
# Run all prompt control tests
npm run test -- app/tests/prompt-control

# Run specific test file
npm run test -- app/tests/prompt-control/prompt-resolver.test.ts

# Run with verbose output
npm run test -- --reporter=verbose app/tests/prompt-control
```

### Key Functions Tested

- `createVersion()` - Race-safe version creation with Serializable isolation
- `activateVersion()` - Race-safe activation with single ACTIVE guarantee
- `resolvePrompt()` - Resolution order, fallback, runtime config enforcement
- `computeRequestHash()` - Sorted image refs for stable deduplication
- `renderTemplate()` - Dot-path variable substitution
- `trackedLLMCall()` - Call tracking with timeout detection

## Notes

- Tests use the same internal functions as the app, ensuring realistic behavior
- Failure scenarios are simulated via options, not by mocking external services
- All tests use the structured logger for consistent output
- Tests clean up after themselves (or should be run in a test database)
- Prompt control tests use mocked Prisma for unit testing; for full DB integration, use a test database






