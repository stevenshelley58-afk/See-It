# 03 — Theme Extension

## Purpose
This document specifies the exact DOM structure, IDs, data attributes, CSS classes, JavaScript behavior, and Liquid template for the See It Now storefront theme extension.

---

## File Structure

```
extensions/see-it-extension/
├── shopify.extension.toml
├── assets/
│   ├── see-it-now.css
│   ├── see-it-now.js
│   └── see-it-now-analytics.js  (optional)
├── blocks/
│   └── see-it-now-button.liquid
└── locales/
    └── en.default.json
```

---

## Block Schema (see-it-now-button.liquid)

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
      "type": "checkbox",
      "id": "require_tag",
      "label": "Only show when product has tag",
      "default": true
    },
    {
      "type": "text",
      "id": "required_tag",
      "label": "Required product tag",
      "default": "see-it-live"
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
    },
    {
      "type": "text",
      "id": "monitor_url",
      "label": "Monitor Dashboard URL",
      "info": "URL for analytics tracking. Leave empty to disable."
    },
    {
      "type": "checkbox",
      "id": "enable_analytics",
      "label": "Enable Session Analytics",
      "default": true
    }
  ]
}
```

---

## Rendering Gate Logic (Liquid)

The block only renders if ALL conditions are met:

```liquid
{% assign required_tag = block.settings.required_tag | default: 'see-it-live' %}
{% assign tag_ok = true %}
{% if block.settings.require_tag %}
  {% assign tag_ok = false %}
  {% if product.tags contains required_tag %}
    {% assign tag_ok = true %}
  {% endif %}
{% endif %}

{% if product != blank and product.featured_image != blank and tag_ok %}
  <!-- RENDER WIDGET + MODAL -->
{% endif %}
```

Conditions:
1. `product` exists (we're on a PDP)
2. `product.featured_image` exists
3. Tag requirement is satisfied (if enabled)

---

## DOM IDs (Exact)

| ID | Element | Purpose |
|----|---------|---------|
| `see-it-now-trigger` | `<button>` | Main entry button on PDP |
| `see-it-now-modal` | `<div>` | Modal container |
| `see-it-now-global-error` | `<div>` | Toast error display |
| `see-it-now-screen-entry` | `<div>` | Entry screen (mobile) |
| `see-it-now-screen-thinking` | `<div>` | Loading/generation screen |
| `see-it-now-screen-result` | `<div>` | Results carousel screen |
| `see-it-now-screen-error` | `<div>` | Error screen |
| `see-it-now-close-entry` | `<button>` | Close button on entry screen |
| `see-it-now-btn-camera` | `<button>` | Camera capture button |
| `see-it-now-btn-upload-fallback` | `<button>` | Upload fallback link |
| `see-it-now-entry-product-img` | `<img>` | Product image on entry screen |
| `see-it-now-thinking-product-img` | `<img>` | Product image on thinking screen |
| `see-it-now-thinking-tip` | `<p>` | Rotating tip text |
| `see-it-now-swipe-container` | `<div>` | Carousel container |
| `see-it-now-swipe-track` | `<div>` | Carousel track (slides container) |
| `see-it-now-dots` | `<div>` | Pagination dots container |
| `see-it-now-nav-left` | `<div>` | Left navigation area |
| `see-it-now-nav-right` | `<div>` | Right navigation area |
| `see-it-now-share` | `<button>` | Share button |
| `see-it-now-try-again` | `<button>` | Try again (same room) |
| `see-it-now-try-another` | `<button>` | Try another product |
| `see-it-now-back-result` | `<button>` | Back button on result screen |
| `see-it-now-close-result` | `<button>` | Close button on result screen |
| `see-it-now-error-message` | `<p>` | Error message text |
| `see-it-now-error-retry` | `<button>` | Retry button on error screen |
| `see-it-now-error-close` | `<button>` | Close button on error screen |
| `see-it-now-close-error` | `<button>` | X button on error screen header |
| `see-it-now-camera-input` | `<input>` | Hidden camera file input |
| `see-it-now-upload-input` | `<input>` | Hidden upload file input |

---

## Data Attributes (Trigger Button)

The trigger button must have these data attributes:

```html
<button
  id="see-it-now-trigger"
  data-product-id="{{ product.id }}"
  data-product-handle="{{ product.handle }}"
  data-product-image="{{ product.featured_image | image_url: width: 800 }}"
  data-product-title="{{ product.title | escape }}"
  data-product-price="{{ product.price | money | escape }}"
  data-product-collection="{{ product.collections.first.handle | default: '' }}"
  data-shop-domain="{{ shop.domain }}"
  data-shop-permanent-domain="{{ shop.permanent_domain }}"
  data-monitor-url="{{ block.settings.monitor_url | default: '' }}"
  data-analytics-enabled="{{ block.settings.enable_analytics | default: true }}"
