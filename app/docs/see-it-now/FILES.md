# See It Now - Complete File Specifications

**Status:** Spec only - no code written  
**Location:** `extensions/see-it-extension/`

---

## File 1: see-it-now.liquid

**Path:** `extensions/see-it-extension/blocks/see-it-now.liquid`

### Schema

```json
{
  "name": "See It Now",
  "target": "section",
  "stylesheet": "see-it-now.css",
  "javascript": "see-it-now.js",
  "templates": ["product"],
  "settings": [
    {
      "type": "text",
      "id": "button_label",
      "label": "Button Label",
      "default": "See It Now"
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
```

### Template Variables (from Shopify)

```liquid
{% assign product_image_url = product.featured_image | image_url: width: 800 %}
{% assign product_image_width = product.featured_image.width | default: 800 %}
{% assign product_image_height = product.featured_image.height | default: 800 %}
{% assign product_title = product.title | default: "Product" %}
{% assign product_price = product.price | money %}
{% assign product_id = product.id %}
{% assign product_handle = product.handle %}
{% assign product_collection = product.collections.first.handle | default: '' %}
{% assign shop_domain = shop.domain %}
{% assign shop_permanent_domain = shop.permanent_domain %}
```

### HTML Structure

```
.see-it-now-widget-hook
├── .see-it-now-widget-content
│   ├── .see-it-now-widget-title      → "See It In Your Space"
│   └── .see-it-now-widget-description → "Instant AI visualization"
└── button#see-it-now-trigger
    ├── svg (camera icon mobile / upload icon desktop - handled in JS)
    └── {{ button_label }}

#see-it-now-modal.see-it-now-modal.hidden
└── .see-it-now-modal-content
    ├── #see-it-now-global-error.see-it-now-hidden
    │
    ├── #see-it-now-screen-thinking.see-it-now-screen
    │   ├── .see-it-now-header
    │   │   └── button.see-it-now-btn-icon (close, disabled during generation)
    │   └── .see-it-now-thinking-content
    │       ├── .see-it-now-thinking-product
    │       │   └── img (product thumbnail)
    │       ├── h2.see-it-now-thinking-title → "Creating your visualization..."
    │       ├── p.see-it-now-thinking-subtitle → "AI is placing the product in your room"
    │       ├── .see-it-now-thinking-spinner (simple CSS spinner)
    │       └── p#see-it-now-thinking-tip → rotating tips
    │
    ├── #see-it-now-screen-result.see-it-now-screen
    │   ├── .see-it-now-header
    │   │   ├── button#see-it-now-back-result (back arrow)
    │   │   ├── .see-it-now-header-spacer
    │   │   └── button#see-it-now-close-result (X)
    │   ├── .see-it-now-swipe-container#see-it-now-swipe-container
    │   │   ├── .see-it-now-swipe-track#see-it-now-swipe-track
    │   │   │   ├── .see-it-now-slide (× 5, generated in JS)
    │   │   │   │   └── img
    │   │   ├── .see-it-now-dots#see-it-now-dots
    │   │   │   └── button.see-it-now-dot (× 5)
    │   │   ├── .see-it-now-nav-left (tap zone, invisible)
    │   │   └── .see-it-now-nav-right (tap zone, invisible)
    │   ├── .see-it-now-result-actions
    │   │   ├── button#see-it-now-share.see-it-now-btn-primary-pill → "Share"
    │   │   └── .see-it-now-result-secondary
    │   │       ├── button#see-it-now-try-again → "Try Again"
    │   │       └── button#see-it-now-try-another → "Try Another Product"
    │   └── .see-it-now-version-badge → "See It Now"
    │
    ├── #see-it-now-screen-error.see-it-now-screen
    │   ├── .see-it-now-header
    │   │   └── button#see-it-now-close-error (X)
    │   └── .see-it-now-error-content
    │       ├── svg (warning icon)
    │       ├── h2 → "Something went wrong"
    │       ├── p → "We couldn't create your visualization"
    │       ├── button#see-it-now-error-retry.see-it-now-btn-primary-pill → "Try Again"
    │       └── button#see-it-now-error-close.see-it-now-btn-outline-pill → "Close"
    │
    └── (Hidden inputs)
        ├── input#see-it-now-camera-input[type=file][accept=image/*][capture=environment]
        └── input#see-it-now-upload-input[type=file][accept=image/*]
```

