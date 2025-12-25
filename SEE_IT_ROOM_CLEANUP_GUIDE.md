# See It Room Cleanup — Implementation Guide

Fast, high-quality object removal for AR furniture placement.

---

## Critical Rules

1. **NEVER stretch an image** — maintain original aspect ratio always
2. **Maximize image on mobile** — use full available width, let height follow
3. **Mask coordinates must match image coordinates** — this is where most bugs happen
4. **Background load everything** — user should never wait to start drawing

---

## The Flow

```
Customer uploads room photo
    ↓
Customer PAINTS over object they want gone (rough brush strokes)
    ↓
AI interprets what object they're trying to remove
    ↓
Gemini removes object, fills with floor/wall
    ↓
Customer places merchant's furniture in clean space
```

**Target**: < 8 seconds total, seamless result

---

## Image Handling — Never Stretch

### The Golden Rule
```
Display Aspect Ratio === Original Aspect Ratio === Mask Aspect Ratio === Output Aspect Ratio
```

If any of these differ, you get misaligned masks or distorted results.

### Mobile-First Display
```javascript
function calculateDisplaySize(originalWidth, originalHeight, containerWidth, containerHeight) {
  const imageAspect = originalWidth / originalHeight;
  const containerAspect = containerWidth / containerHeight;
  
  let displayWidth, displayHeight;
  
  if (imageAspect > containerAspect) {
    // Image is wider than container — fit to width
    displayWidth = containerWidth;
    displayHeight = containerWidth / imageAspect;
  } else {
    // Image is taller than container — fit to height
    displayHeight = containerHeight;
    displayWidth = containerHeight * imageAspect;
  }
  
  return {
    width: Math.round(displayWidth),
    height: Math.round(displayHeight),
    scale: displayWidth / originalWidth,  // CRITICAL: save this for mask conversion
    offsetX: (containerWidth - displayWidth) / 2,
    offsetY: (containerHeight - displayHeight) / 2
  };
}
```

### Store Original Dimensions Immediately
```javascript
// On image load — before ANYTHING else
async function onImageSelected(file) {
  // 1. Get original dimensions FIRST
  const originalDimensions = await getImageDimensions(file);
  
  // 2. Store them globally for this session
  sessionState.original = {
    width: originalDimensions.width,
    height: originalDimensions.height,
    aspectRatio: originalDimensions.width / originalDimensions.height,
    file: file
  };
  
  // 3. Calculate display size
  const container = document.getElementById('image-container');
  sessionState.display = calculateDisplaySize(
    originalDimensions.width,
    originalDimensions.height,
    container.clientWidth,
    container.clientHeight
  );
  
  // 4. Now show the image
  displayImage(file, sessionState.display);
}
```

### CSS for Non-Stretching Display
```css
.room-image {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;  /* NEVER use 'cover' or 'fill' */
}

.image-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: calc(100vh - 200px);  /* Leave room for controls */
}
```

---

## Mask Alignment — The #1 Bug Source

### Why Masks Fail
| Problem | Cause | Solution |
|---------|-------|----------|
| Mask offset | Drawing on scaled image, sending unscaled coords | Always convert coordinates |
| Mask too small | Canvas size ≠ image size | Match canvas to original dimensions |
| Mask stretched | Display scale applied to mask | Generate mask at original size |
| Mask missing | Race condition — mask not ready | Await mask generation explicitly |

### The Coordinate System

```
┌─────────────────────────────────────────┐
│           PHONE SCREEN                  │
│  ┌───────────────────────────────────┐  │
│  │     Container (full width)        │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   Display Image (scaled)    │  │  │
│  │  │                             │  │  │
│  │  │   User draws HERE           │  │  │
│  │  │   (screen coordinates)      │  │  │
│  │  │                             │  │  │
│  │  └─────────────────────────────┘  │  │
│  │         ↓ CONVERT ↓               │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   Original Image            │  │  │
│  │  │   (full resolution)         │  │  │
│  │  │                             │  │  │
│  │  │   Mask drawn HERE           │  │  │
│  │  │   (original coordinates)    │  │  │
│  │  │                             │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Coordinate Conversion (Critical)
```javascript
function screenToOriginal(screenX, screenY, displayState) {
  // Remove offset (centering)
  const relativeX = screenX - displayState.offsetX;
  const relativeY = screenY - displayState.offsetY;
  
  // Scale up to original dimensions
  const originalX = relativeX / displayState.scale;
  const originalY = relativeY / displayState.scale;
  
  return { x: originalX, y: originalY };
}

function screenBrushToOriginal(screenBrushSize, displayState) {
  // Brush size must also be scaled
  return screenBrushSize / displayState.scale;
}
```

### Drawing Architecture
```javascript
// TWO canvases — one for display, one for the actual mask
const displayCanvas = document.getElementById('paint-overlay');  // What user sees
const maskCanvas = document.createElement('canvas');  // Hidden, original size