>
```

| Attribute | Source | Example Value |
|-----------|--------|---------------|
| `data-product-id` | `product.id` | `7654321098765` |
| `data-product-handle` | `product.handle` | `oak-dining-table` |
| `data-product-image` | `product.featured_image \| image_url: width: 800` | `https://cdn.shopify.com/...` |
| `data-product-title` | `product.title \| escape` | `Oak Dining Table` |
| `data-product-price` | `product.price \| money \| escape` | `$1,299.00` |
| `data-product-collection` | `product.collections.first.handle` | `dining-tables` |
| `data-shop-domain` | `shop.domain` | `mystore.com` |
| `data-shop-permanent-domain` | `shop.permanent_domain` | `mystore.myshopify.com` |
| `data-monitor-url` | Block setting | `https://see-it-monitor.vercel.app` |
| `data-analytics-enabled` | Block setting | `true` |

---

## CSS Class Contracts

### State Classes
| Class | Applied To | Meaning |
|-------|------------|---------|
| `hidden` | `.see-it-now-modal` | Modal is closed |
| `active` | `.see-it-now-screen` | Screen is visible |
| `see-it-now-hidden` | Any element | Generic hide utility |
| `see-it-now-modal-open` | `<html>` | Body scroll locked |

### Component Classes
| Class | Element |
|-------|---------|
| `see-it-now-widget-hook` | Widget container on PDP |
| `see-it-now-widget-content` | Widget text area |
| `see-it-now-widget-title` | Widget heading |
| `see-it-now-widget-description` | Widget subtext |
| `see-it-now-modal` | Modal overlay |
| `see-it-now-modal-content` | Modal inner container |
| `see-it-now-screen` | Each screen (entry/thinking/result/error) |
| `see-it-now-header` | Screen header bar |
| `see-it-now-header-spacer` | Flex spacer in header |
| `see-it-now-btn-primary-pill` | Primary CTA button |
| `see-it-now-btn-outline-pill` | Secondary button |
| `see-it-now-btn-text` | Text-style button |
| `see-it-now-btn-icon` | Icon-only button |
| `see-it-now-entry-content` | Entry screen content area |
| `see-it-now-entry-product` | Product image container |
| `see-it-now-entry-title` | Entry screen title |
| `see-it-now-entry-description` | Entry screen subtitle |
| `see-it-now-entry-actions` | Entry screen buttons |
| `see-it-now-thinking-content` | Thinking screen content |
| `see-it-now-thinking-product` | Product image on thinking |
| `see-it-now-thinking-title` | Thinking screen title |
| `see-it-now-thinking-subtitle` | Thinking screen subtitle |
| `see-it-now-thinking-spinner` | Loading spinner |
| `see-it-now-thinking-tip` | Rotating tip text |
| `see-it-now-loading-dots` | Animated dots (append to title) |
| `see-it-now-swipe-container` | Carousel wrapper |
| `see-it-now-swipe-track` | Carousel track |
| `see-it-now-slide` | Individual slide |
| `see-it-now-nav-left` | Left nav area |
| `see-it-now-nav-right` | Right nav area |
| `see-it-now-dots` | Dots container |
| `see-it-now-dot` | Individual dot |
| `see-it-now-dot.active` | Current slide dot |
| `see-it-now-result-actions` | Result screen buttons |
| `see-it-now-result-secondary` | Secondary actions row |
| `see-it-now-version-badge` | Version label |
| `see-it-now-error-content` | Error screen content |
| `see-it-now-error-icon` | Error icon |
| `see-it-now-error-title` | Error title |
| `see-it-now-error-subtitle` | Error message |
| `see-it-now-error-actions` | Error buttons |
| `see-it-now-icon-cube` | Cube icon in button |

---

## State Machine (JavaScript)

### States
```
CLOSED → ENTRY → THINKING → RESULT
                    ↓
                  ERROR
```

