# 10 — Test Plan

## Purpose
This document specifies the test matrix, fixtures, and test scenarios for See It Now.

---

## Test Categories

| Category | Framework | Location |
|----------|-----------|----------|
| Unit Tests | Vitest | `app/tests/unit/` |
| Integration Tests | Vitest | `app/tests/integration/` |
| E2E Tests | Playwright | `app/tests/e2e/` |

---

## Unit Tests

### Storage Service

```typescript
// tests/unit/storage.server.test.ts

describe("StorageService", () => {
  describe("getPresignedUploadUrl", () => {
    it("generates valid upload URL for room image", async () => {
      const result = await StorageService.getPresignedUploadUrl(
        "shop-123",
        "session-456",
        "room.jpg",
        "image/jpeg"
      );
      
      expect(result.uploadUrl).toMatch(/^https:\/\/storage\.googleapis\.com/);
      expect(result.key).toBe("rooms/shop-123/session-456/room.jpg");
    });

    it("handles different content types", async () => {
      const result = await StorageService.getPresignedUploadUrl(
        "shop-123",
        "session-456",
        "room.png",
        "image/png"
      );
      
      expect(result.key).toEndWith(".png");
    });
  });

  describe("fileExists", () => {
    it("returns true for existing file", async () => {
      // Setup: upload a test file
      const exists = await StorageService.fileExists("test-key");
      expect(exists).toBe(true);
    });

    it("returns false for non-existent file", async () => {
      const exists = await StorageService.fileExists("non-existent-key");
      expect(exists).toBe(false);
    });
  });
});
```

### Validation Utilities

```typescript
// tests/unit/validation.test.ts

describe("validateSessionId", () => {
  it("accepts valid UUID", () => {
    const result = validateSessionId("550e8400-e29b-41d4-a716-446655440000");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects non-string input", () => {
    const result = validateSessionId(12345);
    expect(result.valid).toBe(false);
  });

  it("rejects invalid format", () => {
    const result = validateSessionId("not-a-uuid");
    expect(result.valid).toBe(false);
  });
});

describe("validateContentType", () => {
  it("accepts image/jpeg", () => {
    const result = validateContentType("image/jpeg");
    expect(result.valid).toBe(true);
  });

  it("normalizes image/jpg to image/jpeg", () => {
    const result = validateContentType("image/jpg");
    expect(result.sanitized).toBe("image/jpeg");
  });

  it("rejects unsupported types", () => {
    const result = validateContentType("image/gif");
    expect(result.valid).toBe(false);
  });
});

describe("validateTrustedUrl", () => {
  it("allows GCS URLs", () => {
    expect(() => validateTrustedUrl(
      "https://storage.googleapis.com/bucket/key",
      "test"
    )).not.toThrow();
  });

  it("allows Shopify CDN URLs", () => {
    expect(() => validateTrustedUrl(
      "https://cdn.shopify.com/image.jpg",
      "test"
    )).not.toThrow();
  });

  it("rejects arbitrary URLs", () => {
    expect(() => validateTrustedUrl(
      "https://evil.com/image.jpg",
      "test"
    )).toThrow();
  });

  it("rejects non-HTTPS URLs", () => {
    expect(() => validateTrustedUrl(
      "http://storage.googleapis.com/bucket/key",
      "test"
    )).toThrow();
  });
});
```

### Rate Limiting

```typescript
// tests/unit/rate-limit.test.ts

describe("checkRateLimit", () => {
  beforeEach(() => {
    // Clear rate limit state
  });

  it("allows requests under limit", () => {
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit("session-1")).toBe(true);
    }
  });

  it("blocks requests over limit", () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit("session-1");
    }
    expect(checkRateLimit("session-1")).toBe(false);
  });

  it("resets after window expires", async () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit("session-1");
    }
    
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 61000));
    
    expect(checkRateLimit("session-1")).toBe(true);
  });
});
```

### Variant Library