function initializeCanvases(originalDimensions, displayState) {
  // Display canvas matches SCREEN size
  displayCanvas.width = displayState.width;
  displayCanvas.height = displayState.height;
  displayCanvas.style.width = displayState.width + 'px';
  displayCanvas.style.height = displayState.height + 'px';
  
  // Mask canvas matches ORIGINAL size
  maskCanvas.width = originalDimensions.width;
  maskCanvas.height = originalDimensions.height;
  
  // Fill mask with black (preserve all)
  const maskCtx = maskCanvas.getContext('2d');
  maskCtx.fillStyle = 'black';
  maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
}

function onPaintStroke(screenPoints, screenBrushSize) {
  const displayCtx = displayCanvas.getContext('2d');
  const maskCtx = maskCanvas.getContext('2d');
  
  // Draw on BOTH canvases simultaneously
  
  // 1. Display canvas (what user sees) — screen coordinates
  displayCtx.strokeStyle = 'rgba(255, 107, 107, 0.6)';
  displayCtx.lineWidth = screenBrushSize;
  displayCtx.lineCap = 'round';
  displayCtx.lineJoin = 'round';
  drawStroke(displayCtx, screenPoints);
  
  // 2. Mask canvas (for API) — converted to original coordinates
  const originalPoints = screenPoints.map(p => 
    screenToOriginal(p.x, p.y, sessionState.display)
  );
  const originalBrushSize = screenBrushToOriginal(screenBrushSize, sessionState.display);
  
  maskCtx.strokeStyle = 'white';
  maskCtx.lineWidth = originalBrushSize;
  maskCtx.lineCap = 'round';
  maskCtx.lineJoin = 'round';
  drawStroke(maskCtx, originalPoints);
}
```

### Validation Before API Call
```javascript
async function validateMaskBeforeSend(maskCanvas, originalDimensions) {
  const errors = [];
  
  // 1. Dimension check
  if (maskCanvas.width !== originalDimensions.width || 
      maskCanvas.height !== originalDimensions.height) {
    errors.push(`Mask size (${maskCanvas.width}x${maskCanvas.height}) doesn't match image (${originalDimensions.width}x${originalDimensions.height})`);
  }
  
  // 2. Has actual paint (not empty)
  const maskData = maskCanvas.getContext('2d').getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  let whitePixels = 0;
  for (let i = 0; i < maskData.data.length; i += 4) {
    if (maskData.data[i] > 200) whitePixels++;  // Check R channel
  }
  
  const coverage = whitePixels / (maskCanvas.width * maskCanvas.height);
  if (coverage < 0.001) {
    errors.push('Mask appears empty');
  }
  if (coverage > 0.7) {
    errors.push('Too much painted — more than 70% of image');
  }
  
  // 3. Paint is within bounds (not all at edges)
  // ... additional checks
  
  return {
    valid: errors.length === 0,
    errors,
    coverage
  };
}
```

---

## UI: Paint Controls

### Color (Not Purple)
**Recommendation**: Coral `#FF6B6B` with 60% opacity

```javascript
const PAINT_COLOR = 'rgba(255, 107, 107, 0.6)';
```

### Brush Sizes
```javascript
const BRUSH_SIZES = [
  { id: 'small',  size: 20,  label: 'S', icon: '●' },
  { id: 'medium', size: 40,  label: 'M', icon: '⬤' },
  { id: 'large',  size: 70,  label: 'L', icon: '⬮' },
];

const DEFAULT_BRUSH = 'medium';
```

### Component State
```typescript
interface PrepareRoomState {
  // Image
  imageLoaded: boolean;
  originalDimensions: { width: number; height: number } | null;
  displayState: DisplayState | null;
  
  // Drawing
  hasDrawn: boolean;
  currentBrushSize: 'small' | 'medium' | 'large';
  strokes: Stroke[];
  
  // Processing
  isProcessing: boolean;
  processingMessage: string;
  
  // Result
  cleanedImage: string | null;
  error: string | null;
}
```

### Button States
```javascript
function getButtonStates(state) {
  return {
    undo: {
      disabled: state.strokes.length === 0 || state.isProcessing,
      label: 'Undo'
    },
    clear: {
      disabled: state.strokes.length === 0 || state.isProcessing,
      label: 'Clear'  // Or "Erase" to clear all strokes
    },
    primary: {
      disabled: state.isProcessing,
      label: state.hasDrawn ? 'Continue' : 'Skip',
      action: state.hasDrawn ? 'processRemoval' : 'skipToAR'
    }
  };
}
```

### UI Layout
```
┌─────────────────────────────────────────┐
│  ←  PREPARE ROOM                        │
├─────────────────────────────────────────┤
│                                         │
│         ┌───────────────────┐           │
│         │                   │           │
│         │    Room Image     │           │
│         │    + Paint Layer  │           │
│         │                   │           │
│         └───────────────────┘           │
│                                         │
│     "Paint over item to remove"         │
│                                         │
│         [ S ]  [ M ]  [ L ]             │  ← Brush sizes
│                                         │
├─────────────────────────────────────────┤
│  [ Undo ]    [ Clear ]    [ Skip    ]   │  ← Before drawing
│  [ Undo ]    [ Clear ]    [ Continue ]  │  ← After drawing
└─────────────────────────────────────────┘
```

