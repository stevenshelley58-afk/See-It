import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { InlineStack, Button, Text, RangeSlider, BlockStack } from "@shopify/polaris";
import {
    rafThrottle,
    debounce,
    drawCheckerboard,
    getROIImageData,
    applyCircularBrushToAlpha,
    interpolateBrushStroke,
} from "../utils/canvas-performance";

/**
 * SmartBrushCanvas - Edge-aware brush for refining background removal
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - RAF-throttled mouse move handlers (60fps max)
 * - Pre-rendered checkerboard pattern (pattern fill vs pixel-by-pixel)
 * - Region-of-interest (ROI) ImageData access (only brush area, not full canvas)
 * - Cached edge data reference (no repeated getImageData)
 * - Debounced export (100ms after last stroke)
 * - Brush stroke interpolation for smooth lines
 */
export function SmartBrushCanvas({
    originalImageUrl,      // Original product image
    processedImageUrl,     // Result from Prodia (with transparency)
    width = 450,
    height = 450,
    onRefinedImage,        // Callback with refined image data URL
    disabled = false,
}) {
    const containerRef = useRef(null);
    const displayCanvasRef = useRef(null);   // What user sees
    const originalCanvasRef = useRef(null);  // Original image (hidden)
    const maskCanvasRef = useRef(null);      // Current transparency mask (hidden)
    const edgeCanvasRef = useRef(null);      // Edge detection (hidden)

    // Performance: Cache edge data to avoid repeated getImageData calls
    const edgeDataRef = useRef(null);
    const lastPosRef = useRef(null); // For brush interpolation

    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(25);
    const [brushMode, setBrushMode] = useState("restore"); // "restore" | "erase"
    const [edgeSnap, setEdgeSnap] = useState(true);
    const [imagesLoaded, setImagesLoaded] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    const originalImgRef = useRef(null);
    const processedImgRef = useRef(null);

    // Load both images
    useEffect(() => {
        if (!originalImageUrl || !processedImageUrl) return;

        setImagesLoaded(false);
        let loadedCount = 0;

        const checkLoaded = () => {
            loadedCount++;
            if (loadedCount === 2) {
                // Calculate display dimensions
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
        origImg.onerror = () => console.error("Failed to load original image");
        origImg.src = originalImageUrl;
        originalImgRef.current = origImg;

        const procImg = new Image();
        procImg.crossOrigin = "anonymous";
        procImg.onload = checkLoaded;
        procImg.onerror = () => console.error("Failed to load processed image");
        procImg.src = processedImageUrl;
        processedImgRef.current = procImg;
    }, [originalImageUrl, processedImageUrl, width, height]);

    // Initialize canvases when images load
    useEffect(() => {
        if (!imagesLoaded) return;

        const displayCanvas = displayCanvasRef.current;
        const originalCanvas = originalCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        const edgeCanvas = edgeCanvasRef.current;

        // Set all canvas sizes to natural resolution for quality
        [displayCanvas, originalCanvas, maskCanvas, edgeCanvas].forEach(canvas => {
            canvas.width = dimensions.naturalWidth;
            canvas.height = dimensions.naturalHeight;
        });

        // Draw original image
        const origCtx = originalCanvas.getContext("2d");
        origCtx.drawImage(originalImgRef.current, 0, 0);

        // Extract mask from processed image (alpha channel)
        const maskCtx = maskCanvas.getContext("2d");
        maskCtx.drawImage(processedImgRef.current, 0, 0);

        // Compute edge map for smart brush
        computeEdges();

        // Render initial display
        renderDisplay();
    }, [imagesLoaded, dimensions]);

    // Compute edge detection map - optimized with cached edge data
    const computeEdges = useCallback(() => {
        if (!originalCanvasRef.current || !edgeCanvasRef.current) return;

        const origCanvas = originalCanvasRef.current;
        const edgeCanvas = edgeCanvasRef.current;
        const origCtx = origCanvas.getContext("2d");
        const edgeCtx = edgeCanvas.getContext("2d");

        const imageData = origCtx.getImageData(0, 0, origCanvas.width, origCanvas.height);
        const data = imageData.data;
        const w = origCanvas.width;
        const h = origCanvas.height;

        // Pre-compute grayscale values for faster access
        const gray = new Uint8ClampedArray(w * h);
        for (let i = 0; i < gray.length; i++) {
            const idx = i * 4;
            gray[i] = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        }

        // Simple Sobel edge detection with cached grayscale
        const edges = new Uint8ClampedArray(w * h);

        for (let y = 1; y < h - 1; y++) {
            const yOffset = y * w;
            const yOffsetUp = (y - 1) * w;
            const yOffsetDown = (y + 1) * w;

            for (let x = 1; x < w - 1; x++) {
                // Sobel kernels using pre-computed grayscale
                const gx = (
                    -gray[yOffsetUp + x - 1] + gray[yOffsetUp + x + 1] +
                    -2 * gray[yOffset + x - 1] + 2 * gray[yOffset + x + 1] +
                    -gray[yOffsetDown + x - 1] + gray[yOffsetDown + x + 1]
                );
                const gy = (
                    -gray[yOffsetUp + x - 1] - 2 * gray[yOffsetUp + x] - gray[yOffsetUp + x + 1] +
                    gray[yOffsetDown + x - 1] + 2 * gray[yOffsetDown + x] + gray[yOffsetDown + x + 1]
                );

                const magnitude = Math.sqrt(gx * gx + gy * gy);
                edges[yOffset + x] = Math.min(255, magnitude);
            }
        }

        // Store edges as red channel for quick lookup
        const edgeImageData = edgeCtx.createImageData(w, h);
        for (let i = 0; i < edges.length; i++) {
            edgeImageData.data[i * 4] = edges[i];     // R = edge strength
            edgeImageData.data[i * 4 + 1] = 0;
            edgeImageData.data[i * 4 + 2] = 0;
            edgeImageData.data[i * 4 + 3] = 255;
        }
        edgeCtx.putImageData(edgeImageData, 0, 0);

        // PERFORMANCE: Cache full edge data for brush operations
        edgeDataRef.current = {
            data: edges,
            width: w,
            height: h
        };
    }, []);

    // Render the display canvas (checkerboard + image with current mask)
    // OPTIMIZED: Uses pre-rendered checkerboard pattern instead of pixel-by-pixel
    const renderDisplay = useCallback(() => {
        if (!displayCanvasRef.current || !originalCanvasRef.current || !maskCanvasRef.current) return;

        const displayCanvas = displayCanvasRef.current;
        const originalCanvas = originalCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;

        const ctx = displayCanvas.getContext("2d");
        const w = displayCanvas.width;
        const h = displayCanvas.height;

        // PERFORMANCE: Draw checkerboard using pattern fill (1 call vs w*h/256 calls)
        drawCheckerboard(ctx, w, h, 16);

        // Get original and mask data
        const origCtx = originalCanvas.getContext("2d");
        const maskCtx = maskCanvas.getContext("2d");
        const origData = origCtx.getImageData(0, 0, w, h);
        const maskData = maskCtx.getImageData(0, 0, w, h);

        // Composite: original pixels with mask alpha
        // Use a temporary canvas for proper alpha compositing
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext("2d");

        // Apply mask alpha to original image
        const resultData = tempCtx.createImageData(w, h);
        for (let i = 0; i < origData.data.length; i += 4) {
            const alpha = maskData.data[i + 3];
            if (alpha > 0) {
                resultData.data[i] = origData.data[i];
                resultData.data[i + 1] = origData.data[i + 1];
                resultData.data[i + 2] = origData.data[i + 2];
                resultData.data[i + 3] = alpha;
            }
        }
        tempCtx.putImageData(resultData, 0, 0);

        // Draw composite on top of checkerboard
        ctx.drawImage(tempCanvas, 0, 0);
    }, []);

    // Get canvas position from event
    const getPosition = useCallback((e) => {
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

    // Apply brush stroke - OPTIMIZED with ROI processing and cached edge data
    const applyBrush = useCallback((x, y) => {
        if (!maskCanvasRef.current) return;

        const maskCanvas = maskCanvasRef.current;
        const maskCtx = maskCanvas.getContext("2d");

        const w = maskCanvas.width;
        const h = maskCanvas.height;
        const radius = Math.round(brushSize * (w / dimensions.width)); // Scale to natural resolution

        // PERFORMANCE: Only get ImageData for the brush region (ROI), not full canvas
        const roiX = Math.max(0, Math.floor(x - radius));
        const roiY = Math.max(0, Math.floor(y - radius));
        const roiW = Math.min(w - roiX, Math.ceil(radius * 2));
        const roiH = Math.min(h - roiY, Math.ceil(radius * 2));

        if (roiW <= 0 || roiH <= 0) return;

        const maskData = maskCtx.getImageData(roiX, roiY, roiW, roiH);

        // PERFORMANCE: Use cached edge data instead of getImageData on every stroke
        const cachedEdges = edgeSnap ? edgeDataRef.current : null;

        const radiusSq = radius * radius;

        // Apply brush with edge awareness
        for (let roiDy = 0; roiDy < roiH; roiDy++) {
            const py = roiY + roiDy;
            const dy = py - y;
            const dySq = dy * dy;

            for (let roiDx = 0; roiDx < roiW; roiDx++) {
                const px = roiX + roiDx;
                const dx = px - x;
                const distSq = dx * dx + dySq;

                if (distSq > radiusSq) continue;

                const dist = Math.sqrt(distSq);
                // Feathered edge falloff - quadratic for smoother edges
                let strength = 1 - (dist / radius);
                strength = strength * strength;

                // Edge snap: reduce strength near edges if crossing them
                if (cachedEdges && px >= 0 && px < cachedEdges.width && py >= 0 && py < cachedEdges.height) {
                    const edgeStrength = cachedEdges.data[py * cachedEdges.width + px] / 255;
                    // Reduce brush effect at strong edges
                    strength *= (1 - edgeStrength * 0.8);
                }

                const idx = (roiDy * roiW + roiDx) * 4 + 3; // Alpha channel
                const currentAlpha = maskData.data[idx];

                if (brushMode === "restore") {
                    maskData.data[idx] = Math.min(255, currentAlpha + strength * 255);
                } else {
                    maskData.data[idx] = Math.max(0, currentAlpha - strength * 255);
                }
            }
        }

        // PERFORMANCE: Only put back the ROI region, not full canvas
        maskCtx.putImageData(maskData, roiX, roiY);
        renderDisplay();
    }, [brushSize, brushMode, edgeSnap, dimensions, renderDisplay]);

    // Debounced export to avoid toDataURL on every stroke end
    const debouncedExport = useMemo(() => debounce(() => {
        if (onRefinedImage && displayCanvasRef.current) {
            const dataUrl = displayCanvasRef.current.toDataURL("image/png");
            onRefinedImage(dataUrl);
        }
    }, 100), [onRefinedImage]);

    const handleStart = useCallback((e) => {
        if (disabled) return;
        e.preventDefault();
        setIsDrawing(true);
        const pos = getPosition(e);
        lastPosRef.current = pos;
        applyBrush(pos.x, pos.y);
    }, [disabled, getPosition, applyBrush]);

    // PERFORMANCE: RAF-throttled move handler with brush interpolation
    const throttledApplyBrush = useMemo(() => rafThrottle((x, y) => {
        if (lastPosRef.current) {
            const spacing = Math.max(2, brushSize * 0.3); // Spacing based on brush size
            interpolateBrushStroke(
                lastPosRef.current.x,
                lastPosRef.current.y,
                x,
                y,
                spacing,
                (ix, iy) => applyBrush(Math.round(ix), Math.round(iy))
            );
        }
        lastPosRef.current = { x, y };
    }), [applyBrush, brushSize]);

    const handleMove = useCallback((e) => {
        if (!isDrawing || disabled) return;
        e.preventDefault();
        const pos = getPosition(e);
        throttledApplyBrush(pos.x, pos.y);
    }, [isDrawing, disabled, getPosition, throttledApplyBrush]);

    const handleEnd = useCallback(() => {
        if (!isDrawing) return;
        setIsDrawing(false);
        lastPosRef.current = null;
        throttledApplyBrush.cancel();

        // PERFORMANCE: Debounced export (100ms after last stroke)
        debouncedExport();
    }, [isDrawing, throttledApplyBrush, debouncedExport]);

    // Cleanup throttle/debounce on unmount
    useEffect(() => {
        return () => {
            throttledApplyBrush.cancel();
            debouncedExport.cancel();
        };
    }, [throttledApplyBrush, debouncedExport]);

    // Reset to original processed result
    const handleReset = useCallback(() => {
        if (!maskCanvasRef.current || !processedImgRef.current) return;

        const maskCtx = maskCanvasRef.current.getContext("2d");
        maskCtx.drawImage(processedImgRef.current, 0, 0);
        renderDisplay();

        if (onRefinedImage) {
            onRefinedImage(null); // Signal reset
        }
    }, [renderDisplay, onRefinedImage]);

    // Restore all (make everything visible)
    const handleRestoreAll = useCallback(() => {
        if (!maskCanvasRef.current) return;

        const maskCtx = maskCanvasRef.current.getContext("2d");
        const w = maskCanvasRef.current.width;
        const h = maskCanvasRef.current.height;

        // Set all alpha to 255
        const maskData = maskCtx.getImageData(0, 0, w, h);
        for (let i = 3; i < maskData.data.length; i += 4) {
            maskData.data[i] = 255;
        }
        maskCtx.putImageData(maskData, 0, 0);
        renderDisplay();
    }, [renderDisplay]);

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
                <Text variant="bodySm" tone="subdued">Loading images...</Text>
            </div>
        );
    }

    return (
        <BlockStack gap="300">
            {/* Brush controls */}
            <InlineStack gap="200" align="start" blockAlign="center" wrap>
                <Button
                    pressed={brushMode === "restore"}
                    onClick={() => setBrushMode("restore")}
                    size="slim"
                    disabled={disabled}
                >
                    <span style={{ color: brushMode === "restore" ? "#22c55e" : "inherit" }}>
                        Restore
                    </span>
                </Button>
                <Button
                    pressed={brushMode === "erase"}
                    onClick={() => setBrushMode("erase")}
                    size="slim"
                    disabled={disabled}
                >
                    <span style={{ color: brushMode === "erase" ? "#ef4444" : "inherit" }}>
                        Erase
                    </span>
                </Button>
                <div style={{ width: "1px", height: "24px", background: "#ddd" }} />
                <Button
                    pressed={edgeSnap}
                    onClick={() => setEdgeSnap(!edgeSnap)}
                    size="slim"
                    disabled={disabled}
                >
                    Edge Snap {edgeSnap ? "ON" : "OFF"}
                </Button>
                <div style={{ width: "1px", height: "24px", background: "#ddd" }} />
                <Button size="slim" onClick={handleRestoreAll} disabled={disabled}>
                    Restore All
                </Button>
                <Button size="slim" onClick={handleReset} disabled={disabled}>
                    Reset
                </Button>
            </InlineStack>

            {/* Brush size */}
            <div style={{ maxWidth: "200px" }}>
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

            {/* Canvas */}
            <div
                ref={containerRef}
                style={{
                    position: "relative",
                    display: "inline-block",
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    overflow: "hidden",
                    cursor: disabled ? "not-allowed" : (brushMode === "restore" ? "cell" : "crosshair"),
                    touchAction: "none",
                }}
            >
                <canvas
                    ref={displayCanvasRef}
                    onMouseDown={handleStart}
                    onMouseMove={handleMove}
                    onMouseUp={handleEnd}
                    onMouseLeave={handleEnd}
                    onTouchStart={handleStart}
                    onTouchMove={handleMove}
                    onTouchEnd={handleEnd}
                    style={{
                        display: "block",
                        width: dimensions.width,
                        height: dimensions.height,
                        opacity: disabled ? 0.5 : 1,
                    }}
                />

                {/* Hidden canvases for processing */}
                <canvas ref={originalCanvasRef} style={{ display: "none" }} />
                <canvas ref={maskCanvasRef} style={{ display: "none" }} />
                <canvas ref={edgeCanvasRef} style={{ display: "none" }} />
            </div>

            <Text variant="bodySm" tone="subdued">
                {brushMode === "restore"
                    ? "Paint to bring back areas that were incorrectly removed"
                    : "Paint to remove areas that should be transparent"}
            </Text>
        </BlockStack>
    );
}
