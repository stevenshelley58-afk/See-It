# See It Now - Build Spec for Claude Code

**Version:** 1.1.0 (Fixed)  
**Status:** Ready for deployment

---

## Overview

A Shopify theme extension block for AR furniture visualization.

**Flow:**
- Mobile: Button → Entry screen (Take Photo + upload fallback) → Camera → Thinking → Swipe Results
- Desktop: Button → File picker opens directly → Thinking → Swipe Results

---

## Files

```
extensions/see-it-extension/
├── blocks/
│   └── see-it-now.liquid    ← NEW
├── assets/
│   ├── see-it-now.js        ← NEW
│   └── see-it-now.css       ← NEW
```

**DO NOT MODIFY** existing V1 files.

---

## Critical Fixes Applied

| Issue | Fix |
|-------|-----|
| Liquid schema | Uses `templates` at top level (works in current Shopify) |
| Floating upload link | Removed - now shows entry screen with "or upload a photo" link BEFORE camera trigger |
| Gemini aspect ratios | Added 21:9 to supported list |
| Hardcoded 5 images | Carousel now handles any number of variants returned by API |
| Share logic | Added `navigator.canShare({ files })` check, try/catch, URL fallback, download fallback |
| CORS on share | Falls back to opening URL in new tab if fetch fails |
| Product ID format | Uses `product.id` from Liquid |
| Upload headers | Uses `file.type` from normalized blob, matches signed URL requirements |
| Response casing | Handles both `sessionId`/`session_id` and `uploadUrl`/`upload_url` |

---

## User Flow

### Mobile
```
[Tap Button]
    ↓
[Entry Screen: product thumbnail + "Take Photo" + "or upload a photo"]
    ↓
[Tap "Take Photo" → Camera opens]
    ↓
[Take photo / iOS "Use Photo"]
    ↓
[Thinking Screen]
    ↓
[Result Screen: swipe carousel]
```

### Desktop
```
[Click Button]
    ↓
[File picker opens immediately]
    ↓
[Select file]
    ↓
[Thinking Screen]
    ↓
[Result Screen: swipe carousel]
```

---

## Screens

### 1. Entry Screen (Mobile Only)
- Product thumbnail (100×100px)
- Title: "See it in your space"
- Description: "Take a photo of your room for an instant AI visualization."
- Primary button: "Take Photo" (triggers camera input)
- Text link: "or upload a photo" (triggers file input)
- Close button in header

### 2. Thinking Screen
- Product thumbnail (80×80px)
- Title: "Creating your visualization" + animated dots
- Subtitle: "AI is placing the product in your room"
- CSS spinner
- Rotating tips (3 second interval)

### 3. Result Screen
- Swipe carousel (handles 1-N images)
- Dot indicators (dynamic count based on API response)
- Back button → returns to entry (mobile) or triggers file picker (desktop)
- Share button → Web Share API with file, fallback to URL share, fallback to download
- "Try Again" button
- "Try Another Product" button
- "See It Now" badge

### 4. Error Screen
- Warning icon
- Title: "Something went wrong"
- Dynamic error message
- "Try Again" button
- "Close" button

---

## API Endpoints

All existing - no backend changes.

### 1. Start Session
```
POST /apps/see-it/room/upload
Body: { "content_type": "image/jpeg" }
Response: { 
  "sessionId": "xxx",      // or "session_id"
  "uploadUrl": "https://..." // or "upload_url"
}
```

### 2. Upload to GCS
```
PUT {uploadUrl}
Headers: { "Content-Type": "{file.type}" }  // Use actual file type
Body: binary
```

### 3. Confirm Room
```
POST /apps/see-it/room/confirm
Body: { "room_session_id": "xxx" }
```

### 4. Generate Images
```
POST /apps/see-it/see-it-now/render
Body: { "room_session_id": "xxx", "product_id": "123" }
Response: {
  "session_id": "see-it-now_xxx",
  "variants": [
    { "id": "center", "image_url": "https://..." },
    // ... 1 to N variants (not hardcoded)
  ],
  "duration_ms": 8500
}
```

---

## Swipe Carousel

Custom implementation (~80 lines), no library.

- Touch: touchstart/touchmove/touchend
- Mouse: mousedown/mousemove/mouseup
- Keyboard: ArrowLeft/ArrowRight
- Tap zones: left/right 20% of image
- Threshold: 25% width OR 0.3 px/ms velocity
- Edge resistance: 30% drag at first/last
- Transition: 300ms ease-out
- Dots: dynamic count, clickable

---

## Share Button Logic

```javascript
async function handleShare() {
  const url = state.images[state.currentIndex];
  
  try {
    // 1. Try Web Share with file
    if (navigator.share && navigator.canShare) {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Fetch failed');
      const blob = await response.blob();
      const file = new File([blob], 'see-it-now.jpg', { type: 'image/jpeg' });
      
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: productTitle });
        return;
      }
    }
    
    // 2. Try Web Share with URL only
    if (navigator.share) {
      await navigator.share({ title: productTitle, url: url });
      return;
    }
    
    // 3. Fallback: download
    downloadImage(url);
    
  } catch (err) {
    if (err.name === 'AbortError') return;
    downloadImage(url);
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

## Deployment

```bash
cd "C:\See It\app"
git add extensions/see-it-extension/blocks/see-it-now.liquid
git add extensions/see-it-extension/assets/see-it-now.js
git add extensions/see-it-extension/assets/see-it-now.css
git commit -m "Add See It Now extension block"
git push origin main

npm run shopify app deploy
```

Then add block to product page in Shopify theme editor.

---

## Test Checklist

- [ ] Mobile: Button opens modal with entry screen
- [ ] Mobile: "Take Photo" opens camera
- [ ] Mobile: "or upload a photo" opens file picker
- [ ] Mobile: Cancel camera returns to entry screen
- [ ] Desktop: Button opens file picker directly
- [ ] Desktop: Cancel file picker closes modal
- [ ] Thinking screen shows spinner and rotating tips
- [ ] Carousel handles 1 image (no dots if single)
- [ ] Carousel handles 3 images
- [ ] Carousel handles 5 images
- [ ] Swipe works on mobile
- [ ] Mouse drag works on desktop
- [ ] Arrow keys work on desktop
- [ ] Tap zones work
- [ ] Dots update on navigation
- [ ] Dot clicks work
- [ ] Share works on iOS (Web Share API)
- [ ] Share works on Android (Web Share API)
- [ ] Share falls back to download on desktop
- [ ] Try Again works (mobile → entry, desktop → file picker)
- [ ] Try Another Product closes modal
- [ ] Error screen shows on API failure
- [ ] Error retry works