### Brush Size Selector Component
```jsx
function BrushSizeSelector({ currentSize, onChange, disabled }) {
  return (
    <div className="flex justify-center gap-3 my-4">
      {BRUSH_SIZES.map(brush => (
        <button
          key={brush.id}
          onClick={() => onChange(brush.id)}
          disabled={disabled}
          className={`
            w-12 h-12 rounded-full border-2 transition-all
            flex items-center justify-center
            ${currentSize === brush.id 
              ? 'border-coral-500 bg-coral-50 scale-110' 
              : 'border-gray-300 bg-white'}
            ${disabled ? 'opacity-50' : 'hover:border-coral-300'}
          `}
        >
          <span 
            className="text-coral-500"
            style={{ fontSize: brush.size / 3 }}
          >
            ●
          </span>
        </button>
      ))}
    </div>
  );
}
```

---

## Background Loading — Zero Wait to Draw

### The Problem
User selects image → waits → then can draw. Why?

Common causes:
- Waiting for image to upload to server
- Waiting for image to fully decode
- Waiting for canvas to initialize
- Blocking the main thread

### The Solution: Do Everything In Parallel

```javascript
async function onImageSelected(file) {
  // IMMEDIATELY show a low-res preview
  const previewUrl = URL.createObjectURL(file);
  showImagePreview(previewUrl);  // User sees image instantly
  enableDrawing();  // User can start drawing NOW
  
  // In parallel (non-blocking):
  Promise.all([
    // 1. Get full dimensions
    getImageDimensions(file).then(dims => {
      sessionState.original = dims;
      initializeMaskCanvas(dims);  // Hidden canvas at full res
    }),
    
    // 2. Compress for API (if needed) — do this WHILE user draws
    prepareImageForAPI(file).then(prepared => {
      sessionState.preparedImage = prepared;
    }),
    
    // 3. Pre-warm the model connection (optional)
    warmModelConnection()
  ]);
  
  // User is already drawing by now — they never waited
}
```

### Lazy Dimension Detection
```javascript
// Don't block on createImageBitmap — use natural loading
function getImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}
```

### Progressive Enhancement
```javascript
// Start with a guess, refine when actual dimensions load
function initializeDrawingSurface(file) {
  // 1. Immediately: use container size as starting point
  const container = document.getElementById('image-container');
  let estimatedDims = {
    width: container.clientWidth,
    height: container.clientWidth * 0.75  // Assume 4:3 as default
  };
  
  setupCanvasWithDimensions(estimatedDims);
  
  // 2. When actual dimensions load: resize if needed
  getImageDimensions(file).then(actualDims => {
    if (actualDims.width !== estimatedDims.width) {
      resizeCanvasNonDestructively(actualDims);
      // Keep existing strokes, just rescale them
    }
  });
}
```

### What NOT to Do
```javascript
// ❌ BAD: Sequential, blocking
const dims = await getImageDimensions(file);
const prepared = await prepareForAPI(file);
initializeCanvas(dims);
enableDrawing();  // User waited for ALL of this

// ✅ GOOD: Parallel, non-blocking
enableDrawing();  // Immediate
Promise.all([getImageDimensions(file), prepareForAPI(file)]);  // Background
```

---

## Processing States — Simple Text

While the AI is working, show simple rotating messages:

```javascript
const PROCESSING_MESSAGES = [
  "Processing your image...",
  "Identifying object...",
  "Removing item...",
  "Filling in the background...",
  "Almost there..."
];

function ProcessingOverlay({ isProcessing }) {
  const [messageIndex, setMessageIndex] = useState(0);
  
  useEffect(() => {
    if (!isProcessing) return;
    
    const interval = setInterval(() => {
      setMessageIndex(i => (i + 1) % PROCESSING_MESSAGES.length);
    }, 2000);  // Change every 2 seconds
    
    return () => clearInterval(interval);
  }, [isProcessing]);
  
  if (!isProcessing) return null;
  
  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white rounded-2xl p-6 text-center">
        <div className="w-8 h-8 border-3 border-coral-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-700">{PROCESSING_MESSAGES[messageIndex]}</p>
      </div>
    </div>
  );
}
```

### Alternative: Progress-ish Messages
```javascript
// If you want it to feel like progress (even though we don't know actual progress)
const TIMED_MESSAGES = [
  { delay: 0,    text: "Processing your image..." },
  { delay: 1500, text: "Analyzing the room..." },
  { delay: 3000, text: "Removing the item..." },
  { delay: 5000, text: "Filling in details..." },
  { delay: 7000, text: "Almost done..." },
];
```

---

## Complete PrepareRoom Component

