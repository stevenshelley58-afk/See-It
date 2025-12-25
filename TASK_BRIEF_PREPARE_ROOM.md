# Task: PrepareRoom Component for See It

## What We're Building
A screen where customers paint over furniture they want removed from their room photo before placing AR furniture.

## Flow
```
Image loads → User paints over item → Tap "Continue" → AI removes item → Go to AR view
```

## Critical Requirements

### 1. Never Stretch Images
- Use `object-fit: contain`
- Calculate display size from original aspect ratio
- Store original dimensions on load

### 2. Mask Must Match Original Dimensions
```javascript
// Display canvas = screen size (what user sees)
// Mask canvas = original image size (what API receives)
// Convert coordinates when drawing to mask:
const scale = originalDims.width / displayState.width;
maskX = screenX * scale;
maskY = screenY * scale;
```

### 3. Zero Wait to Draw
- Show image immediately via `URL.createObjectURL(file)`
- Enable drawing before dimensions load
- Compress for API in background

### 4. Button States
- No strokes: "Skip"
- Has strokes: "Continue"

## UI Spec

```
┌─────────────────────────────────────┐
│  ←       PREPARE ROOM               │
├─────────────────────────────────────┤
│                                     │
│        ┌─────────────────┐          │
│        │   Room Image    │          │
│        │ + Paint Overlay │          │
│        └─────────────────┘          │
│                                     │
│   "Paint over item to remove"       │
│                                     │
│        [ S ]  [ M ]  [ L ]          │  ← Brush sizes
│                                     │
├─────────────────────────────────────┤
│ [ Undo ]   [ Clear ]   [ Continue ] │
└─────────────────────────────────────┘
```

## Paint Settings
- Color: `rgba(255, 107, 107, 0.6)` (coral, 60% opacity)
- Brush sizes: Small=20px, Medium=40px, Large=70px
- Default: Medium

## Processing States
While API runs, show rotating text:
- "Processing your image..."
- "Identifying object..."
- "Removing item..."
- "Filling in the background..."

## API Prompt
```
You are removing furniture from a room photo for AR furniture visualization.

The customer has painted over an object they want removed. The white area in the mask shows approximately where they painted.

YOUR TASK:
1. Identify what object the customer is trying to remove
2. Remove the ENTIRE object (not just painted area) — include legs, shadows
3. Fill the space with matching floor and wall textures

REQUIREMENTS:
- Remove complete object even if only partially painted
- Maintain exact room perspective and lighting
- Keep same aspect ratio and dimensions
- Seamless texture transitions

Do not alter anything outside the object being removed.
```

## Files to Reference
- Full implementation guide: `docs/SEE_IT_ROOM_CLEANUP_GUIDE.md`
- See sections on "Mask Alignment" and "Debugging" if you hit coordinate issues

## Acceptance Criteria
- [ ] Image displays at max size without stretching
- [ ] Drawing works on mobile (touch) and desktop (mouse)
- [ ] Mask generates at original image dimensions
- [ ] Skip/Continue button changes based on strokes
- [ ] Undo removes last stroke
- [ ] Clear removes all strokes
- [ ] Processing overlay shows during API call
- [ ] Brush size selector works
