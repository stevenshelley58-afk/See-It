import { useRef, useEffect, useState, useCallback } from "react";
import { InlineStack, Button, Text, RangeSlider, BlockStack, Badge } from "@shopify/polaris";
import MagicWand from "magic-wand-tool";

/**
 * AssistedBrushCanvas - Smart brush for refining background removal
 *
 * Two modes like Canva/Photoroom:
 * 1. ASSISTED MODE (default): Click on area → detects similar colors → applies action
 * 2. MANUAL MODE: Paint directly with brush
 *
 * Actions:
 * - RESTORE: Bring back areas that were incorrectly removed
 * - ERASE: Remove areas that should be transparent
 */
export function AssistedBrushCanvas({
    originalImageUrl,
    processedImageUrl,
    width = 500,
    height = 450,
    onRefinedImage,
    disabled = false,
}) {
    // Refs
    const displayCanvasRef = useRef(null);
    const originalCanvasRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const containerRef = useRef(null);

    // Image refs
    const originalImgRef = useRef(null);
    const processedImgRef = useRef(null);

    // State
    const [imagesLoaded, setImagesLoaded] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [isDrawing, setIsDrawing] = useState(false);

    // Tool state
    const [action, setAction] = useState("restore"); // "restore" | "erase"
    const [mode, setMode] = useState("assisted"); // "assisted" | "manual"
    const [tolerance, setTolerance] = useState(32); // 0-255 for color matching
    const [brushSize, setBrushSize] = useState(20);

    // Preview state for assisted mode
    const [previewMask, setPreviewMask] = useState(null);
    
    // Throttle ref for hover preview
    const lastHoverTimeRef = useRef(0);
    const HOVER_THROTTLE_MS = 50; // Limit hover updates to ~20fps
    
    // Pre-rendered checkerboard pattern (cached)
    const checkerPatternRef = useRef(null);

    // Load images
    useEffect(() => {
        if (!originalImageUrl || !processedImageUrl) return;

        setImagesLoaded(false);
        let loadedCount = 0;

        const checkLoaded = () => {
            loadedCount++;
            if (loadedCount === 2) {
                const img = originalImgRef.current;
                const aspectRatio = img.width / img.height;
                let displayWidth = width;
                let displayHeight = width / aspectRatio;

                if (displayHeight > height) {
                    displayHeight = height;
                    displayWidth = height * aspectRatio;
                }

                setDimensions({
                    width: Math.round(displayWidth),
                    height: Math.round(displayHeight),
                    naturalWidth: img.width,
                    naturalHeight: img.height,
                });
                setImagesLoaded(true);
            }
        };

        const origImg = new Image();
        origImg.crossOrigin = "anonymous";
        origImg.onload = checkLoaded;
        origImg.src = originalImageUrl;
        originalImgRef.current = origImg;

        const procImg = new Image();
        procImg.crossOrigin = "anonymous";
        procImg.onload = checkLoaded;
        procImg.src = processedImageUrl;
        processedImgRef.current = procImg;
    }, [originalImageUrl, processedImageUrl, width, height]);

    // Initialize canvases
    useEffect(() => {
        if (!imagesLoaded) return;

        const displayCanvas = displayCanvasRef.current;
        const originalCanvas = originalCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;

        // Set canvas dimensions to natural size for quality
        [displayCanvas, originalCanvas, maskCanvas].forEach(canvas => {
            canvas.width = dimensions.naturalWidth;
            canvas.height = dimensions.naturalHeight;
        });

        // Draw original image
        const origCtx = originalCanvas.getContext("2d");
        origCtx.drawImage(originalImgRef.current, 0, 0);

        // Extract alpha mask from processed image
        const maskCtx = maskCanvas.getContext("2d");
        maskCtx.drawImage(processedImgRef.current, 0, 0);

        renderDisplay();
    }, [imagesLoaded, dimensions]);

    // Render display with checkerboard + masked image
    const renderDisplay = useCallback(() => {
        if (!displayCanvasRef.current || !originalCanvasRef.current || !maskCanvasRef.current) return;

        const displayCanvas = displayCanvasRef.current;
        const originalCanvas = originalCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;

        const ctx = displayCanvas.getContext("2d");
        const w = displayCanvas.width;
        const h = displayCanvas.height;

        // Create and cache checkerboard pattern for performance
        if (!checkerPatternRef.current) {
            const checkSize = 16;
            const patternCanvas = document.createElement("canvas");
            patternCanvas.width = checkSize * 2;
            patternCanvas.height = checkSize * 2;
            const patternCtx = patternCanvas.getContext("2d");
            patternCtx.fillStyle = "#ffffff";
            patternCtx.fillRect(0, 0, checkSize * 2, checkSize * 2);
            patternCtx.fillStyle = "#e0e0e0";
            patternCtx.fillRect(checkSize, 0, checkSize, checkSize);
            patternCtx.fillRect(0, checkSize, checkSize, checkSize);
            checkerPatternRef.current = ctx.createPattern(patternCanvas, "repeat");
        }

        // Draw checkerboard using cached pattern
        ctx.fillStyle = checkerPatternRef.current;
        ctx.fillRect(0, 0, w, h);

        // Get image data
        const origCtx = originalCanvas.getContext("2d");
        const maskCtx = maskCanvas.getContext("2d");
        const origData = origCtx.getImageData(0, 0, w, h);
        const maskData = maskCtx.getImageData(0, 0, w, h);

        // Composite with mask alpha
        const resultData = ctx.createImageData(w, h);
        for (let i = 0; i < origData.data.length; i += 4) {
            const alpha = maskData.data[i + 3];
            if (alpha > 0) {
                // Blend with checkerboard
                const bg = resultData.data[i] || 255; // checkerboard is already drawn
                resultData.data[i] = origData.data[i];
                resultData.data[i + 1] = origData.data[i + 1];
                resultData.data[i + 2] = origData.data[i + 2];
                resultData.data[i + 3] = alpha;
            }
        }

        // Draw result on top of checkerboard
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(resultData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);

        // Draw preview mask overlay if exists (for assisted mode hover)
        // Using ImageData for performance instead of individual fillRect calls
        if (previewMask) {
            const overlayData = ctx.getImageData(0, 0, w, h);
            const overlayPixels = overlayData.data;
            const [r, g, b] = action === "restore" ? [34, 197, 94] : [239, 68, 68];
            const alpha = 0.3;
            
            for (let i = 0; i < previewMask.data.length; i++) {
                if (previewMask.data[i] === 1) {
                    const pixelIdx = i * 4;
                    // Blend overlay color with existing pixel
                    overlayPixels[pixelIdx] = Math.round(overlayPixels[pixelIdx] * (1 - alpha) + r * alpha);
                    overlayPixels[pixelIdx + 1] = Math.round(overlayPixels[pixelIdx + 1] * (1 - alpha) + g * alpha);
                    overlayPixels[pixelIdx + 2] = Math.round(overlayPixels[pixelIdx + 2] * (1 - alpha) + b * alpha);
                }
            }
            ctx.putImageData(overlayData, 0, 0);
        }
    }, [previewMask, action]);

    // Re-render when preview changes
    useEffect(() => {
        if (imagesLoaded) {
            renderDisplay();
        }
    }, [previewMask, imagesLoaded, renderDisplay]);

    // Get canvas coordinates from event
    const getCanvasCoords = useCallback((e) => {
        const canvas = displayCanvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        let clientX, clientY;
        if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        return {
            x: Math.round((clientX - rect.left) * scaleX),
            y: Math.round((clientY - rect.top) * scaleY),
        };
    }, []);

    // Magic wand selection (flood fill with color tolerance)
    const getFloodFillMask = useCallback((x, y) => {
        if (!originalCanvasRef.current) return null;

        const canvas = originalCanvasRef.current;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Use magic-wand-tool for flood fill
        const result = MagicWand.floodFill(imageData, x, y, tolerance);
        if (!result) return null;

        // Create mask from result
        return {
            data: result.data,
            width: result.width,
            height: result.height,
            bounds: result.bounds,
        };
    }, [tolerance]);

    // Apply action to mask region
    const applyToMask = useCallback((selectionMask) => {
        if (!selectionMask || !maskCanvasRef.current) return;

        const maskCanvas = maskCanvasRef.current;
        const maskCtx = maskCanvas.getContext("2d");
        const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

        const w = maskCanvas.width;
        for (let i = 0; i < selectionMask.data.length; i++) {
            if (selectionMask.data[i] === 1) {
                const alphaIdx = i * 4 + 3;
                if (action === "restore") {
                    maskData.data[alphaIdx] = 255; // Fully opaque
                } else {
                    maskData.data[alphaIdx] = 0; // Fully transparent
                }
            }
        }

        maskCtx.putImageData(maskData, 0, 0);
        setPreviewMask(null);
        renderDisplay();
        exportResult();
    }, [action, renderDisplay]);

    // Manual brush painting
    const paintBrush = useCallback((x, y) => {
        if (!maskCanvasRef.current) return;

        const maskCanvas = maskCanvasRef.current;
        const maskCtx = maskCanvas.getContext("2d");
        const w = maskCanvas.width;
        const h = maskCanvas.height;

        // Scale brush size to natural resolution
        const scaledBrush = brushSize * (w / dimensions.width);
        const radius = scaledBrush / 2;

        const maskData = maskCtx.getImageData(0, 0, w, h);

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const px = Math.round(x + dx);
                const py = Math.round(y + dy);

                if (px < 0 || px >= w || py < 0 || py >= h) continue;

                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > radius) continue;

                // Feathered edge
                const strength = 1 - (dist / radius);
                const alphaIdx = (py * w + px) * 4 + 3;
                const current = maskData.data[alphaIdx];

                if (action === "restore") {
                    maskData.data[alphaIdx] = Math.min(255, current + strength * 255);
                } else {
                    maskData.data[alphaIdx] = Math.max(0, current - strength * 255);
                }
            }
        }

        maskCtx.putImageData(maskData, 0, 0);
        renderDisplay();
    }, [action, brushSize, dimensions, renderDisplay]);

    // Export refined result
    const exportResult = useCallback(() => {
        if (!displayCanvasRef.current || !onRefinedImage) return;

        // Create final composite
        const w = dimensions.naturalWidth;
        const h = dimensions.naturalHeight;
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = w;
        exportCanvas.height = h;
        const exportCtx = exportCanvas.getContext("2d");

        const origCtx = originalCanvasRef.current.getContext("2d");
        const maskCtx = maskCanvasRef.current.getContext("2d");
        const origData = origCtx.getImageData(0, 0, w, h);
        const maskData = maskCtx.getImageData(0, 0, w, h);

        // Apply mask alpha to original
        for (let i = 0; i < origData.data.length; i += 4) {
            origData.data[i + 3] = maskData.data[i + 3];
        }

        exportCtx.putImageData(origData, 0, 0);
        onRefinedImage(exportCanvas.toDataURL("image/png"));
    }, [dimensions, onRefinedImage]);

    // Mouse/touch handlers
    const handleMouseDown = useCallback((e) => {
        if (disabled) return;
        e.preventDefault();

        const coords = getCanvasCoords(e);

        if (mode === "assisted") {
            // Flood fill selection and apply
            const mask = getFloodFillMask(coords.x, coords.y);
            if (mask) {
                applyToMask(mask);
            }
        } else {
            // Manual painting
            setIsDrawing(true);
            paintBrush(coords.x, coords.y);
        }
    }, [disabled, mode, getCanvasCoords, getFloodFillMask, applyToMask, paintBrush]);

    const handleMouseMove = useCallback((e) => {
        if (disabled) return;

        const coords = getCanvasCoords(e);

        if (mode === "assisted" && !isDrawing) {
            // Throttle hover preview for performance
            const now = Date.now();
            if (now - lastHoverTimeRef.current < HOVER_THROTTLE_MS) return;
            lastHoverTimeRef.current = now;
            
            // Show preview of what would be selected
            const mask = getFloodFillMask(coords.x, coords.y);
            setPreviewMask(mask);
        } else if (mode === "manual" && isDrawing) {
            paintBrush(coords.x, coords.y);
        }
    }, [disabled, mode, isDrawing, getCanvasCoords, getFloodFillMask, paintBrush]);

    const handleMouseUp = useCallback(() => {
        if (isDrawing) {
            setIsDrawing(false);
            exportResult();
        }
    }, [isDrawing, exportResult]);

    const handleMouseLeave = useCallback(() => {
        setPreviewMask(null);
        if (isDrawing) {
            setIsDrawing(false);
            exportResult();
        }
    }, [isDrawing, exportResult]);

    // Reset to original processed result
    const handleReset = useCallback(() => {
        if (!maskCanvasRef.current || !processedImgRef.current) return;

        const maskCtx = maskCanvasRef.current.getContext("2d");
        maskCtx.drawImage(processedImgRef.current, 0, 0);
        setPreviewMask(null);
        renderDisplay();
        if (onRefinedImage) onRefinedImage(null);
    }, [renderDisplay, onRefinedImage]);

    // Restore all (make everything visible)
    const handleRestoreAll = useCallback(() => {
        if (!maskCanvasRef.current) return;

        const maskCtx = maskCanvasRef.current.getContext("2d");
        const w = maskCanvasRef.current.width;
        const h = maskCanvasRef.current.height;
        const maskData = maskCtx.getImageData(0, 0, w, h);

        for (let i = 3; i < maskData.data.length; i += 4) {
            maskData.data[i] = 255;
        }

        maskCtx.putImageData(maskData, 0, 0);
        renderDisplay();
        exportResult();
    }, [renderDisplay, exportResult]);

    // Erase all (make everything transparent)
    const handleEraseAll = useCallback(() => {
        if (!maskCanvasRef.current) return;

        const maskCtx = maskCanvasRef.current.getContext("2d");
        const w = maskCanvasRef.current.width;
        const h = maskCanvasRef.current.height;
        const maskData = maskCtx.getImageData(0, 0, w, h);

        for (let i = 3; i < maskData.data.length; i += 4) {
            maskData.data[i] = 0;
        }

        maskCtx.putImageData(maskData, 0, 0);
        renderDisplay();
        exportResult();
    }, [renderDisplay, exportResult]);

    if (!imagesLoaded) {
        return (
            <div style={{
                width,
                height,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f5f5f5",
                borderRadius: "8px",
            }}>
                <Text variant="bodySm" tone="subdued">Loading...</Text>
            </div>
        );
    }

    return (
        <BlockStack gap="300">
            {/* Action buttons */}
            <InlineStack gap="200" align="start" blockAlign="center" wrap>
                <Button
                    pressed={action === "restore"}
                    onClick={() => setAction("restore")}
                    size="slim"
                    disabled={disabled}
                >
                    <span style={{ color: action === "restore" ? "#22c55e" : "inherit" }}>
                        ✓ Restore
                    </span>
                </Button>
                <Button
                    pressed={action === "erase"}
                    onClick={() => setAction("erase")}
                    size="slim"
                    disabled={disabled}
                >
                    <span style={{ color: action === "erase" ? "#ef4444" : "inherit" }}>
                        ✕ Erase
                    </span>
                </Button>

                <div style={{ width: "1px", height: "24px", background: "#ddd" }} />

                <Button
                    pressed={mode === "assisted"}
                    onClick={() => setMode("assisted")}
                    size="slim"
                    disabled={disabled}
                >
                    Assisted
                </Button>
                <Button
                    pressed={mode === "manual"}
                    onClick={() => setMode("manual")}
                    size="slim"
                    disabled={disabled}
                >
                    Manual
                </Button>

                <div style={{ width: "1px", height: "24px", background: "#ddd" }} />

                <Button size="slim" onClick={handleRestoreAll} disabled={disabled}>
                    Restore All
                </Button>
                <Button size="slim" onClick={handleEraseAll} disabled={disabled}>
                    Erase All
                </Button>
                <Button size="slim" onClick={handleReset} disabled={disabled}>
                    Reset
                </Button>
            </InlineStack>

            {/* Sliders */}
            <InlineStack gap="400" wrap>
                {mode === "assisted" && (
                    <div style={{ width: "180px" }}>
                        <RangeSlider
                            label={`Tolerance: ${tolerance}`}
                            value={tolerance}
                            onChange={setTolerance}
                            min={1}
                            max={100}
                            step={1}
                            disabled={disabled}
                        />
                    </div>
                )}
                {mode === "manual" && (
                    <div style={{ width: "180px" }}>
                        <RangeSlider
                            label={`Brush: ${brushSize}px`}
                            value={brushSize}
                            onChange={setBrushSize}
                            min={5}
                            max={80}
                            step={5}
                            disabled={disabled}
                        />
                    </div>
                )}
            </InlineStack>

            {/* Mode indicator */}
            <InlineStack gap="200" blockAlign="center">
                <Badge tone={mode === "assisted" ? "info" : "attention"}>
                    {mode === "assisted" ? "Click to select similar colors" : "Paint directly"}
                </Badge>
                <Text variant="bodySm" tone="subdued">
                    {action === "restore"
                        ? "→ Will bring back removed areas"
                        : "→ Will make areas transparent"}
                </Text>
            </InlineStack>

            {/* Canvas */}
            <div
                ref={containerRef}
                style={{
                    position: "relative",
                    display: "inline-block",
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    overflow: "hidden",
                    cursor: disabled ? "not-allowed" : (mode === "assisted" ? "crosshair" : "cell"),
                    touchAction: "none",
                }}
            >
                <canvas
                    ref={displayCanvasRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    onTouchStart={handleMouseDown}
                    onTouchMove={handleMouseMove}
                    onTouchEnd={handleMouseUp}
                    style={{
                        display: "block",
                        width: dimensions.width,
                        height: dimensions.height,
                        opacity: disabled ? 0.5 : 1,
                    }}
                />

                {/* Hidden canvases */}
                <canvas ref={originalCanvasRef} style={{ display: "none" }} />
                <canvas ref={maskCanvasRef} style={{ display: "none" }} />
            </div>
        </BlockStack>
    );
}