```jsx
import React, { useState, useRef, useEffect, useCallback } from 'react';

const BRUSH_SIZES = {
  small: 20,
  medium: 40,
  large: 70
};

const PROCESSING_MESSAGES = [
  "Processing your image...",
  "Identifying object...",
  "Removing item...",
  "Filling in the background...",
  "Almost there..."
];

export function PrepareRoom({ imageFile, onComplete, onSkip, onBack }) {
  // State
  const [imageLoaded, setImageLoaded] = useState(false);
  const [originalDims, setOriginalDims] = useState(null);
  const [displayState, setDisplayState] = useState(null);
  const [brushSize, setBrushSize] = useState('medium');
  const [strokes, setStrokes] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const [error, setError] = useState(null);
  
  // Refs
  const containerRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const imageRef = useRef(null);
  const preparedImageRef = useRef(null);
  
  // Derived state
  const hasDrawn = strokes.length > 0;
  
  // Initialize on image load
  useEffect(() => {
    if (!imageFile) return;
    
    // Show image immediately
    const previewUrl = URL.createObjectURL(imageFile);
    if (imageRef.current) {
      imageRef.current.src = previewUrl;
    }
    
    // Get dimensions and setup canvases
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      setOriginalDims(dims);
      
      // Calculate display size
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const display = calculateDisplaySize(
          dims.width, dims.height,
          containerRect.width, containerRect.height - 100 // Leave room for controls
        );
        setDisplayState(display);
        
        // Initialize mask canvas at ORIGINAL size
        if (maskCanvasRef.current) {
          maskCanvasRef.current.width = dims.width;
          maskCanvasRef.current.height = dims.height;
          const ctx = maskCanvasRef.current.getContext('2d');
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, dims.width, dims.height);
        }
      }
      
      setImageLoaded(true);
      URL.revokeObjectURL(previewUrl);
    };
    img.src = previewUrl;
    
    // Prepare image for API in background
    prepareImageForAPI(imageFile).then(prepared => {
      preparedImageRef.current = prepared;
    });
    
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageFile]);
  
  // Processing message rotation
  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(() => {
      setMessageIndex(i => (i + 1) % PROCESSING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isProcessing]);
  
  // Drawing handlers
  const getCanvasPoint = useCallback((e) => {
    const canvas = displayCanvasRef.current;
    if (!canvas || !displayState) return null;
    
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }, [displayState]);
  
  const startDrawing = useCallback((e) => {
    e.preventDefault();
    const point = getCanvasPoint(e);
    if (!point) return;
    
    setIsDrawing(true);
    setStrokes(prev => [...prev, { 
      points: [point], 
      brushSize: BRUSH_SIZES[brushSize] 
    }]);
  }, [getCanvasPoint, brushSize]);
  
  const draw = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const point = getCanvasPoint(e);
    if (!point) return;
    
    setStrokes(prev => {
      const newStrokes = [...prev];
      const current = newStrokes[newStrokes.length - 1];
      current.points.push(point);
      return newStrokes;
    });
  }, [isDrawing, getCanvasPoint]);
  
  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);
  
  // Render strokes to both canvases
  useEffect(() => {
    if (!displayState || !originalDims) return;
    
    const displayCtx = displayCanvasRef.current?.getContext('2d');
    const maskCtx = maskCanvasRef.current?.getContext('2d');
    if (!displayCtx || !maskCtx) return;
    
    // Clear display canvas
    displayCtx.clearRect(0, 0, displayState.width, displayState.height);
    
    // Clear and reset mask canvas
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, originalDims.width, originalDims.height);
    
    // Draw all strokes
    strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      
      // Display canvas (screen coords)
      displayCtx.strokeStyle = 'rgba(255, 107, 107, 0.6)';
      displayCtx.lineWidth = stroke.brushSize;
      displayCtx.lineCap = 'round';
      displayCtx.lineJoin = 'round';
      displayCtx.beginPath();
      displayCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.forEach(p => displayCtx.lineTo(p.x, p.y));
      displayCtx.stroke();
      
      // Mask canvas (original coords)
      const scale = originalDims.width / displayState.width;
      maskCtx.strokeStyle = 'white';
      maskCtx.lineWidth = stroke.brushSize * scale;
      maskCtx.lineCap = 'round';
      maskCtx.lineJoin = 'round';
      maskCtx.beginPath();
      maskCtx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
      stroke.points.forEach(p => maskCtx.lineTo(p.x * scale, p.y * scale));
      maskCtx.stroke();
    });
  }, [strokes, displayState, originalDims]);
  
  // Actions
  const handleUndo = () => {
    setStrokes(prev => prev.slice(0, -1));
  };
  
  const handleClear = () => {
    setStrokes([]);
  };
  
  const handleContinue = async () => {
    if (!hasDrawn) {
      onSkip();
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    
    try {
      // Get mask as base64
      const maskBase64 = maskCanvasRef.current
        .toDataURL('image/png')
        .split(',')[1];
      
      // Call removal API
      const result = await removeObjectFromRoom(
        preparedImageRef.current,
        maskBase64
      );
      
      onComplete(result);
    } catch (err) {
      setError("Couldn't remove the item. Try painting more of it.");
      setIsProcessing(false);
    }
  };
  
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <button onClick={onBack} className="p-2">
          <ChevronLeftIcon className="w-6 h-6" />
        </button>
        <span className="text-sm font-medium text-gray-500">PREPARE ROOM</span>
        <div className="w-10" /> {/* Spacer */}
      </div>
      
      {/* Image Container */}
      <div 
        ref={containerRef}
        className="flex-1 flex items-center justify-center p-4 bg-gray-50"
      >
        <div 
          className="relative"
          style={displayState ? {
            width: displayState.width,
            height: displayState.height
          } : undefined}
        >
          {/* Room Image */}
          <img
            ref={imageRef}
            className="absolute inset-0 w-full h-full object-contain rounded-lg"
            alt="Room"
          />
          
          {/* Paint Overlay Canvas */}
          {displayState && (
            <canvas
              ref={displayCanvasRef}
              width={displayState.width}
              height={displayState.height}
              className="absolute inset-0 touch-none"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          )}
          
          {/* Hidden Mask Canvas */}
          <canvas ref={maskCanvasRef} className="hidden" />
        </div>
      </div>
      
      {/* Instructions */}
      <p className="text-center text-gray-500 text-sm py-2">
        Paint over the item you want to remove
      </p>
      
      {/* Brush Size Selector */}
      <div className="flex justify-center gap-3 py-2">
        {Object.entries(BRUSH_SIZES).map(([size, pixels]) => (
          <button
            key={size}
            onClick={() => setBrushSize(size)}
            disabled={isProcessing}
            className={`
              w-11 h-11 rounded-full border-2 transition-all
              flex items-center justify-center
              ${brushSize === size 
                ? 'border-[#FF6B6B] bg-red-50 scale-110' 
                : 'border-gray-300 bg-white'}
            `}
          >
            <span 
              className="text-[#FF6B6B]"
              style={{ fontSize: pixels / 4 }}
            >
              ●
            </span>
          </button>
        ))}
      </div>
      
      {/* Error Message */}
      {error && (
        <p className="text-center text-red-500 text-sm py-2">{error}</p>
      )}
      
      {/* Action Buttons */}
      <div className="flex gap-3 p-4 border-t">
        <button
          onClick={handleUndo}
          disabled={!hasDrawn || isProcessing}
          className="flex-1 py-3 rounded-full border border-gray-300 text-gray-700 disabled:opacity-50"
        >
          Undo
        </button>
        <button
          onClick={handleClear}
          disabled={!hasDrawn || isProcessing}
          className="flex-1 py-3 rounded-full border border-gray-300 text-gray-700 disabled:opacity-50"
        >
          Clear
        </button>
        <button
          onClick={handleContinue}
          disabled={isProcessing}
          className="flex-1 py-3 rounded-full bg-black text-white disabled:opacity-50"
        >
          {hasDrawn ? 'Continue' : 'Skip'}
        </button>
      </div>
      
      {/* Processing Overlay */}
      {isProcessing && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 mx-4 text-center">
            <div className="w-8 h-8 border-3 border-[#FF6B6B] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-700">{PROCESSING_MESSAGES[messageIndex]}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions
function calculateDisplaySize(origW, origH, containerW, containerH) {
  const imageAspect = origW / origH;
  const containerAspect = containerW / containerH;
  
  let width, height;
  if (imageAspect > containerAspect) {
    width = containerW;
    height = containerW / imageAspect;
  } else {
    height = containerH;
    width = containerH * imageAspect;
  }
  
  return { width: Math.round(width), height: Math.round(height) };
}

async function prepareImageForAPI(file) {
  // Compress if needed, return base64
  // ... implementation
}

async function removeObjectFromRoom(imageBase64, maskBase64) {
  // API call
  // ... implementation
}
```