### Data Attributes on Trigger Button

```html
data-product-id="{{ product.id }}"
data-product-handle="{{ product.handle }}"
data-product-image="{{ product_image_url }}"
data-product-title="{{ product_title | escape }}"
data-product-price="{{ product_price | escape }}"
data-product-collection="{{ product_collection }}"
data-shop-domain="{{ shop.domain }}"
data-shop-permanent-domain="{{ shop.permanent_domain }}"
```

---

## File 2: see-it-now.js

**Path:** `extensions/see-it-extension/assets/see-it-now.js`

### Module Structure

```javascript
/**
 * See It Now - Instant AR Visualization
 * Version: 1.0.0
 *
 * Flow: Button → Camera/Upload → Thinking → Swipe Results
 */

document.addEventListener('DOMContentLoaded', function() {
  // ============================================================
  // CONSTANTS
  // ============================================================
  
  const VERSION = '1.0.0';
  
  const TIPS = [
    'Tip: Good lighting makes the best visualizations',
    'Tip: Clear floor space helps with placement',
    'AI is analyzing your room layout...',
    'Finding the perfect spots for your furniture...',
    'Almost there...',
  ];
  
  const SWIPE_THRESHOLD = 0.3;  // 30% of container width to commit swipe
  const SWIPE_VELOCITY = 0.5;   // Velocity threshold for quick flicks
  
  const GEMINI_SUPPORTED_RATIOS = [
    { label: '1:1', value: 1.0 },
    { label: '4:5', value: 0.8 },
    { label: '5:4', value: 1.25 },
    { label: '3:4', value: 0.75 },
    { label: '4:3', value: 4 / 3 },
    { label: '2:3', value: 2 / 3 },
    { label: '3:2', value: 1.5 },
    { label: '9:16', value: 9 / 16 },
    { label: '16:9', value: 16 / 9 },
  ];

  // ============================================================
  // STATE
  // ============================================================
  
  let state = {
    // Session
    sessionId: null,
    roomSessionId: null,
    
    // Images
    images: [],           // Array of 5 image URLs
    currentIndex: 0,      // 0-4
    
    // Product info (from trigger button data attributes)
    productId: '',
    productTitle: '',
    productImageUrl: '',
    
    // UI state
    isGenerating: false,
    
    // Swipe tracking
    swipeStartX: 0,
    swipeCurrentX: 0,
    swiping: false,
  };

  // ============================================================
  // DOM REFERENCES
  // ============================================================
  
  // Populated in init()
  let elements = {
    trigger: null,
    modal: null,
    cameraInput: null,
    uploadInput: null,
    
    // Screens
    screenThinking: null,
    screenResult: null,
    screenError: null,
    
    // Thinking screen
    thinkingProductImg: null,
    thinkingTip: null,
    
    // Result screen
    swipeContainer: null,
    swipeTrack: null,
    dots: null,
    shareBtn: null,
    tryAgainBtn: null,
    tryAnotherBtn: null,
    
    // Error screen
    errorRetryBtn: null,
    errorCloseBtn: null,
    
    // Close buttons
    closeResultBtn: null,
    closeErrorBtn: null,
    backResultBtn: null,
  };

  // ============================================================
  // PLATFORM DETECTION
  // ============================================================
  
  function isMobile() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
  }

  // ============================================================
  // IMAGE NORMALIZATION (Gemini-compatible aspect ratios)
  // ============================================================
  
  function findClosestGeminiRatio(width, height) {
    // Returns closest supported aspect ratio
  }
  
  async function normalizeRoomImage(file, maxDimension = 2048) {
    // 1. Load image
    // 2. Find closest Gemini ratio
    // 3. Crop to ratio (center crop)
    // 4. Resize to maxDimension
    // 5. Return { blob, width, height, ratio }
  }

  // ============================================================
  // API CALLS
  // ============================================================
  
  async function startSession(contentType = 'image/jpeg') {
    // POST /apps/see-it/room/upload
    // Returns { sessionId, uploadUrl }
  }
  
  async function uploadImage(file, signedUrl) {
    // PUT to signed URL
  }
  
  async function confirmRoom(sessionId) {
    // POST /apps/see-it/room/confirm
    // Returns { roomImageUrl }
  }
  
  async function generateImages(roomSessionId, productId) {
    // POST /apps/see-it/see-it-now/render
    // Returns { session_id, variants: [{ id, image_url }, ...] }
  }

  // ============================================================
  // SCREEN NAVIGATION
  // ============================================================
  
  function showScreen(screenName) {
    // 'thinking' | 'result' | 'error'
    // Hide all screens, show target with animation
  }
  
  function showError(message) {
    // Update error message text
    // Show error screen
  }

  // ============================================================
  // MODAL MANAGEMENT
  // ============================================================
  
  function openModal() {
    // Append modal to body if needed
    // Lock scroll
    // Show modal
  }
  
  function closeModal() {
    // Hide modal
    // Unlock scroll
    // Reset state
  }

  // ============================================================
  // TIP ROTATION
  // ============================================================
  
  let tipInterval = null;
  let tipIndex = 0;
  
  function startTipRotation() {
    // Cycle through TIPS every 3 seconds
  }
  
  function stopTipRotation() {
    // Clear interval
  }

  // ============================================================
  // SWIPE CAROUSEL
  // ============================================================
  
  function initSwipeCarousel() {
    // Add touch event listeners
    // Add mouse event listeners (desktop drag)
    // Add keyboard listeners (arrow keys)
    // Add tap zone listeners (left/right edges)
    // Add dot click listeners
  }
  
  function handleSwipeStart(clientX) {
    state.swipeStartX = clientX;
    state.swipeCurrentX = clientX;
    state.swiping = true;
    // Remove transition during drag
  }
  
  function handleSwipeMove(clientX) {
    if (!state.swiping) return;
    state.swipeCurrentX = clientX;
    // Calculate delta
    // Apply transform to track (with resistance at edges)
  }
  
  function handleSwipeEnd() {
    if (!state.swiping) return;
    state.swiping = false;
    
    // Calculate final delta and velocity
    // If past threshold OR high velocity → commit to next/prev
    // Else → snap back
    
    // Re-add transition
    // Navigate or snap
  }
  
  function navigateTo(index) {
    // Clamp index to 0-4
    // Update state.currentIndex
    // Animate track to position
    // Update dots
  }
  
  function updateDots() {
    // Set active class on current dot
  }

  // ============================================================
  // MAIN FLOW
  // ============================================================
  
  async function handleTriggerClick() {
    // 1. Read product data from trigger button
    // 2. Open modal (optional: show brief loading state)
    // 3. Trigger camera (mobile) or file picker (desktop)
  }
  
  async function handleFileSelected(file) {
    // 1. Show thinking screen
    // 2. Start tip rotation
    // 3. Normalize image
    // 4. Upload to GCS
    // 5. Confirm room
    // 6. Generate 5 images
    // 7. Stop tip rotation
    // 8. Populate swipe carousel
    // 9. Show result screen
    
    // On any error → showError()
  }
  
  function handleShare() {
    const currentImageUrl = state.images[state.currentIndex];
    
    // If Web Share API available (mobile)
    //   → Fetch image as blob
    //   → Share as file
    // Else (desktop)
    //   → Download image
  }
  
  function handleTryAgain() {
    // Reset state
    // Go back to camera/file picker
  }
  
  function handleTryAnother() {
    // Close modal
    // User can select different product
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================
  
  function init() {
    // Find all DOM elements
    // Verify required elements exist
    // Attach event listeners
    // Handle multiple trigger buttons (some themes duplicate)
    
    // Listen for Shopify theme editor section reloads
  }
  
  // Run init
  if (!init()) {
    // Retry with interval (some themes load late)
  }
});
```