```typescript
// tests/unit/variants.test.ts

describe("pickDefaultSelectedSeeItNowVariants", () => {
  it("returns 5 variants", () => {
    const variants = pickDefaultSelectedSeeItNowVariants();
    expect(variants).toHaveLength(5);
  });

  it("returns expected default IDs", () => {
    const variants = pickDefaultSelectedSeeItNowVariants();
    const ids = variants.map(v => v.id);
    
    expect(ids).toContain("safe-baseline");
    expect(ids).toContain("conservative-scale");
    expect(ids).toContain("confident-scale");
    expect(ids).toContain("integrated-placement");
    expect(ids).toContain("last-resort-realism");
  });
});

describe("normalizeSeeItNowVariants", () => {
  it("returns empty array for null input", () => {
    const result = normalizeSeeItNowVariants(null);
    expect(result).toEqual([]);
  });

  it("filters invalid entries", () => {
    const result = normalizeSeeItNowVariants([
      { id: "valid-id", prompt: "Valid prompt" },
      { id: "", prompt: "Empty ID" },
      { prompt: "Missing ID" },
    ]);
    
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("valid-id");
  });
});
```

---

## Integration Tests

### Room Upload Flow

```typescript
// tests/integration/room-upload.test.ts

describe("POST /apps/see-it/room/upload", () => {
  it("creates room session and returns upload URL", async () => {
    const response = await makeAppProxyRequest("/apps/see-it/room/upload", {
      method: "POST",
      body: { content_type: "image/jpeg" },
      shop: "test-shop.myshopify.com"
    });

    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.room_session_id).toBeDefined();
    expect(data.upload_url).toMatch(/^https:\/\/storage\.googleapis\.com/);
  });

  it("returns 403 without valid session", async () => {
    const response = await fetch("/apps/see-it/room/upload", {
      method: "POST",
      body: JSON.stringify({ content_type: "image/jpeg" })
    });

    expect(response.status).toBe(403);
  });
});
```

### Room Confirm Flow

```typescript
// tests/integration/room-confirm.test.ts

describe("POST /apps/see-it/room/confirm", () => {
  let roomSessionId: string;

  beforeEach(async () => {
    // Create a room session and upload an image
    const uploadResponse = await makeAppProxyRequest("/apps/see-it/room/upload", {
      method: "POST",
      body: { content_type: "image/jpeg" },
      shop: "test-shop.myshopify.com"
    });
    
    const uploadData = await uploadResponse.json();
    roomSessionId = uploadData.room_session_id;
    
    // Upload test image
    await fetch(uploadData.upload_url, {
      method: "PUT",
      body: TEST_IMAGE_BUFFER,
      headers: { "Content-Type": "image/jpeg" }
    });
  });

  it("confirms upload and returns canonical URL", async () => {
    const response = await makeAppProxyRequest("/apps/see-it/room/confirm", {
      method: "POST",
      body: { room_session_id: roomSessionId },
      shop: "test-shop.myshopify.com"
    });

    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.canonical_room_image_url).toBeDefined();
    expect(data.canonical_width).toBeGreaterThan(0);
    expect(data.canonical_height).toBeGreaterThan(0);
  });

  it("returns 400 if image not uploaded", async () => {
    // Create session without uploading
    const uploadResponse = await makeAppProxyRequest("/apps/see-it/room/upload", {
      method: "POST",
      body: { content_type: "image/jpeg" },
      shop: "test-shop.myshopify.com"
    });
    
    const uploadData = await uploadResponse.json();

    const response = await makeAppProxyRequest("/apps/see-it/room/confirm", {
      method: "POST",
      body: { room_session_id: uploadData.room_session_id },
      shop: "test-shop.myshopify.com"
    });

    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toBe("Room image not uploaded yet");
  });
});
```

### See It Now Render Flow