---

## Recommended Stack

### Primary: Gemini 2.5 Flash Image
- **Why**: Fastest, cheapest (~$0.039/image), understands "what object is this" from rough paint
- **Model**: `gemini-2.5-flash-preview-0514` or latest

### Fallback: Gemini 2.5 Flash (non-image variant) + Imagen
- Only if Flash Image is down or quality is consistently poor

**Don't use Imagen 3 directly** — it requires precise masks which defeats the "paint roughly" UX.

---

## Mask Generation (From User Paint Strokes)

The user's rough paint strokes become a "hint" for the AI, not a precise mask.

### Two-Stage Approach

**Stage 1: Convert paint to hint mask**
```javascript
function createHintMask(paintStrokes, imageSize) {
  const canvas = createCanvas(imageSize.width, imageSize.height);
  const ctx = canvas.getContext('2d');
  
  // Fill black (preserve everything by default)
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, imageSize.width, imageSize.height);
  
  // Draw user's strokes in white
  ctx.strokeStyle = 'white';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  for (const stroke of paintStrokes) {
    ctx.lineWidth = stroke.brushSize;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  
  // Slight expansion to be generous with coverage
  const expanded = expandMask(canvas, 8); // 8px expansion
  
  return expanded.toBuffer('image/png');
}
```

