# See It Now - Product Spec

**Version:** 1.0.0  
**Created:** January 2026  
**Status:** Ready for implementation

---

## Overview

See It Now is a simplified customer-facing AR visualization flow. One tap opens the camera, AI generates 5 placement options, user swipes through results Tinder-style.

### Design Philosophy
- Minimal friction (1 tap to camera)
- No decisions during generation
- Discovery through swiping (not grid selection)
- Optimized for older demographics

---

## User Flow

### Mobile
```
[See It Now Button] 
    → Camera opens instantly
    → User takes photo
    → Thinking screen (5 images generating in background)
    → Result screen (swipe through 5 options)
```

### Desktop
```
[See It Now Button]
    → File picker opens instantly
    → User selects image
    → Thinking screen
    → Result screen (swipe/click through 5 options)
```

### Mobile with Upload Preference
```
[See It Now Button]
    → Camera opens
    → User taps small "upload" link (bottom corner)
    → File picker opens
    → ... continues as normal
```

---

## Screens

### 1. Thinking Screen

**Layout:**
- Product thumbnail (80×80px, rounded corners, centered)
- Title: "Creating your visualization" with animated dots (...)
- Subtitle: "AI is placing the product in your room"
- Rotating tips (cycle every 3 seconds)

**Tips Array:**
```javascript
const TIPS = [
  'Tip: Good lighting makes the best visualizations',
  'Tip: Clear floor space helps with placement',
  'AI is analyzing your room layout...',
  'Finding the perfect spots for your furniture...',
  'Almost there...',
];
```