| State | Screen Visible | Can Transition To |
|-------|----------------|-------------------|
| `CLOSED` | None (modal hidden) | `ENTRY` (mobile), `THINKING` (desktop) |
| `ENTRY` | `see-it-now-screen-entry` | `THINKING`, `CLOSED` |
| `THINKING` | `see-it-now-screen-thinking` | `RESULT`, `ERROR` |
| `RESULT` | `see-it-now-screen-result` | `THINKING` (try again), `CLOSED` |
| `ERROR` | `see-it-now-screen-error` | `THINKING` (retry), `CLOSED` |

### Transition Rules

```javascript
// Mobile: Button click
CLOSED → ENTRY

// Desktop: Button click (file picker opens)
CLOSED → (file picker) → THINKING

// File selected (either platform)
ENTRY → THINKING
(file picker) → THINKING

// Generation success (variants.length >= 1)
THINKING → RESULT

// Generation failure (any error)
THINKING → ERROR

// Try again (from result or error)
RESULT → ENTRY (mobile) or file picker (desktop)
ERROR → ENTRY (mobile) or file picker (desktop)

// Close (from any screen)
* → CLOSED
```

### State Implementation

```javascript
function showScreen(screenName) {
  const screens = {
    entry: screenEntry,
    thinking: screenThinking,
    result: screenResult,
    error: screenError,
  };

  // Remove active from all
  Object.values(screens).forEach(s => {
    if (s) s.classList.remove('active');
  });

  // Add active to target
  const target = screens[screenName];
  if (target) {
    target.classList.add('active');
  }

  // Start/stop tip rotation
  if (screenName === 'thinking') {
    startTipRotation();
  } else {
    stopTipRotation();
  }
}
```

---

## Platform Detection

```javascript
function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
}
```

Mobile behavior:
- Shows entry screen first
- Camera button triggers `capture="environment"` input
- Upload fallback available

Desktop behavior:
- Skips entry screen
- File picker opens immediately on button click

---

## File Inputs

### Camera Input (mobile)
```html
<input
  type="file"
  id="see-it-now-camera-input"
  accept="image/*"
  capture="environment"
  style="display: none;"
>
```

### Upload Input (both platforms)
```html
<input
  type="file"
  id="see-it-now-upload-input"
  accept="image/*"
  style="display: none;"
>
```