**Stage 2: AI interprets and removes**
The prompt tells Gemini to figure out what object the user meant:

```javascript
const SMART_REMOVAL_PROMPT = `You are removing furniture from a room photo for AR furniture visualization.

The customer has painted over an object they want removed. The white area in the mask shows approximately where they painted.

YOUR TASK:
1. Identify what object/furniture the customer is trying to remove based on their paint strokes
2. Remove the ENTIRE object (not just the painted area) — include legs, shadows, any parts they missed
3. Fill the space with matching floor and wall textures

REQUIREMENTS:
- Remove the complete object, even if only partially painted
- Maintain exact room perspective and lighting  
- Keep the same aspect ratio and dimensions
- Create a clean, empty space for AR furniture placement
- Seamless texture transitions

The customer will place new furniture where the removed object was.`;
```

### Why This Works Better Than Precise Masks
- Users don't have to be precise — rough scribbles work
- AI understands "I painted over the nightstand" even if they missed the lamp on top
- Handles shadows and reflections the user didn't think to paint
- More forgiving UX for older demographics (BHM's audience)

---

## Debugging Mask Alignment Issues

### Visual Debug Mode
During development, render the mask visibly to catch alignment issues:

```javascript
function debugShowMask(maskCanvas, displayCanvas) {
  const displayCtx = displayCanvas.getContext('2d');
  const maskData = maskCanvas.toDataURL('image/png');
  
  const debugImg = new Image();
  debugImg.onload = () => {
    // Draw mask semi-transparent over the display
    displayCtx.globalAlpha = 0.5;
    displayCtx.drawImage(debugImg, 0, 0, displayCanvas.width, displayCanvas.height);
    displayCtx.globalAlpha = 1;
  };
  debugImg.src = maskData;
}

// Add a debug button in dev mode
{process.env.NODE_ENV === 'development' && (
  <button onClick={() => debugShowMask(maskCanvasRef.current, displayCanvasRef.current)}>
    Debug: Show Mask
  </button>
)}
```

### Common Mask Issues & Fixes

**Issue: Mask appears offset**
```javascript
// WRONG: Using canvas position instead of relative position
const x = e.clientX;  // Wrong - includes page scroll and offset

// RIGHT: Get position relative to canvas
const rect = canvas.getBoundingClientRect();
const x = e.clientX - rect.left;
const y = e.clientY - rect.top;
```

**Issue: Mask is scaled wrong**
```javascript
// WRONG: Mask canvas same size as display canvas
maskCanvas.width = displayCanvas.width;  // Wrong if display is scaled

// RIGHT: Mask canvas matches ORIGINAL image size
maskCanvas.width = originalDimensions.width;
maskCanvas.height = originalDimensions.height;
```

**Issue: Touch events give wrong coordinates**
```javascript
// WRONG: Using e.clientX for touch
const x = e.clientX;  // Undefined for touch events

// RIGHT: Handle both mouse and touch
const clientX = e.touches ? e.touches[0].clientX : e.clientX;
const clientY = e.touches ? e.touches[0].clientY : e.clientY;
```

**Issue: Retina/HiDPI displays cause offset**
```javascript
// Account for device pixel ratio
const dpr = window.devicePixelRatio || 1;

// When setting up canvas for crisp rendering:
canvas.width = displayWidth * dpr;
canvas.height = displayHeight * dpr;
canvas.style.width = displayWidth + 'px';
canvas.style.height = displayHeight + 'px';
ctx.scale(dpr, dpr);

// But for mask generation, DON'T apply DPR - use original dimensions
```

### Mask Validation Checklist
Before sending to API, verify:

```javascript
function validateMaskForAPI(maskCanvas, originalImage) {
  const checks = {
    dimensionsMatch: maskCanvas.width === originalImage.width && 
                     maskCanvas.height === originalImage.height,
    hasContent: checkMaskHasWhitePixels(maskCanvas),
    notTooMuch: checkMaskCoverage(maskCanvas) < 0.7,
    notTooLittle: checkMaskCoverage(maskCanvas) > 0.001,
  };
  
  console.log('Mask validation:', checks);
  
  if (!checks.dimensionsMatch) {
    console.error(`Dimension mismatch! Mask: ${maskCanvas.width}x${maskCanvas.height}, Image: ${originalImage.width}x${originalImage.height}`);
  }
  
  return Object.values(checks).every(Boolean);
}
```

### The Nuclear Option: Generate Mask Server-Side
If client-side mask generation keeps failing, generate it on the server:

```javascript
// Client sends: stroke data + display dimensions + original dimensions
const payload = {
  strokes: strokes.map(s => ({
    points: s.points,
    brushSize: s.brushSize
  })),
  displaySize: { width: displayState.width, height: displayState.height },
  originalSize: { width: originalDims.width, height: originalDims.height }
};

// Server generates the mask with guaranteed correct dimensions
// This removes all client-side canvas issues
```

---

## API Call (Production Code)

```javascript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function removeObjectFromRoom(roomImageBase64, hintMaskBase64) {
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-preview-0514",
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    }
  });

  const prompt = `You are removing furniture from a room photo for AR furniture visualization.

The customer has painted over an object they want removed. The white area in the mask shows approximately where they painted.

YOUR TASK:
1. Identify what object/furniture the customer is trying to remove based on their paint strokes
2. Remove the ENTIRE object (not just the painted area) — include legs, shadows, any parts they missed
3. Fill the space with matching floor and wall textures

REQUIREMENTS:
- Remove the complete object, even if only partially painted
- Maintain exact room perspective and lighting  
- Keep the same aspect ratio and dimensions
- Create a clean, empty space for furniture placement
- Seamless texture transitions at edges

Do not alter anything that isn't part of the object being removed.`;

  const result = await model.generateContent({
    contents: [{
      role: "user",
      parts: [
        { text: "ROOM IMAGE:" },
        { inlineData: { mimeType: "image/jpeg", data: roomImageBase64 } },
        { text: "PAINT MASK (white = what customer painted over):" },
        { inlineData: { mimeType: "image/png", data: hintMaskBase64 } },
        { text: prompt }
      ]
    }]
  });

  // Extract the image from response
  const response = result.response;
  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return part.inlineData.data; // base64 image
    }
  }
  
  throw new Error("No image in response");
}
```

---

## Pre-Processing (Before API Call)

```javascript
async function prepareForCleanup(originalImage) {
  // 1. Check file size — compress if too large
  const MAX_SIZE = 1.5 * 1024 * 1024; // 1.5MB (leave headroom)
  
  let processedImage = originalImage;
  if (originalImage.size > MAX_SIZE) {
    processedImage = await compressImage(originalImage, {
      quality: 0.85,
      maxWidth: 2048,
      maxHeight: 2048
    });
  }
  
  // 2. Store original dimensions for post-processing
  const dimensions = await getImageDimensions(processedImage);
  
  // 3. Convert to base64
  const base64 = await imageToBase64(processedImage);
  
  return { base64, dimensions, original: originalImage };
}
```

### Why Compress First?
- Gemini compresses large images anyway (quality loss)
- Better to control the compression ourselves
- Faster upload/response times

---

## Post-Processing (After API Response)

```javascript
async function finalizeCleanedRoom(originalImage, cleanedImage, mask, originalDimensions) {
  // 1. Resize output to match input exactly
  const resized = await resizeImage(cleanedImage, originalDimensions);
  
  // 2. Composite: Lock pixels OUTSIDE the mask
  // This ensures only the masked area changes
  const final = await compositeWithMask(originalImage, resized, mask);
  
  return final;
}