**Visual:**
- Simple centered spinner or shimmer
- No grid (don't hint at multiple images)
- No progress percentage

**Behavior:**
- Back button disabled during generation
- Cannot cancel once started

---

### 2. Result Screen (Tinder-Style Swipe)

**Layout:**
- Full-bleed image container (swipeable)
- Dot indicators (5 dots, bottom of image area, subtle)
- Action bar below image:
  - Share button (primary, full width on mobile)
  - Secondary row: "Try Again" | "Try Another Product"
- Badge: "See It Now" (bottom right corner)

**Swipe Behavior:**

| Input | Action |
|-------|--------|
| Swipe left | Next image (with momentum) |
| Swipe right | Previous image |
| Tap left 25% of image | Previous image |
| Tap right 25% of image | Next image |
| Tap center 50% of image | No action (prevents accidental nav) |
| Tap dot indicator | Jump to that image |
| Arrow keys (desktop) | Navigate left/right |

**Animation:**
- Horizontal slide transition (200-300ms)
- Current image slides out, next slides in
- Subtle scale down on drag (0.98)
- Snap back if swipe not committed (< 30% threshold)

**Dot Indicators:**
- 5 dots, 8px diameter, 8px gap
- Active: solid dark (#171717)
- Inactive: light gray (#D4D4D4)
- Smooth transition on change

**Share Button:**
- Shares currently visible image only
- Uses Web Share API on mobile
- Falls back to download on desktop

---

### 3. Error Screen

**Layout:**
- Centered content
- Icon: Warning/error icon
- Title: "Something went wrong"
- Subtitle: "We couldn't create your visualization"
- Primary button: "Try Again"
- Secondary button: "Close"

**Behavior:**
- "Try Again" returns to camera/file picker
- "Close" dismisses modal entirely

---

## Technical Implementation

### Files to Create

```
extensions/see-it-extension/
├── blocks/
│   └── see-it-now.liquid
├── assets/
│   ├── see-it-now.js
│   └── see-it-now.css
```

### Liquid Template Structure

```liquid
{% schema %}
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
    }
  ]
}
{% endschema %}

<!-- Widget button on PDP -->
<!-- Hidden file inputs (camera + upload) -->
<!-- Modal with: Thinking Screen, Result Screen, Error Screen -->
```

### JavaScript Architecture

```javascript
// State
let state = {
  sessionId: null,
  roomSessionId: null,
  images: [],        // Array of 5 image URLs
  currentIndex: 0,   // Currently displayed image (0-4)
  isGenerating: false,
};

// Core functions
- detectPlatform()      // Returns 'mobile' | 'desktop'
- openCamera()          // Triggers camera input
- openFilePicker()      // Triggers file input
- handleFile(file)      // Normalize, upload, generate
- showThinking()        // Display thinking screen
- showResult()          // Display result screen with images
- showError(message)    // Display error screen
- navigateImage(delta)  // Move to next/prev image
- shareCurrentImage()   // Share via Web Share API or download

// Swipe handling
- Touch events for mobile swipe
- Mouse drag for desktop
- Keyboard arrow keys for desktop
```

### CSS Architecture

```css
/* Scoped to .see-it-now-* classes */
/* Reuse design tokens from V2 where possible */
/* New: swipe container, dot indicators, slide animations */
```

### Backend

**No new endpoints required.**

Reuse existing V2 endpoints:
- `POST /apps/see-it/room/upload` - Get signed upload URL
- `POST /apps/see-it/room/confirm` - Confirm room upload
- `POST /apps/see-it/render-v2` - Generate 5 variants

Response from render-v2:
```json
{
  "session_id": "v2_xxx_123",
  "variants": [
    { "id": "center", "image_url": "https://..." },
    { "id": "left", "image_url": "https://..." },
    { "id": "right", "image_url": "https://..." },
    { "id": "higher", "image_url": "https://..." },
    { "id": "lower", "image_url": "https://..." }
  ],
  "duration_ms": 8500
}
```

We use `variants[].image_url` directly, ignore the `id` and `hint` fields.

---

## Widget Appearance (PDP Button)

**Container:**
- White background
- Subtle border and shadow
- 16px padding
- Full width

**Content:**
- Title: "See It In Your Space"
- Description: "Instant AI visualization"

**Button:**
- Label: "See It Now" (or merchant customizable)
- Icon: Camera (mobile) / Upload (desktop)
- Primary pill style (dark background, white text)

---

## Platform Detection

```javascript
function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
         (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
}
```

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Camera permission denied | Show error, offer upload fallback |
| Upload cancelled | Return to PDP (no modal) |
| Network error during upload | Show error screen with retry |
| Generation fails | Show error screen with retry |
| Partial generation (3/5 succeed) | Show only successful images |
| All generation fails | Show error screen |
| Image too small | Accept anyway (AI handles it) |
| Image too large | Normalize to 2048px max |

---

## Analytics Events (Future)

```javascript
// Suggested events to track
'see_it_now_opened'           // Button clicked
'see_it_now_camera_opened'    // Camera triggered
'see_it_now_upload_opened'    // File picker triggered
'see_it_now_photo_taken'      // Image captured/selected
'see_it_now_generation_started'
'see_it_now_generation_completed'
'see_it_now_generation_failed'
'see_it_now_image_swiped'     // { from: 0, to: 1 }
'see_it_now_image_shared'     // { index: 2 }
'see_it_now_try_again'
'see_it_now_closed'
```

---

## Migration Notes

- See It Now lives alongside V1 and V2
- Merchants can choose which block to add to their theme
- All three share the same backend infrastructure
- No database schema changes required
- Shop allowlist in render-v2.ts still applies

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to first image | < 10 seconds |
| Completion rate (photo → result) | > 80% |
| Swipe engagement (viewed 2+ images) | > 60% |
| Share rate | > 10% |

---

## Open Questions

1. **Swipe library?** Build custom or use tiny library like Swiper/Flickity?
   - Recommendation: Build custom (< 100 lines, no dependency)

2. **Preload images?** Load all 5 or lazy load on swipe?
   - Recommendation: Preload all 5 (they're generated anyway)

3. **Haptic feedback on swipe?** 
   - Nice to have, not MVP

---

## Approval

- [ ] Steven review
- [ ] Em review (design)
- [ ] Ready for implementation