### Event Listeners Summary

| Element | Event | Handler |
|---------|-------|---------|
| `trigger` (all instances) | click | `handleTriggerClick` |
| `cameraInput` | change | `handleFileSelected` |
| `uploadInput` | change | `handleFileSelected` |
| `swipeContainer` | touchstart | `handleSwipeStart` |
| `swipeContainer` | touchmove | `handleSwipeMove` |
| `swipeContainer` | touchend | `handleSwipeEnd` |
| `swipeContainer` | mousedown | `handleSwipeStart` |
| `window` | mousemove | `handleSwipeMove` (if swiping) |
| `window` | mouseup | `handleSwipeEnd` |
| `document` | keydown (←/→) | `navigateTo` |
| `.see-it-now-nav-left` | click | `navigateTo(current - 1)` |
| `.see-it-now-nav-right` | click | `navigateTo(current + 1)` |
| `.see-it-now-dot` | click | `navigateTo(dotIndex)` |
| `shareBtn` | click | `handleShare` |
| `tryAgainBtn` | click | `handleTryAgain` |
| `tryAnotherBtn` | click | `handleTryAnother` |
| `closeResultBtn` | click | `closeModal` |
| `closeErrorBtn` | click | `closeModal` |
| `backResultBtn` | click | `handleTryAgain` |
| `errorRetryBtn` | click | `handleTryAgain` |