async function compositeWithMask(original, edited, mask) {
  // Use canvas or sharp
  // Where mask is BLACK → use original pixels
  // Where mask is WHITE → use edited pixels
  // Blend at feathered edges
  
  const canvas = createCanvas(original.width, original.height);
  const ctx = canvas.getContext('2d');
  
  // Draw original
  ctx.drawImage(original, 0, 0);
  
  // Apply edited region using mask as alpha
  ctx.globalCompositeOperation = 'source-over';
  // ... composite logic with mask
  
  return canvas.toBuffer('image/jpeg', { quality: 0.92 });
}
```

### Why Composite?
- Gemini sometimes changes pixels outside the mask
- Compositing guarantees original quality in untouched areas
- Eliminates any aspect ratio drift

---

## Error Handling & Retries

```javascript
async function removeObjectWithRetry(roomImage, mask, maxRetries = 2) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await removeObjectFromRoom(roomImage, mask);
      
      // Quick quality check
      if (await isResultAcceptable(result)) {
        return result;
      }
      
      // If quality poor, retry with enhanced prompt
      if (attempt < maxRetries) {
        console.log(`Quality check failed, retry ${attempt + 1}`);
        continue;
      }
      
    } catch (error) {
      lastError = error;
      
      // Specific error handling
      if (error.message.includes('SAFETY')) {
        // Content filter triggered - simplify prompt
        return await removeObjectSimplified(roomImage, mask);
      }
      
      if (error.message.includes('timeout')) {
        // Increase timeout and retry
        continue;
      }
    }
  }
  
  throw lastError || new Error('Object removal failed after retries');
}

async function isResultAcceptable(resultImage) {
  // Basic checks:
  // - Image exists and has content
  // - Dimensions roughly match expected
  // - File size is reasonable (not a tiny error image)
  
  const size = Buffer.byteLength(resultImage, 'base64');
  return size > 50000; // At least 50KB
}
```

---

## Speed Optimizations

### 1. Parallel Mask Generation
```javascript
// Don't wait for mask to start preparing image
const [preparedImage, mask] = await Promise.all([
  prepareForCleanup(originalImage),
  generateMask(originalImage, userSelection)
]);
```

### 2. Stream Response (If Supported)
```javascript
// Use streaming to get first bytes faster
const result = await model.generateContentStream({...});
```

### 3. Warm Connection
```javascript
// Keep model instance warm between requests
let modelInstance = null;