Accepted MIME types: `image/*` (browser handles validation)
Supported by backend: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`

---

## Image Normalization (Client-Side)

Before upload, the client must normalize the room image:

### Supported Aspect Ratios (Gemini-compatible)

```javascript
const GEMINI_SUPPORTED_RATIOS = [
  { label: '1:1',   value: 1.0 },
  { label: '4:5',   value: 0.8 },
  { label: '5:4',   value: 1.25 },
  { label: '3:4',   value: 0.75 },
  { label: '4:3',   value: 4/3 },
  { label: '2:3',   value: 2/3 },
  { label: '3:2',   value: 1.5 },
  { label: '9:16',  value: 9/16 },
  { label: '16:9',  value: 16/9 },
  { label: '21:9',  value: 21/9 },
];
```

### Normalization Algorithm

```javascript
async function normalizeRoomImage(file, maxDimension = 2048) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      
      // Find closest supported ratio
      const inputRatio = w / h;
      let closest = GEMINI_SUPPORTED_RATIOS[0];
      let minDiff = Math.abs(inputRatio - closest.value);
      for (const r of GEMINI_SUPPORTED_RATIOS) {
        const diff = Math.abs(inputRatio - r.value);
        if (diff < minDiff) {
          minDiff = diff;
          closest = r;
        }
      }

      // Calculate center crop
      let cropW, cropH;
      if (w / h > closest.value) {
        cropH = h;
        cropW = Math.round(h * closest.value);
      } else {
        cropW = w;
        cropH = Math.round(w / closest.value);
      }

      const offsetX = Math.round((w - cropW) / 2);
      const offsetY = Math.round((h - cropH) / 2);

      // Scale down if needed
      let outW = cropW, outH = cropH;
      if (Math.max(outW, outH) > maxDimension) {
        const scale = maxDimension / Math.max(outW, outH);
        outW = Math.round(outW * scale);
        outH = Math.round(outH * scale);
      }

      // Draw to canvas
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, offsetX, offsetY, cropW, cropH, 0, 0, outW, outH);

      // Export as JPEG
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Canvas toBlob failed'));
        resolve({ blob, width: outW, height: outH });
      }, 'image/jpeg', 0.92);
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = URL.createObjectURL(file);
  });
}
```

Output:
- Format: JPEG
- Quality: 0.92
- Max dimension: 2048px
- Aspect ratio: Nearest Gemini-supported ratio (center crop)

---

## API Call Sequence

```javascript
async function handleFileSelected(file) {
  showScreen('thinking');

  try {
    // 1. Normalize image
    const normalized = await normalizeRoomImage(file);
    const normalizedFile = new File([normalized.blob], 'room.jpg', { type: 'image/jpeg' });

    // 2. Start session
    const session = await fetch('/apps/see-it/room/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'image/jpeg' })
    }).then(r => r.json());
    
    const roomSessionId = session.room_session_id || session.sessionId;
    const uploadUrl = session.upload_url || session.uploadUrl;

    // 3. Upload to GCS
    await fetch(uploadUrl, {
      method: 'PUT',
      body: normalizedFile,
      headers: { 'Content-Type': 'image/jpeg' },
      mode: 'cors'
    });

    // 4. Confirm upload
    await fetch('/apps/see-it/room/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_session_id: roomSessionId })
    });

    // 5. Generate variants
    const result = await fetch('/apps/see-it/see-it-now/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_session_id: roomSessionId,
        product_id: state.productId
      })
    }).then(r => r.json());

    if (!result.variants || result.variants.length === 0) {
      throw new Error('No images generated');
    }

    // 6. Populate carousel
    const imageUrls = result.variants.map(v => v.image_url);
    populateCarousel(imageUrls);
    showScreen('result');

  } catch (err) {
    showError(err.message || 'Something went wrong');
  }
}
```

---

## Carousel Implementation

### Populate

```javascript
function populateCarousel(images) {
  state.images = images;
  state.currentIndex = 0;

  swipeTrack.innerHTML = '';
  dotsContainer.innerHTML = '';

  const count = images.length;

  // Create slides
  images.forEach((url, i) => {
    const slide = document.createElement('div');
    slide.className = 'see-it-now-slide';
    slide.style.width = `${100 / count}%`;
    
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Visualization ${i + 1}`;
    img.draggable = false;
    
    slide.appendChild(img);
    swipeTrack.appendChild(slide);
  });

  // Create dots
  images.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'see-it-now-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', `View image ${i + 1}`);
    dot.addEventListener('click', () => navigateTo(i));
    dotsContainer.appendChild(dot);
  });

  swipeTrack.style.width = `${count * 100}%`;
  updateTrackPosition(false);
}
```

### Navigation

```javascript
function updateTrackPosition(animate = true) {
  const count = state.images.length;
  if (count === 0) return;
  const offset = -state.currentIndex * (100 / count);
  swipeTrack.style.transition = animate ? 'transform 0.3s ease-out' : 'none';
  swipeTrack.style.transform = `translateX(${offset}%)`;
}

function updateDots() {
  const dots = dotsContainer.querySelectorAll('.see-it-now-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === state.currentIndex);
  });
}

function navigateTo(index) {
  const max = state.images.length - 1;
  state.currentIndex = Math.max(0, Math.min(max, index));
  updateTrackPosition(true);
  updateDots();
}
```

### Swipe Handling

```javascript
const SWIPE_THRESHOLD = 0.25;      // 25% of container width
const SWIPE_VELOCITY_THRESHOLD = 0.3;  // px/ms

function handleSwipeStart(clientX) {
  state.swipeStartX = clientX;
  state.swipeCurrentX = clientX;
  state.swipeStartTime = Date.now();
  state.swiping = true;
  swipeTrack.style.transition = 'none';
}

function handleSwipeMove(clientX) {
  if (!state.swiping) return;
  state.swipeCurrentX = clientX;

  const containerWidth = swipeContainer.offsetWidth;
  const deltaX = state.swipeCurrentX - state.swipeStartX;
  const count = state.images.length;
  const baseOffset = -state.currentIndex * (100 / count);
  const dragOffset = (deltaX / containerWidth) * (100 / count);

  // Resistance at edges
  let finalOffset = baseOffset + dragOffset;
  if (state.currentIndex === 0 && deltaX > 0) {
    finalOffset = baseOffset + dragOffset * 0.3;
  } else if (state.currentIndex === count - 1 && deltaX < 0) {
    finalOffset = baseOffset + dragOffset * 0.3;
  }

  swipeTrack.style.transform = `translateX(${finalOffset}%)`;
}

function handleSwipeEnd() {
  if (!state.swiping) return;
  state.swiping = false;

  const containerWidth = swipeContainer.offsetWidth;
  const deltaX = state.swipeCurrentX - state.swipeStartX;
  const deltaTime = Date.now() - state.swipeStartTime;
  const velocity = Math.abs(deltaX) / deltaTime;

  const threshold = containerWidth * SWIPE_THRESHOLD;
  const isQuickFlick = velocity > SWIPE_VELOCITY_THRESHOLD;

  if (deltaX < -threshold || (deltaX < 0 && isQuickFlick)) {
    navigateTo(state.currentIndex + 1);
  } else if (deltaX > threshold || (deltaX > 0 && isQuickFlick)) {
    navigateTo(state.currentIndex - 1);
  } else {
    updateTrackPosition(true);
  }
}
```

### Keyboard Navigation

```javascript
document.addEventListener('keydown', (e) => {
  if (!modal.classList.contains('hidden') && screenResult.classList.contains('active')) {
    if (e.key === 'ArrowLeft') navigateTo(state.currentIndex - 1);
    if (e.key === 'ArrowRight') navigateTo(state.currentIndex + 1);
  }
});
```

---

## Share Behavior

```javascript
async function handleShare() {
  const currentUrl = state.images[state.currentIndex];
  if (!currentUrl) return;

  try {
    // Try native share with file (mobile)
    if (navigator.share && navigator.canShare) {
      const response = await fetch(currentUrl);
      const blob = await response.blob();
      const file = new File([blob], 'see-it-now.jpg', { type: 'image/jpeg' });
      
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: state.productTitle || 'See It Now'
        });
        return;
      }
    }
    
    // Try native share without file (URL only)
    if (navigator.share) {
      await navigator.share({
        title: state.productTitle || 'See It Now',
        url: currentUrl
      });
      return;
    }
    
    // Fallback: download
    downloadImage(currentUrl);
    
  } catch (err) {
    if (err.name === 'AbortError') return; // User cancelled
    downloadImage(currentUrl);
  }
}

function downloadImage(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = 'see-it-now.jpg';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

---

## Tip Rotation

```javascript
const TIPS = [
  'Tip: Good lighting makes the best visualizations',
  'Tip: Clear floor space helps with placement',
  'AI is analyzing your room layout...',
  'Finding the perfect spots for your furniture...',
  'Almost there...',
];

let tipInterval = null;
let tipIndex = 0;

function startTipRotation() {
  tipIndex = 0;
  thinkingTip.textContent = TIPS[0];
  tipInterval = setInterval(() => {
    tipIndex = (tipIndex + 1) % TIPS.length;
    thinkingTip.textContent = TIPS[tipIndex];
  }, 3000);  // Rotate every 3 seconds
}

function stopTipRotation() {
  if (tipInterval) {
    clearInterval(tipInterval);
    tipInterval = null;
  }
}
```

---

## Scroll Lock

```javascript
let savedScrollY = 0;

function lockScroll() {
  savedScrollY = window.scrollY;
  document.documentElement.classList.add('see-it-now-modal-open');
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
}

function unlockScroll() {
  document.documentElement.classList.remove('see-it-now-modal-open');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, savedScrollY);
}
```

---

## Initialization

```javascript
document.addEventListener('DOMContentLoaded', function() {
  if (window.__SEE_IT_NOW_INITIALIZED__) return;

  const trigger = document.getElementById('see-it-now-trigger');
  const modal = document.getElementById('see-it-now-modal');

  if (!trigger || !modal) {
    // Retry with backoff
    let retries = 0;
    const timer = setInterval(() => {
      retries++;
      if (document.getElementById('see-it-now-trigger') && document.getElementById('see-it-now-modal')) {
        clearInterval(timer);
        initSeeItNow();
      } else if (retries >= 40) {
        clearInterval(timer);
      }
    }, 250);
    return;
  }

  initSeeItNow();
});

// Handle Shopify section reload
document.addEventListener('shopify:section:load', () => {
  window.__SEE_IT_NOW_INITIALIZED__ = false;
  initSeeItNow();
});
```

---

## Error Messages

User-facing error messages:

| Error Code | Message |
|------------|---------|
| `see_it_now_not_enabled` | "This feature is not enabled for this store" |
| `product_not_enabled` | "This product is not enabled for visualization" |
| `room_not_found` | "Room session not found" |
| `all_variants_failed` | "Failed to generate visualization. Please try again." |
| `generation_failed` | "Something went wrong. Please try again." |
| `upload_failed` | "Upload failed. Please try again." |
| Network error | "Connection error. Please check your internet and try again." |
| Default | "We couldn't create your visualization" |
