import { useRef, useEffect, useState, useCallback } from "react";
import { InlineStack, Button, Text, RangeSlider, BlockStack } from "@shopify/polaris";

/**
 * SmartBrushCanvas - Edge-aware brush for refining background removal
 *
 * This is NOT for painting the entire selection manually.
 * It's for REFINING the AI's result:
 * - "Restore" brush: Brings back areas the AI incorrectly removed
 * - "Erase" brush: Removes areas the AI missed
 *
 * Smart features:
 * - Edge detection: Brush snaps to object boundaries
 * - Feathered edges: Smooth transitions
 * - Preview overlay: See what's being changed in real-time
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

    // Compute edge detection map
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

        // Simple Sobel edge detection
        const edges = new Uint8ClampedArray(w * h);

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;

                // Get grayscale values of neighbors
                const getGray = (dx, dy) => {
                    const i = ((y + dy) * w + (x + dx)) * 4;
                    return (data[i] + data[i + 1] + data[i + 2]) / 3;
                };

                // Sobel kernels
                const gx = (
                    -getGray(-1, -1) + getGray(1, -1) +
                    -2 * getGray(-1, 0) + 2 * getGray(1, 0) +
                    -getGray(-1, 1) + getGray(1, 1)
                );
                const gy = (
                    -getGray(-1, -1) - 2 * getGray(0, -1) - getGray(1, -1) +
                    getGray(-1, 1) + 2 * getGray(0, 1) + getGray(1, 1)
                );

                const magnitude = Math.sqrt(gx * gx + gy * gy);
                edges[y * w + x] = Math.min(255, magnitude);
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
    }, []);

    // Pre-rendered checkerboard pattern (cached)
    const checkerPatternRef = useRef(null);
    
    // Render the display canvas (checkerboard + image with current mask)
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

        // Draw checkerboard background using cached pattern
        ctx.fillStyle = checkerPatternRef.current;
        ctx.fillRect(0, 0, w, h);

        // Get original and mask data
        const origCtx = originalCanvas.getContext("2d");
        const maskCtx = maskCanvas.getContext("2d");
        const origData = origCtx.getImageData(0, 0, w, h);
        const maskData = maskCtx.getImageData(0, 0, w, h);

        // Composite: original pixels with mask alpha
        const resultData = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < origData.data.length; i += 4) {
            const alpha = maskData.data[i + 3] / 255;
            if (alpha > 0) {
                resultData.data[i] = origData.data[i];
                resultData.data[i + 1] = origData.data[i + 1];
                resultData.data[i + 2] = origData.data[i + 2];
                resultData.data[i + 3] = maskData.data[i + 3];
            }
        }
        ctx.putImageData(resultData, 0, 0);
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

    // Apply brush stroke
    const applyBrush = useCallback((x, y) => {
        if (!maskCanvasRef.current || !edgeCanvasRef.current) return;

        const maskCanvas = maskCanvasRef.current;
        const edgeCanvas = edgeCanvasRef.current;
        const maskCtx = maskCanvas.getContext("2d");
        const edgeCtx = edgeCanvas.getContext("2d");

        const w = maskCanvas.width;
        const h = maskCanvas.height;
        const radius = brushSize * (w / dimensions.width); // Scale to natural resolution

        // Get edge data for smart brush
        const edgeData = edgeSnap ? edgeCtx.getImageData(
            Math.max(0, x - radius),
            Math.max(0, y - radius),
            Math.min(radius * 2, w - x + radius),
            Math.min(radius * 2, h - y + radius)
        ) : null;

        // Get current mask data
        const maskData = maskCtx.getImageData(0, 0, w, h);

        // Apply brush with edge awareness
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const px = x + dx;
                const py = y + dy;

                if (px < 0 || px >= w || py < 0 || py >= h) continue;

                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > radius) continue;

                // Feathered edge falloff
                let strength = 1 - (dist / radius);
                strength = strength * strength; // Quadratic falloff for smoother edges

                // Edge snap: reduce strength near edges if crossing them
                if (edgeSnap && edgeData) {
                    const edgeX = dx + radius;
                    const edgeY = dy + radius;
                    if (edgeX >= 0 && edgeX < edgeData.width && edgeY >= 0 && edgeY < edgeData.height) {
                        const edgeIdx = (edgeY * edgeData.width + edgeX) * 4;
                        const edgeStrength = edgeData.data[edgeIdx] / 255;
                        // Reduce brush effect at strong edges
                        strength *= (1 - edgeStrength * 0.8);
                    }
                }

                const idx = (py * w + px) * 4 + 3; // Alpha channel
                const currentAlpha = maskData.data[idx];

                if (brushMode === "restore") {
                    // Restore: increase alpha (bring back original)
                    maskData.data[idx] = Math.min(255, currentAlpha + strength * 255);
                } else {
                    // Erase: decrease alpha (make transparent)
                    maskData.data[idx] = Math.max(0, currentAlpha - strength * 255);
                }
            }
        }

        maskCtx.putImageData(maskData, 0, 0);
        renderDisplay();
    }, [brushSize, brushMode, edgeSnap, dimensions, renderDisplay]);

    const handleStart = useCallback((e) => {
        if (disabled) return;
        e.preventDefault();
        setIsDrawing(true);
        const pos = getPosition(e);
        applyBrush(pos.x, pos.y);
    }, [disabled, getPosition, applyBrush]);

    const handleMove = useCallback((e) => {
        if (!isDrawing || disabled) return;
        e.preventDefault();
        const pos = getPosition(e);
        applyBrush(pos.x, pos.y);
    }, [isDrawing, disabled, getPosition, applyBrush]);

    const handleEnd = useCallback(() => {
        if (!isDrawing) return;
        setIsDrawing(false);

        // Export refined image
        if (onRefinedImage && displayCanvasRef.current) {
            const dataUrl = displayCanvasRef.current.toDataURL("image/png");
            onRefinedImage(dataUrl);
        }
    }, [isDrawing, onRefinedImage]);

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