function getModel() {
  if (!modelInstance) {
    modelInstance = genAI.getGenerativeModel({...});
  }
  return modelInstance;
}
```

### 4. Optimistic UI
```javascript
// Show "cleaning..." state immediately
// Display result as soon as available
// Don't wait for post-processing to show preview
```

---

## Common Room Scenarios

### Removing a Bedside Table + Lamp (like your screenshot)
```
User paints: Rough strokes over the nightstand area
AI interprets: "They want the nightstand AND the lamp on top removed"
Challenge: Multiple items as one logical unit
```
**The AI should get this** — it sees paint over furniture area and removes the whole unit.

### Removing a Sofa/Chair
```
User paints: Scribbles across the seat cushions
AI interprets: "Remove the entire sofa including arms, legs, and shadow"
Expected time: 4-6 seconds
```
**Tip**: If AI misses the legs, user can paint over them and re-run.

### Removing a Coffee Table
```
User paints: Quick marks on the tabletop
AI interprets: "Remove entire table including items on top"
Expected time: 3-5 seconds
```
**Edge case**: If there's a rug underneath, AI should reveal it.

### User Paints Too Much (hits the bed AND the nightstand)
```
AI behavior: May remove both, or pick the more obvious one
Solution: Prompt refinement — "Remove the object that is MOST covered by the paint strokes"
```

### User Paints Too Little (tiny dot on a big sofa)
```
AI behavior: Should still identify the sofa as target
Fallback: If it fails, show error "Paint more of the object you want to remove"
```

---

## Quality Checklist (Automated)

```javascript
async function validateCleanupResult(original, cleaned, mask) {
  const issues = [];
  
  // 1. Dimension check
  const origDim = await getImageDimensions(original);
  const cleanDim = await getImageDimensions(cleaned);
  if (origDim.width !== cleanDim.width || origDim.height !== cleanDim.height) {
    issues.push('dimension_mismatch');
  }
  
  // 2. File size sanity (shouldn't be tiny or huge)
  const cleanedSize = Buffer.byteLength(cleaned, 'base64');
  if (cleanedSize < 30000) issues.push('too_small');
  if (cleanedSize > 10000000) issues.push('too_large');
  
  // 3. Could add: edge detection at mask boundary
  // 4. Could add: color histogram comparison outside mask
  
  return {
    valid: issues.length === 0,
    issues
  };
}
```

---

## Prompt Variations by Surface Type

### Hardwood Floor
```
"Fill with matching hardwood flooring. Continue the plank direction and wood grain pattern."
```

### Carpet
```
"Fill with matching carpet texture and pile direction."
```

### Tile
```
"Fill with matching tile pattern. Align grout lines with existing grid."
```

### Concrete/Polished
```
"Fill with matching concrete floor. Maintain the surface sheen and any subtle variations."
```

---

## Fallback: Simplified Prompt

If the detailed prompt triggers safety filters or fails:

```javascript
const SIMPLE_PROMPT = `The customer painted over furniture they want removed (white areas in mask).
Remove that piece of furniture completely.
Fill the space with the floor and wall behind it.
Keep image dimensions exactly the same.`;
```

## Handling Ambiguous Paint Strokes

If the AI seems confused about what to remove:

```javascript
const DISAMBIGUATION_PROMPT = `The customer painted over something they want removed.

Looking at WHERE they painted:
- Identify the single piece of furniture MOST covered by the white paint strokes
- Remove ONLY that one item completely
- If paint touches multiple items, choose the one with the most paint coverage

Fill the space with matching floor/wall textures.
Maintain exact perspective and dimensions.`;
```

---

## Metrics to Track

```javascript
// Log these for optimization
const metrics = {
  originalSize: originalImage.size,
  compressedSize: preparedImage.size,
  maskCoverage: calculateMaskPercentage(mask),
  apiResponseTime: endTime - startTime,
  postProcessTime: finalTime - endTime,
  retryCount: attempts,
  success: true/false,
  qualityScore: 0-100 // if you implement scoring
};
```

**Key targets:**
- API response: < 5 seconds
- Total flow: < 8 seconds
- Success rate: > 95%
- Retry rate: < 10%

---

## Quick Reference

| Step | Action | Time Target |
|------|--------|-------------|
| 1 | Compress image if > 1.5MB | 200ms |
| 2 | Generate mask from selection | 300ms |
| 3 | API call to Gemini | 4-6s |
| 4 | Composite result with original | 200ms |
| 5 | Return to AR view | immediate |

**Total: ~5-7 seconds typical**

---

## Environment Variables

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash-preview-0514
CLEANUP_TIMEOUT_MS=60000
MAX_IMAGE_SIZE_MB=1.5
ENABLE_RETRY=true
MAX_RETRIES=2
```

---

*Optimized for See It Shopify AR App*
*Target: Fast room cleanup for furniture visualization*