```typescript
// tests/integration/see-it-now-render.test.ts

describe("POST /apps/see-it/see-it-now/render", () => {
  let roomSessionId: string;

  beforeEach(async () => {
    // Setup: create room session, upload, confirm
    // ... setup code
  });

  it("generates variants for enabled product", async () => {
    const response = await makeAppProxyRequest("/apps/see-it/see-it-now/render", {
      method: "POST",
      body: {
        room_session_id: roomSessionId,
        product_id: ENABLED_PRODUCT_ID
      },
      shop: ALLOWED_SHOP
    });

    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.session_id).toMatch(/^see-it-now_/);
    expect(data.variants).toBeInstanceOf(Array);
    expect(data.variants.length).toBeGreaterThan(0);
    expect(data.variants[0].id).toBeDefined();
    expect(data.variants[0].image_url).toMatch(/^https:/);
  });

  it("returns 403 for non-allowed shop", async () => {
    const response = await makeAppProxyRequest("/apps/see-it/see-it-now/render", {
      method: "POST",
      body: {
        room_session_id: roomSessionId,
        product_id: "12345"
      },
      shop: "not-allowed-shop.myshopify.com"
    });

    expect(response.status).toBe(403);
    
    const data = await response.json();
    expect(data.error).toBe("see_it_now_not_enabled");
  });

  it("returns 422 for non-live product", async () => {
    const response = await makeAppProxyRequest("/apps/see-it/see-it-now/render", {
      method: "POST",
      body: {
        room_session_id: roomSessionId,
        product_id: DISABLED_PRODUCT_ID
      },
      shop: ALLOWED_SHOP
    });

    expect(response.status).toBe(422);
    
    const data = await response.json();
    expect(data.error).toBe("product_not_enabled");
  });
});
```

---

## E2E Tests

### Storefront Flow (Mobile)

```typescript
// tests/e2e/storefront-mobile.test.ts

test.describe("See It Now - Mobile Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(TEST_PRODUCT_URL);
  });

  test("complete flow: button > entry > camera > thinking > result", async ({ page }) => {
    // Click trigger
    await page.click("#see-it-now-trigger");
    
    // Entry screen visible
    await expect(page.locator("#see-it-now-screen-entry")).toHaveClass(/active/);
    
    // Click camera button (intercept file input)
    await page.setInputFiles("#see-it-now-camera-input", TEST_ROOM_IMAGE);
    
    // Thinking screen shows
    await expect(page.locator("#see-it-now-screen-thinking")).toHaveClass(/active/);
    
    // Wait for results (timeout 60s)
    await expect(page.locator("#see-it-now-screen-result")).toHaveClass(/active/, { timeout: 60000 });
    
    // Verify carousel
    const slides = page.locator(".see-it-now-slide");
    await expect(slides).toHaveCount({ minimum: 1 });
    
    // Verify dots match slides
    const dots = page.locator(".see-it-now-dot");
    const slideCount = await slides.count();
    await expect(dots).toHaveCount(slideCount);
  });

  test("swipe navigation works", async ({ page }) => {
    // Setup: get to results
    await page.click("#see-it-now-trigger");
    await page.setInputFiles("#see-it-now-camera-input", TEST_ROOM_IMAGE);
    await expect(page.locator("#see-it-now-screen-result")).toHaveClass(/active/, { timeout: 60000 });
    
    // First dot should be active
    await expect(page.locator(".see-it-now-dot").first()).toHaveClass(/active/);
    
    // Swipe left
    const container = page.locator("#see-it-now-swipe-container");
    await container.evaluate((el) => {
      el.dispatchEvent(new TouchEvent("touchstart", {
        touches: [{ clientX: 300, clientY: 200 }]
      }));
      el.dispatchEvent(new TouchEvent("touchmove", {
        touches: [{ clientX: 100, clientY: 200 }]
      }));
      el.dispatchEvent(new TouchEvent("touchend", {}));
    });
    
    // Second dot should be active
    await expect(page.locator(".see-it-now-dot").nth(1)).toHaveClass(/active/);
  });

  test("close button works", async ({ page }) => {
    await page.click("#see-it-now-trigger");
    await expect(page.locator("#see-it-now-modal")).not.toHaveClass(/hidden/);
    
    await page.click("#see-it-now-close-entry");
    await expect(page.locator("#see-it-now-modal")).toHaveClass(/hidden/);
  });
});
```

### Storefront Flow (Desktop)

