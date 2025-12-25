import { useState, useRef, useEffect, useCallback } from "react";

/**
 * PrepareRoom Component
 *
 * Allows customers to paint over furniture they want removed from their room photo
 * before placing AR furniture. Sends mask to AI for object removal.
 *
 * Critical invariants (from SEE_IT_ROOM_CLEANUP_GUIDE.md):
 * - NEVER stretch images (maintain original aspect ratio)
 * - Mask canvas MUST match original image dimensions
 * - Display canvas matches screen size, coordinates converted for mask
 * - Zero wait to draw (show image immediately)
 */

// Brush sizes in screen pixels (will be scaled for mask)
const BRUSH_SIZES = {
  small: 20,
  medium: 40,
  large: 70,
};

// Paint color: coral with 60% opacity
const PAINT_COLOR = "rgba(255, 107, 107, 0.6)";

// Processing messages that rotate while AI works
const PROCESSING_MESSAGES = [
  "Processing your image...",
  "Identifying object...",
  "Removing item...",
  "Filling in the background...",
  "Almost there...",
];

// Enable debug mode via URL param or prop
const DEBUG_MODE = typeof window !== 'undefined' &&
  (window.location?.search?.includes('debug=true') || window.location?.search?.includes('debug=mask'));

/**
 * Calculate display size to fit image in container without stretching
 * Returns display dimensions and scale factor for coordinate conversion
 */
function calculateDisplaySize(origW, origH, containerW, containerH) {
  const imageAspect = origW / origH;
  const containerAspect = containerW / containerH;

  let width, height;
  if (imageAspect > containerAspect) {
    // Image is wider than container - fit to width
    width = containerW;
    height = containerW / imageAspect;
  } else {
    // Image is taller than container - fit to height
    height = containerH;
    width = containerH * imageAspect;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
    scale: width / origW, // CRITICAL: save for coordinate conversion
  };
}

/**
 * Validate mask has actual content (white pixels)
 */
function validateMask(canvas) {
  if (!canvas) return { valid: false, error: "No canvas" };

  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let whitePixels = 0;
  const totalPixels = canvas.width * canvas.height;

  // Check R channel (for white pixels, R should be > 200)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200) {
      whitePixels++;
    }
  }

  const coverage = whitePixels / totalPixels;

  console.log(`[PrepareRoom] Mask validation:`, {
    dimensions: `${canvas.width}x${canvas.height}`,
    whitePixels,
    totalPixels,
    coverage: `${(coverage * 100).toFixed(2)}%`,
  });

  if (whitePixels === 0) {
    return { valid: false, error: "Mask is empty (no white pixels)", coverage: 0 };
  }

  if (coverage > 0.7) {
    return { valid: false, error: "Too much painted (>70% of image)", coverage };
  }

  if (coverage < 0.001) {
    return { valid: false, error: "Mask too small (<0.1% of image)", coverage };
  }

  return { valid: true, coverage };
}