---

## File 3: see-it-now.css

**Path:** `extensions/see-it-extension/assets/see-it-now.css`

### Design Tokens (CSS Variables)

```css
.see-it-now-widget-hook,
.see-it-now-modal {
  /* Typography */
  --si-font: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --si-title-size-mobile: 24px;
  --si-title-size-desktop: 32px;
  --si-body-size: 15px;
  
  /* Colors */
  --si-bg: #FAFAFA;
  --si-surface: #FFFFFF;
  --si-text: #171717;
  --si-muted: #737373;
  --si-muted-2: #A3A3A3;
  --si-border: #E5E5E5;
  --si-border-soft: #F5F5F5;
  --si-cta: #171717;
  --si-cta-hover: #000000;
  --si-danger: #EF4444;
  
  /* Radii */
  --si-radius-card: 16px;
  --si-radius-pill: 9999px;
  
  /* Shadows */
  --si-shadow-card: 0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02);
  --si-shadow-float: 0 8px 24px rgba(0,0,0,0.08);
  
  /* Motion */
  --si-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --si-duration-fast: 150ms;
  --si-duration-base: 250ms;
  
  /* Sizing */
  --si-hit: 44px;
  --si-cta-min-h: 48px;
}
```

### Component Styles

#### 1. Widget (PDP Button)

```css
.see-it-now-widget-hook {
  /* White card with subtle shadow */
  /* Contains title, description, button */
}

.see-it-now-widget-title {
  /* 15px, semibold, dark */
}

.see-it-now-widget-description {
  /* 14px, regular, muted */
}

#see-it-now-trigger {
  /* Full width pill button */
  /* Icon + label */
}
```

#### 2. Modal Container

```css
.see-it-now-modal {
  /* Fixed fullscreen overlay */
  /* Blur backdrop */
  /* z-index: 2147483647 (max) */
}

.see-it-now-modal.hidden {
  display: none;
}

.see-it-now-modal-content {
  /* Full height on mobile */
  /* Centered card on desktop (max 1000px × 700px) */
  /* Border radius on desktop */
}
```