```typescript
// tests/e2e/storefront-desktop.test.ts

test.describe("See It Now - Desktop Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(TEST_PRODUCT_URL);
  });

  test("complete flow: button > file picker > thinking > result", async ({ page }) => {
    // Setup file chooser listener before clicking
    const fileChooserPromise = page.waitForEvent("filechooser");
    
    // Click trigger (opens file picker immediately on desktop)
    await page.click("#see-it-now-trigger");
    
    // Handle file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(TEST_ROOM_IMAGE);
    
    // Should skip entry screen, go to thinking
    await expect(page.locator("#see-it-now-screen-thinking")).toHaveClass(/active/);
    
    // Wait for results
    await expect(page.locator("#see-it-now-screen-result")).toHaveClass(/active/, { timeout: 60000 });
  });

  test("keyboard navigation works", async ({ page }) => {
    // Setup: get to results
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.click("#see-it-now-trigger");
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(TEST_ROOM_IMAGE);
    await expect(page.locator("#see-it-now-screen-result")).toHaveClass(/active/, { timeout: 60000 });
    
    // Press right arrow
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".see-it-now-dot").nth(1)).toHaveClass(/active/);
    
    // Press left arrow
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".see-it-now-dot").first()).toHaveClass(/active/);
  });
});
```

### Error Handling

```typescript
// tests/e2e/error-handling.test.ts

test.describe("See It Now - Error Handling", () => {
  test("shows error screen on generation failure", async ({ page }) => {
    // Mock API to return error
    await page.route("**/apps/see-it/see-it-now/render", (route) => {
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "generation_failed",
          message: "Test error message"
        })
      });
    });

    await page.goto(TEST_PRODUCT_URL);
    await page.click("#see-it-now-trigger");
    await page.setInputFiles("#see-it-now-upload-input", TEST_ROOM_IMAGE);
    
    // Error screen should show
    await expect(page.locator("#see-it-now-screen-error")).toHaveClass(/active/);
    await expect(page.locator("#see-it-now-error-message")).toContainText("Test error message");
  });

  test("retry button works from error screen", async ({ page }) => {
    // First request fails, second succeeds
    let callCount = 0;
    await page.route("**/apps/see-it/see-it-now/render", (route) => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: "generation_failed", message: "Error" })
        });
      } else {
        route.continue();
      }
    });

    await page.goto(TEST_PRODUCT_URL);
    await page.click("#see-it-now-trigger");
    await page.setInputFiles("#see-it-now-upload-input", TEST_ROOM_IMAGE);
    
    // Error screen shows
    await expect(page.locator("#see-it-now-screen-error")).toHaveClass(/active/);
    
    // Click retry
    await page.click("#see-it-now-error-retry");
    
    // Should go back to entry/file picker
    // ... continue test
  });
});
```

---

## Test Fixtures

### Test Images

Store in `tests/fixtures/`:

```
tests/fixtures/
├── room-landscape.jpg     # 1920x1080 room photo
├── room-portrait.jpg      # 1080x1920 room photo
├── room-square.jpg        # 1080x1080 room photo
├── room-4k.jpg            # 3840x2160 (test resize)
├── room-small.jpg         # 640x480 (test small images)
├── product-cutout.png     # Product with transparency
└── invalid-file.txt       # For error testing
```

### Mock Responses

```typescript
// tests/fixtures/mock-responses.ts

export const MOCK_UPLOAD_RESPONSE = {
  room_session_id: "test-session-123",
  upload_url: "https://storage.googleapis.com/test-bucket/test-key?signature=xxx",
  content_type: "image/jpeg"
};

export const MOCK_CONFIRM_RESPONSE = {
  ok: true,
  canonical_room_image_url: "https://storage.googleapis.com/test-bucket/canonical.jpg",
  canonical_width: 1920,
  canonical_height: 1080,
  ratio_label: "16:9"
};

export const MOCK_RENDER_RESPONSE = {
  session_id: "see-it-now_test-session-123_1705315800000",
  variants: [
    { id: "safe-baseline", image_url: "https://storage.googleapis.com/variant1.jpg", direction: "..." },
    { id: "conservative-scale", image_url: "https://storage.googleapis.com/variant2.jpg", direction: "..." },
  ],
  duration_ms: 12500,
  version: "see-it-now"
};
```

---

## Running Tests

```bash
# Unit tests
npm run test:unit

# Integration tests (requires test database)
npm run test:integration

# E2E tests (requires running app)
npm run test:e2e

# All tests
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

---

## CI Configuration

```yaml
# .github/workflows/test.yml

name: Tests

on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run test:unit

  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/test
      - run: npm run test:integration

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install
      - run: npm run test:e2e
```
