import { useRef, useEffect, useState, useCallback } from "react";
import { InlineStack, Button, Text, RangeSlider, BlockStack, Badge, Banner } from "@shopify/polaris";
import MagicWand from "magic-wand-tool";

/**
 * DirectSelectionCanvas - Click/paint directly on image to remove areas
 *
 * Like Adobe/Canva magic eraser:
 * 1. Click on an area → selects similar colors → makes them transparent
 * 2. OR paint directly with brush to remove
 *
 * Works on the ORIGINAL image - no AI pre-processing needed
 */
export function DirectSelectionCanvas({
    imageUrl,
    width = 550,
    height = 480,
    onImageChange,
    disabled = false,
}) {
    // Refs
    const displayCanvasRef = useRef(null);
    const imageCanvasRef = useRef(null);  // Holds the current image with alpha
    const originalCanvasRef = useRef(null);  // Holds original for reference
    const containerRef = useRef(null);

    // Image ref
    const imageRef = useRef(null);

    // State
    const [imageLoaded, setImageLoaded] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Tool state
    const [mode, setMode] = useState("click"); // "click" | "brush"
    const [tolerance, setTolerance] = useState(32);
    const [brushSize, setBrushSize] = useState(25);

    // Preview state for click mode
    const [previewMask, setPreviewMask] = useState(null);

    // Load image
    useEffect(() => {
        if (!imageUrl) return;

        setImageLoaded(false);
        setHasChanges(false);

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            imageRef.current = img;

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
            setImageLoaded(true);
        };
        img.src = imageUrl;
    }, [imageUrl, width, height]);

    // Initialize canvases
    useEffect(() => {
        if (!imageLoaded || !imageRef.current) return;

        const displayCanvas = displayCanvasRef.current;
        const imageCanvas = imageCanvasRef.current;
        const originalCanvas = originalCanvasRef.current;

        // Set canvas dimensions
        [displayCanvas, imageCanvas, originalCanvas].forEach(canvas => {
            canvas.width = dimensions.naturalWidth;
            canvas.height = dimensions.naturalHeight;
        });

        // Draw image to all canvases
        const imgCtx = imageCanvas.getContext("2d");
        imgCtx.drawImage(imageRef.current, 0, 0);

        const origCtx = originalCanvas.getContext("2d");
        origCtx.drawImage(imageRef.current, 0, 0);

        renderDisplay();
    }, [imageLoaded, dimensions]);

    // Render display with checkerboard + current image
    const renderDisplay = useCallback(() => {
        if (!displayCanvasRef.current || !imageCanvasRef.current) return;

        const displayCanvas = displayCanvasRef.current;
        const imageCanvas = imageCanvasRef.current;

        const ctx = displayCanvas.getContext("2d");
        const w = displayCanvas.width;
        const h = displayCanvas.height;

        // Draw checkerboard
        const checkSize = 16;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#e0e0e0";
        for (let y = 0; y < h; y += checkSize) {
            for (let x = 0; x < w; x += checkSize) {
                if (((x / checkSize) + (y / checkSize)) % 2 === 1) {
                    ctx.fillRect(x, y, checkSize, checkSize);
                }
            }
        }

        // Draw current image on top
        ctx.drawImage(imageCanvas, 0, 0);

        // Draw preview overlay if in click mode
        if (previewMask && mode === "click") {
            ctx.fillStyle = "rgba(239, 68, 68, 0.4)"; // Red overlay for areas to be removed
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (previewMask.data[y * w + x] === 1) {
                        ctx.fillRect(x, y, 1, 1);
                    }
                }
            }
        }
    }, [previewMask, mode]);

    // Re-render when preview changes
    useEffect(() => {
        if (imageLoaded) {
            renderDisplay();
        }
    }, [previewMask, imageLoaded, renderDisplay]);

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

    // Magic wand flood fill selection
    const getFloodFillMask = useCallback((x, y) => {
        if (!originalCanvasRef.current) return null;

        const canvas = originalCanvasRef.current;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const result = MagicWand.floodFill(imageData, x, y, tolerance);
        if (!result) return null;

        return {
            data: result.data,
            width: result.width,
            height: result.height,
            bounds: result.bounds,
        };
    }, [tolerance]);

    // Apply selection to make areas transparent
    const applySelection = useCallback((selectionMask) => {
        if (!selectionMask || !imageCanvasRef.current) return;

        const imageCanvas = imageCanvasRef.current;
        const ctx = imageCanvas.getContext("2d");
        const imageData = ctx.getImageData(0, 0, imageCanvas.width, imageCanvas.height);

        for (let i = 0; i < selectionMask.data.length; i++) {
            if (selectionMask.data[i] === 1) {
                // Make this pixel transparent
                imageData.data[i * 4 + 3] = 0;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        setPreviewMask(null);
        setHasChanges(true);
        renderDisplay();
        exportResult();
    }, [renderDisplay]);

    // Paint with brush to remove areas
    const paintBrush = useCallback((x, y) => {
        if (!imageCanvasRef.current) return;

        const imageCanvas = imageCanvasRef.current;
        const ctx = imageCanvas.getContext("2d");
        const w = imageCanvas.width;
        const h = imageCanvas.height;

        const scaledBrush = brushSize * (w / dimensions.width);
        const radius = scaledBrush / 2;

        const imageData = ctx.getImageData(0, 0, w, h);

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
                const current = imageData.data[alphaIdx];

                // Make transparent (erase)
                imageData.data[alphaIdx] = Math.max(0, current - strength * 255);
            }
        }

        ctx.putImageData(imageData, 0, 0);
        setHasChanges(true);
        renderDisplay();
    }, [brushSize, dimensions, renderDisplay]);

    // Export result as data URL
    const exportResult = useCallback(() => {
        if (!imageCanvasRef.current || !onImageChange) return;
        onImageChange(imageCanvasRef.current.toDataURL("image/png"));
    }, [onImageChange]);

    // Mouse handlers
    const handleMouseDown = useCallback((e) => {
        if (disabled) return;
        e.preventDefault();

        const coords = getCanvasCoords(e);

        if (mode === "click") {
            // Click mode - flood fill and remove
            const mask = getFloodFillMask(coords.x, coords.y);
            if (mask) {
                applySelection(mask);
            }
        } else {
            // Brush mode - paint to remove
            setIsDrawing(true);
            paintBrush(coords.x, coords.y);
        }
    }, [disabled, mode, getCanvasCoords, getFloodFillMask, applySelection, paintBrush]);

    const handleMouseMove = useCallback((e) => {
        if (disabled) return;

        const coords = getCanvasCoords(e);

        if (mode === "click" && !isDrawing) {
            // Show preview of what would be selected
            const mask = getFloodFillMask(coords.x, coords.y);
            setPreviewMask(mask);
        } else if (mode === "brush" && isDrawing) {
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

    // Reset to original
    const handleReset = useCallback(() => {
        if (!imageCanvasRef.current || !imageRef.current) return;

        const ctx = imageCanvasRef.current.getContext("2d");
        ctx.clearRect(0, 0, dimensions.naturalWidth, dimensions.naturalHeight);
        ctx.drawImage(imageRef.current, 0, 0);
        setPreviewMask(null);
        setHasChanges(false);
        renderDisplay();
        if (onImageChange) onImageChange(null);
    }, [dimensions, renderDisplay, onImageChange]);

    // Undo last action - simple reset for now
    const handleUndo = handleReset;

    if (!imageLoaded) {
        return (
            <div style={{
                width,
                height: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f5f5f5",
                borderRadius: "8px",
            }}>
                <Text variant="bodySm" tone="subdued">Loading image...</Text>
            </div>
        );
    }

    return (
        <BlockStack gap="300">
            {/* Instructions */}
            <Banner tone="info">
                <p>
                    <strong>Click</strong> on areas to remove them (like magic wand) or use <strong>Brush</strong> to paint what you want gone.
                    Red highlight shows what will be removed.
                </p>
            </Banner>

            {/* Mode toggle */}
            <InlineStack gap="200" align="start" blockAlign="center">
                <Button
                    pressed={mode === "click"}
                    onClick={() => setMode("click")}
                    size="slim"
                    disabled={disabled}
                >
                    🎯 Click to Remove
                </Button>
                <Button
                    pressed={mode === "brush"}
                    onClick={() => setMode("brush")}
                    size="slim"
                    disabled={disabled}
                >
                    🖌️ Brush Eraser
                </Button>

                <div style={{ width: "1px", height: "24px", background: "#ddd" }} />

                <Button
                    size="slim"
                    onClick={handleReset}
                    disabled={disabled || !hasChanges}
                >
                    ↺ Reset
                </Button>
            </InlineStack>

            {/* Slider controls */}
            <InlineStack gap="400" wrap>
                {mode === "click" && (
                    <div style={{ width: "200px" }}>
                        <RangeSlider
                            label={`Tolerance: ${tolerance} (lower = more precise)`}
                            value={tolerance}
                            onChange={setTolerance}
                            min={5}
                            max={80}
                            step={5}
                            disabled={disabled}
                        />
                    </div>
                )}
                {mode === "brush" && (
                    <div style={{ width: "200px" }}>
                        <RangeSlider
                            label={`Brush Size: ${brushSize}px`}
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

            {/* Status badge */}
            <InlineStack gap="200" blockAlign="center">
                <Badge tone={mode === "click" ? "info" : "attention"}>
                    {mode === "click" ? "Click on background to remove" : "Paint over areas to erase"}
                </Badge>
                {hasChanges && (
                    <Badge tone="success">Changes made</Badge>
                )}
            </InlineStack>

            {/* Canvas */}
            <div
                ref={containerRef}
                style={{
                    position: "relative",
                    display: "inline-block",
                    border: "2px solid #2563eb",
                    borderRadius: "8px",
                    overflow: "hidden",
                    cursor: disabled ? "not-allowed" : (mode === "click" ? "crosshair" : "cell"),
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
                <canvas ref={imageCanvasRef} style={{ display: "none" }} />
                <canvas ref={originalCanvasRef} style={{ display: "none" }} />
            </div>

            <Text variant="bodySm" tone="subdued">
                Checkerboard pattern shows transparent areas
            </Text>
        </BlockStack>
    );
}