#### 3. Screen System

```css
.see-it-now-screen {
  /* Absolute positioned */
  /* Opacity + transform transition */
  /* pointer-events: none when inactive */
}

.see-it-now-screen.active {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}
```

#### 4. Header

```css
.see-it-now-header {
  /* Flex row */
  /* Close/back buttons on edges */
  /* 16px padding */
  /* Bottom border */
}

.see-it-now-btn-icon {
  /* 44px tap target */
  /* Transparent bg, hover state */
}
```

#### 5. Thinking Screen

```css
.see-it-now-thinking-content {
  /* Centered vertically */
  /* Max 480px width */
}

.see-it-now-thinking-product {
  /* 80×80px */
  /* Rounded corners */
  /* Shadow */
  /* Margin bottom 24px */
}

.see-it-now-thinking-title {
  /* 20px, semibold */
  /* Animated dots via ::after */
}

.see-it-now-thinking-subtitle {
  /* 14px, muted */
  /* Margin bottom 32px */
}

.see-it-now-thinking-spinner {
  /* CSS spinner animation */
  /* 40px diameter */
  /* 2px border */
}

.see-it-now-thinking-tip {
  /* 13px, italic, muted */
  /* Fade transition on text change */
}

/* Animated dots */
.see-it-now-loading-dots::after {
  content: '';
  animation: see-it-now-dots 1.5s infinite;
}

@keyframes see-it-now-dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}

/* Spinner animation */
@keyframes see-it-now-spin {
  to { transform: rotate(360deg); }
}
```

#### 6. Result Screen (Swipe Carousel)

```css
.see-it-now-swipe-container {
  /* flex: 1 (fill available height) */
  /* overflow: hidden */
  /* position: relative */
  /* touch-action: pan-y pinch-zoom */
  /* User can still scroll page vertically */
}

.see-it-now-swipe-track {
  /* display: flex */
  /* width: 500% (5 slides × 100%) */
  /* height: 100% */
  /* transition: transform 0.3s ease-out */
  /* Will be transformed via JS */
}

.see-it-now-swipe-track.dragging {
  /* transition: none (during drag) */
}

.see-it-now-slide {
  /* width: 20% (1/5 of track) */
  /* height: 100% */
  /* flex-shrink: 0 */
  /* display: flex */
  /* align-items: center */
  /* justify-content: center */
  /* background: #f5f5f5 */
}

.see-it-now-slide img {
  /* max-width: 100% */
  /* max-height: 100% */
  /* object-fit: contain */
  /* user-select: none */
  /* pointer-events: none (prevent drag) */
}

/* Dot indicators */
.see-it-now-dots {
  /* Absolute bottom center of swipe container */
  /* display: flex */
  /* gap: 8px */
  /* padding: 16px */
}

.see-it-now-dot {
  /* 8px × 8px */
  /* border-radius: 50% */
  /* background: #D4D4D4 */
  /* transition: background 0.2s, transform 0.2s */
  /* cursor: pointer */
}

.see-it-now-dot.active {
  /* background: #171717 */
  /* transform: scale(1.25) */
}

/* Tap zones (invisible, for tap navigation) */
.see-it-now-nav-left,
.see-it-now-nav-right {
  /* position: absolute */
  /* top: 0, bottom: 0 */
  /* width: 25% */
  /* cursor: pointer */
  /* z-index: 2 */
}

.see-it-now-nav-left {
  left: 0;
}

.see-it-now-nav-right {
  right: 0;
}
```

#### 7. Result Actions

```css
.see-it-now-result-actions {
  /* flex-shrink: 0 */
  /* padding: 16px 20px */
  /* border-top */
  /* Column on mobile, row on desktop */
}

.see-it-now-btn-primary-pill {
  /* Dark bg, white text */
  /* Full width */
  /* 48px min height */
  /* Pill radius */
  /* Icon + text */
}

.see-it-now-result-secondary {
  /* Flex row, centered */
  /* Gap between buttons */
}

.see-it-now-btn-text {
  /* Transparent bg */
  /* Muted text */
  /* Hover: light bg */
  /* Icon + text */
}
```