export function PrepareRoom({
  imageFile,        // File object or Blob of the room image
  imageUrl,         // Alternative: URL to the room image
  roomSessionId,    // ID for the room session (for API calls)
  onComplete,       // Called with cleaned image URL after AI removes object
  onSkip,           // Called when user skips without painting
  onBack,           // Called when user wants to go back
  apiEndpoint = "/apps/see-it/room/cleanup", // Cleanup API endpoint
  debug = DEBUG_MODE, // Enable debug mode
}) {
  // === STATE ===
  const [imageLoaded, setImageLoaded] = useState(false);
  const [originalDims, setOriginalDims] = useState(null); // { width, height }
  const [displayState, setDisplayState] = useState(null); // { width, height, scale }
  const [brushSize, setBrushSize] = useState("medium");
  const [strokes, setStrokes] = useState([]); // Array of { points: [], brushSize }
  const [isDrawing, setIsDrawing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const [error, setError] = useState(null);
  const [showDebugMask, setShowDebugMask] = useState(false);

  // === REFS ===
  const containerRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const imageRef = useRef(null);
  const imgElementRef = useRef(null);

  // === DERIVED STATE ===
  const hasDrawn = strokes.length > 0;

  // === INITIALIZE MASK CANVAS (separate effect for reliability) ===
  useEffect(() => {
    if (!originalDims || !maskCanvasRef.current) return;

    const canvas = maskCanvasRef.current;

    // Only initialize if dimensions changed
    if (canvas.width !== originalDims.width || canvas.height !== originalDims.height) {
      console.log(`[PrepareRoom] Initializing mask canvas: ${originalDims.width}x${originalDims.height}`);
      canvas.width = originalDims.width;
      canvas.height = originalDims.height;

      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, originalDims.width, originalDims.height);
    }
  }, [originalDims]);

  // === IMAGE LOADING ===
  useEffect(() => {
    if (!imageFile && !imageUrl) return;

    // Create preview URL for immediate display
    const previewUrl = imageFile ? URL.createObjectURL(imageFile) : imageUrl;

    console.log(`[PrepareRoom] Loading image from:`, imageFile ? 'File' : imageUrl?.substring(0, 50) + '...');

    // Load image to get dimensions
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      console.log(`[PrepareRoom] Image loaded: ${dims.width}x${dims.height}`);
      setOriginalDims(dims);
      imageRef.current = img;

      // Calculate display size based on container
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        // Leave space for controls (instruction text, brush selector, buttons)
        const availableHeight = containerRect.height - 180;
        const display = calculateDisplaySize(
          dims.width,
          dims.height,
          containerRect.width - 32, // Padding
          Math.max(200, availableHeight)
        );
        console.log(`[PrepareRoom] Display size: ${display.width}x${display.height}, scale: ${display.scale}`);
        setDisplayState(display);
      }

      setImageLoaded(true);
    };

    img.onerror = (e) => {
      console.error(`[PrepareRoom] Failed to load image:`, e);
      setError("Failed to load image. Please try again.");
    };

    img.src = previewUrl;

    // Set the image element source for display
    if (imgElementRef.current) {
      imgElementRef.current.src = previewUrl;
    }

    // Cleanup
    return () => {
      if (imageFile) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [imageFile, imageUrl]);

  // === PROCESSING MESSAGE ROTATION ===
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % PROCESSING_MESSAGES.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [isProcessing]);

  // === COORDINATE CONVERSION (Critical for mask alignment!) ===
  const getCanvasPoint = useCallback(
    (e) => {
      const canvas = displayCanvasRef.current;
      if (!canvas || !displayState) return null;

      const rect = canvas.getBoundingClientRect();

      // Handle both mouse and touch events
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      // Get position relative to canvas (screen coordinates)
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    [displayState]
  );

  // Convert screen coordinates to original image coordinates
  const screenToOriginal = useCallback(
    (screenX, screenY) => {
      if (!displayState || !originalDims) return { x: 0, y: 0 };

      // Scale up to original dimensions
      const scale = originalDims.width / displayState.width;
      return {
        x: screenX * scale,
        y: screenY * scale,
      };
    },
    [displayState, originalDims]
  );

  // === DRAWING HANDLERS ===
  const startDrawing = useCallback(
    (e) => {
      if (isProcessing || !displayState) return;
      e.preventDefault();

      const point = getCanvasPoint(e);
      if (!point) return;

      setIsDrawing(true);
      setStrokes((prev) => [
        ...prev,
        {
          points: [point],
          brushSize: BRUSH_SIZES[brushSize],
        },
      ]);
    },
    [isProcessing, displayState, getCanvasPoint, brushSize]
  );

  const draw = useCallback(
    (e) => {
      if (!isDrawing || !displayState) return;
      e.preventDefault();

      const point = getCanvasPoint(e);
      if (!point) return;

      setStrokes((prev) => {
        const newStrokes = [...prev];
        const current = newStrokes[newStrokes.length - 1];
        if (current) {
          current.points.push(point);
        }
        return newStrokes;
      });
    },
    [isDrawing, displayState, getCanvasPoint]
  );

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // === RENDER STROKES TO BOTH CANVASES ===
  useEffect(() => {
    if (!displayState || !originalDims) return;

    const displayCanvas = displayCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!displayCanvas || !maskCanvas) return;

    // Ensure mask canvas has correct dimensions
    if (maskCanvas.width !== originalDims.width || maskCanvas.height !== originalDims.height) {
      console.log(`[PrepareRoom] Re-initializing mask canvas: ${originalDims.width}x${originalDims.height}`);
      maskCanvas.width = originalDims.width;
      maskCanvas.height = originalDims.height;
    }

    const displayCtx = displayCanvas.getContext("2d");
    const maskCtx = maskCanvas.getContext("2d");

    // Clear display canvas
    displayCtx.clearRect(0, 0, displayState.width, displayState.height);

    // Reset mask canvas to black (preserve all)
    maskCtx.fillStyle = "black";
    maskCtx.fillRect(0, 0, originalDims.width, originalDims.height);

    // Draw all strokes
    strokes.forEach((stroke, strokeIndex) => {
      if (stroke.points.length < 1) return;

      // === DISPLAY CANVAS (screen coordinates) ===
      displayCtx.strokeStyle = PAINT_COLOR;
      displayCtx.fillStyle = PAINT_COLOR;
      displayCtx.lineWidth = stroke.brushSize;
      displayCtx.lineCap = "round";
      displayCtx.lineJoin = "round";

      if (stroke.points.length === 1) {
        // Single point - draw a circle
        displayCtx.beginPath();
        displayCtx.arc(
          stroke.points[0].x,
          stroke.points[0].y,
          stroke.brushSize / 2,
          0,
          Math.PI * 2
        );
        displayCtx.fill();
      } else {
        // Multiple points - draw a path
        displayCtx.beginPath();
        displayCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        stroke.points.forEach((p) => displayCtx.lineTo(p.x, p.y));
        displayCtx.stroke();
      }

      // === MASK CANVAS (original coordinates) ===
      const scale = originalDims.width / displayState.width;
      const originalBrushSize = stroke.brushSize * scale;

      maskCtx.strokeStyle = "white"; // White = remove
      maskCtx.fillStyle = "white";
      maskCtx.lineWidth = originalBrushSize;
      maskCtx.lineCap = "round";
      maskCtx.lineJoin = "round";

      if (stroke.points.length === 1) {
        // Single point
        const origPoint = screenToOriginal(stroke.points[0].x, stroke.points[0].y);
        maskCtx.beginPath();
        maskCtx.arc(
          origPoint.x,
          origPoint.y,
          originalBrushSize / 2,
          0,
          Math.PI * 2
        );
        maskCtx.fill();
      } else {
        // Multiple points
        maskCtx.beginPath();
        const firstOriginal = screenToOriginal(stroke.points[0].x, stroke.points[0].y);
        maskCtx.moveTo(firstOriginal.x, firstOriginal.y);
        stroke.points.forEach((p) => {
          const orig = screenToOriginal(p.x, p.y);
          maskCtx.lineTo(orig.x, orig.y);
        });
        maskCtx.stroke();
      }
    });

    // Debug: log stroke info
    if (debug && strokes.length > 0) {
      console.log(`[PrepareRoom] Rendered ${strokes.length} strokes to mask`);
    }
  }, [strokes, displayState, originalDims, screenToOriginal, debug]);

  // === DEBUG: Show Mask Overlay ===
  const toggleDebugMask = useCallback(() => {
    setShowDebugMask((prev) => !prev);
  }, []);

  // === ACTIONS ===
  const handleUndo = useCallback(() => {
    setStrokes((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setStrokes([]);
  }, []);

  const handleContinue = useCallback(async () => {
    if (!hasDrawn) {
      onSkip?.();
      return;
    }

    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !originalDims) {
      setError("Canvas not ready. Please try again.");
      return;
    }

    // Validate mask has content
    const validation = validateMask(maskCanvas);
    if (!validation.valid) {
      console.error(`[PrepareRoom] Mask validation failed:`, validation.error);
      setError(validation.error || "Please paint over the item you want to remove.");
      return;
    }

    // Validate mask dimensions match original
    if (maskCanvas.width !== originalDims.width || maskCanvas.height !== originalDims.height) {
      console.error(`[PrepareRoom] Mask dimension mismatch:`, {
        mask: `${maskCanvas.width}x${maskCanvas.height}`,
        original: `${originalDims.width}x${originalDims.height}`,
      });
      setError("Mask dimension error. Please try again.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Get mask as data URL (PNG format)
      const maskDataUrl = maskCanvas.toDataURL("image/png");

      console.log(`[PrepareRoom] Sending cleanup request:`, {
        roomSessionId,
        maskDimensions: `${maskCanvas.width}x${maskCanvas.height}`,
        maskDataUrlLength: maskDataUrl.length,
        coverage: `${(validation.coverage * 100).toFixed(2)}%`,
      });

      // Call cleanup API
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_session_id: roomSessionId,
          mask_data_url: maskDataUrl,
        }),
      });

      const data = await response.json();

      console.log(`[PrepareRoom] API response:`, {
        ok: response.ok,
        status: data.status,
        hasCleanedUrl: !!(data.cleaned_room_image_url || data.cleanedRoomImageUrl),
      });

      if (!response.ok || data.status === "failed") {
        throw new Error(data.message || data.error || "Failed to remove object");
      }

      // Success! Pass cleaned image URL to parent
      const cleanedImageUrl = data.cleaned_room_image_url || data.cleanedRoomImageUrl;
      if (!cleanedImageUrl) {
        throw new Error("No cleaned image URL in response");
      }

      onComplete?.(cleanedImageUrl);
    } catch (err) {
      console.error("[PrepareRoom] Cleanup failed:", err);
      setError(
        err.message || "Couldn't remove the item. Try painting more of it."
      );
      setIsProcessing(false);
    }
  }, [hasDrawn, originalDims, roomSessionId, apiEndpoint, onComplete, onSkip]);

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <button
          onClick={onBack}
          className="p-2 -ml-2 text-gray-600 hover:text-gray-900"
          disabled={isProcessing}
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span className="text-sm font-medium text-gray-500 tracking-wide">
          PREPARE ROOM
        </span>
        {/* Debug toggle */}
        {debug ? (
          <button
            onClick={toggleDebugMask}
            className="text-xs text-blue-600 underline"
          >
            {showDebugMask ? "Hide Mask" : "Show Mask"}
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      {/* Image Container */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center p-4 bg-gray-50 overflow-hidden"
      >
        <div
          className="relative"
          style={
            displayState
              ? {
                  width: displayState.width,
                  height: displayState.height,
                }
              : undefined
          }
        >
          {/* Room Image (underneath canvas) */}
          <img
            ref={imgElementRef}
            className="absolute inset-0 w-full h-full object-contain rounded-lg"
            alt="Room"
            style={{ pointerEvents: "none" }}
          />

          {/* Paint Overlay Canvas (on top of image) */}
          {displayState && (
            <canvas
              ref={displayCanvasRef}
              width={displayState.width}
              height={displayState.height}
              className="absolute inset-0 touch-none cursor-crosshair rounded-lg"
              style={{ touchAction: "none" }}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          )}

          {/* Hidden Mask Canvas (original dimensions) */}
          <canvas ref={maskCanvasRef} style={{ display: "none" }} />

          {/* Debug: Mask Visualization Overlay */}
          {debug && showDebugMask && maskCanvasRef.current && displayState && (
            <div
              className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden"
              style={{ opacity: 0.5 }}
            >
              <img
                src={maskCanvasRef.current.toDataURL()}
                alt="Mask debug"
                className="w-full h-full object-contain"
                style={{ filter: "invert(1)" }} // Invert so white shows as visible
              />
            </div>
          )}

          {/* Loading placeholder */}
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-lg min-h-[200px] min-w-[200px]">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Debug Info */}
      {debug && originalDims && displayState && (
        <div className="text-xs text-gray-500 text-center py-1 bg-yellow-50">
          Original: {originalDims.width}x{originalDims.height} |
          Display: {displayState.width}x{displayState.height} |
          Scale: {displayState.scale.toFixed(3)} |
          Strokes: {strokes.length}
        </div>
      )}

      {/* Instructions */}
      <p className="text-center text-gray-500 text-sm py-2 px-4">
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
              ${
                brushSize === size
                  ? "border-[#FF6B6B] bg-red-50 scale-110"
                  : "border-gray-300 bg-white hover:border-gray-400"
              }
              ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}
            `}
            aria-label={`${size} brush`}
          >
            <span
              className="text-[#FF6B6B]"
              style={{ fontSize: Math.max(8, pixels / 4) }}
            >
              ●
            </span>
          </button>
        ))}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-center text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 p-4 border-t border-gray-200">
        <button
          onClick={handleUndo}
          disabled={!hasDrawn || isProcessing}
          className={`
            flex-1 py-3 rounded-full border border-gray-300 text-gray-700
            transition-colors
            ${
              !hasDrawn || isProcessing
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-gray-50 active:bg-gray-100"
            }
          `}
        >
          Undo
        </button>
        <button
          onClick={handleClear}
          disabled={!hasDrawn || isProcessing}
          className={`
            flex-1 py-3 rounded-full border border-gray-300 text-gray-700
            transition-colors
            ${
              !hasDrawn || isProcessing
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-gray-50 active:bg-gray-100"
            }
          `}
        >
          Clear
        </button>
        <button
          onClick={handleContinue}
          disabled={isProcessing}
          className={`
            flex-1 py-3 rounded-full bg-black text-white font-medium
            transition-colors
            ${
              isProcessing
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-gray-800 active:bg-gray-900"
            }
          `}
        >
          {hasDrawn ? "Continue" : "Skip"}
        </button>
      </div>

      {/* Processing Overlay */}
      {isProcessing && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 mx-4 text-center shadow-xl max-w-xs">
            <div className="w-10 h-10 border-3 border-[#FF6B6B] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-700 font-medium">
              {PROCESSING_MESSAGES[messageIndex]}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PrepareRoom;