#### 8. Version Badge

```css
.see-it-now-version-badge {
  /* Absolute bottom right of result screen */
  /* Small muted text */
  /* "See It Now" */
  /* Semi-transparent bg */
}
```

#### 9. Error Screen

```css
.see-it-now-error-content {
  /* Centered */
  /* Icon, title, subtitle, buttons */
}

.see-it-now-error-content svg {
  /* Warning icon */
  /* 48px, muted color */
  /* Margin bottom 16px */
}

.see-it-now-error-content h2 {
  /* 20px, semibold */
}

.see-it-now-error-content p {
  /* 14px, muted */
  /* Margin bottom 24px */
}
```

#### 10. Utility Classes

```css
.see-it-now-hidden {
  display: none !important;
}

/* Scroll lock when modal open */
html.see-it-now-modal-open,
html.see-it-now-modal-open body {
  overflow: hidden !important;
  position: fixed !important;
  width: 100% !important;
}
```

#### 11. Responsive Breakpoints

```css
/* Mobile first, then: */

@media (min-width: 768px) {
  .see-it-now-modal-content {
    /* Centered card instead of fullscreen */
    /* Max 1000px × 700px */
    /* Border radius */
  }
  
  .see-it-now-result-actions {
    /* Row layout */
  }
  
  .see-it-now-thinking-title {
    /* Larger font */
  }
}
```

---

## API Endpoints Used

All existing - no backend changes required.

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/apps/see-it/room/upload` | POST | `{ content_type }` | `{ sessionId, uploadUrl }` |
| (signed URL) | PUT | Binary image | 200 OK |
| `/apps/see-it/room/confirm` | POST | `{ room_session_id }` | `{ roomImageUrl }` |
| `/apps/see-it/see-it-now/render` | POST | `{ room_session_id, product_id }` | `{ session_id, variants[], duration_ms }` |

---

## Estimated Line Counts

| File | Lines (approx) |
|------|----------------|
| `see-it-now.liquid` | ~150 |
| `see-it-now.js` | ~450 |
| `see-it-now.css` | ~400 |
| **Total** | **~1000** |

---

## Dependencies

- None (no external libraries)
- Custom swipe implementation (~80 lines)

---

## Testing Checklist

### Mobile (iOS Safari, Chrome)
- [ ] Button tap opens camera immediately
- [ ] "Upload" link opens file picker
- [ ] Camera permission denied → shows error
- [ ] Photo capture → thinking screen
- [ ] Swipe left/right works smoothly
- [ ] Swipe momentum/velocity works
- [ ] Tap edges navigates
- [ ] Dot indicators update
- [ ] Share button uses Web Share API
- [ ] Try Again resets flow
- [ ] Close returns to PDP

### Mobile (Android Chrome, Samsung)
- [ ] Same as iOS
- [ ] Handle camera chooser popup gracefully

### Desktop (Chrome, Safari, Firefox)
- [ ] Button click opens file picker immediately
- [ ] Arrow keys navigate images
- [ ] Click edges navigates
- [ ] Mouse drag swipe works
- [ ] Share button downloads image
- [ ] Modal is centered card style

### Edge Cases
- [ ] Very slow network → thinking screen persists
- [ ] Generation fails → error screen
- [ ] Partial generation (3/5) → shows 3 images
- [ ] Large image upload → normalized correctly
- [ ] Portrait image → handled
- [ ] Landscape image → handled

---

## Ready for Implementation

All specs complete. Three files to create:

1. `extensions/see-it-extension/blocks/see-it-now.liquid`
2. `extensions/see-it-extension/assets/see-it-now.js`
3. `extensions/see-it-extension/assets/see-it-now.css`

No backend changes. No database changes. No merchant dashboard changes.
