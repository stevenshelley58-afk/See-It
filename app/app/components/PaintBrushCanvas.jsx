import { useRef, useEffect, useState, useCallback } from "react";
import { InlineStack, Button, Text, RangeSlider } from "@shopify/polaris";

/**
 * PaintBrushCanvas - Paint to select areas for background removal
 *
 * Paint modes:
 * - "keep" (green): Areas to KEEP (product)
 * - "remove" (red): Areas to REMOVE (background)
 *
 * The mask output has:
 * - White: Areas to KEEP
 * - Black: Areas to REMOVE (will be made transparent)
 */
export function PaintBrushCanvas({
    imageUrl,
    width = 400,
    height = 400,
    onMaskChange,
    disabled = false,
}) {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(30);
    const [paintMode, setPaintMode] = useState("keep"); // "keep" or "remove"
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const imageRef = useRef(null);

    // Load image and set up canvases
    useEffect(() => {
        if (!imageUrl) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            imageRef.current = img;

            // Calculate display dimensions maintaining aspect ratio
            const aspectRatio = img.width / img.height;
            let displayWidth = width;
            let displayHeight = width / aspectRatio;

            if (displayHeight > height) {
                displayHeight = height;
                displayWidth = height * aspectRatio;
            }

            setImageDimensions({
                width: Math.round(displayWidth),
                height: Math.round(displayHeight),
                naturalWidth: img.width,
                naturalHeight: img.height,
            });
            setImageLoaded(true);
        };
        img.onerror = () => {
            console.error("Failed to load image:", imageUrl);
        };
        img.src = imageUrl;
    }, [imageUrl, width, height]);

    // Initialize canvases when image loads
    useEffect(() => {
        if (!imageLoaded || !canvasRef.current || !maskCanvasRef.current) return;

        const canvas = canvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        const ctx = canvas.getContext("2d");
        const maskCtx = maskCanvas.getContext("2d");

        // Set canvas dimensions
        canvas.width = imageDimensions.width;
        canvas.height = imageDimensions.height;
        maskCanvas.width = imageDimensions.naturalWidth;
        maskCanvas.height = imageDimensions.naturalHeight;

        // Draw image on display canvas
        ctx.drawImage(imageRef.current, 0, 0, imageDimensions.width, imageDimensions.height);

        // Initialize mask canvas to white (keep everything by default)
        maskCtx.fillStyle = "white";
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }, [imageLoaded, imageDimensions]);

    // Get position relative to canvas
    const getPosition = useCallback((e) => {
        const canvas = canvasRef.current;
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
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    }, []);

    // Draw on canvas
    const draw = useCallback((x, y) => {
        if (!canvasRef.current || !maskCanvasRef.current) return;

        const canvas = canvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        const ctx = canvas.getContext("2d");
        const maskCtx = maskCanvas.getContext("2d");

        // Scale for mask canvas (full resolution)
        const scaleX = maskCanvas.width / canvas.width;
        const scaleY = maskCanvas.height / canvas.height;
        const maskX = x * scaleX;
        const maskY = y * scaleY;
        const maskBrushSize = brushSize * scaleX;

        // Draw on display canvas (semi-transparent overlay)
        ctx.globalCompositeOperation = "source-over";
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = paintMode === "keep"
            ? "rgba(34, 197, 94, 0.4)"  // Green for keep
            : "rgba(239, 68, 68, 0.4)"; // Red for remove
        ctx.fill();

        // Draw on mask canvas (white = keep, black = remove)
        maskCtx.globalCompositeOperation = "source-over";
        maskCtx.beginPath();
        maskCtx.arc(maskX, maskY, maskBrushSize / 2, 0, Math.PI * 2);
        maskCtx.fillStyle = paintMode === "keep" ? "white" : "black";
        maskCtx.fill();
    }, [brushSize, paintMode]);

    const handleStart = useCallback((e) => {
        if (disabled) return;
        e.preventDefault();
        setIsDrawing(true);
        const pos = getPosition(e);
        draw(pos.x, pos.y);
    }, [disabled, getPosition, draw]);

    const handleMove = useCallback((e) => {
        if (!isDrawing || disabled) return;
        e.preventDefault();
        const pos = getPosition(e);
        draw(pos.x, pos.y);
    }, [isDrawing, disabled, getPosition, draw]);

    const handleEnd = useCallback(() => {
        if (!isDrawing) return;
        setIsDrawing(false);

        // Export mask and notify parent
        if (maskCanvasRef.current && onMaskChange) {
            const maskDataUrl = maskCanvasRef.current.toDataURL("image/png");
            onMaskChange(maskDataUrl);
        }
    }, [isDrawing, onMaskChange]);

    // Reset mask to white (keep all)
    const handleClear = useCallback(() => {
        if (!canvasRef.current || !maskCanvasRef.current || !imageRef.current) return;

        const canvas = canvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        const ctx = canvas.getContext("2d");
        const maskCtx = maskCanvas.getContext("2d");

        // Redraw original image
        ctx.drawImage(imageRef.current, 0, 0, imageDimensions.width, imageDimensions.height);

        // Reset mask to white
        maskCtx.fillStyle = "white";
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        if (onMaskChange) {
            onMaskChange(null);
        }
    }, [imageDimensions, onMaskChange]);

    // Invert the mask
    const handleInvert = useCallback(() => {
        if (!maskCanvasRef.current) return;

        const maskCanvas = maskCanvasRef.current;
        const maskCtx = maskCanvas.getContext("2d");
        const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const data = imageData.data;

        // Invert each pixel
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];       // R
            data[i + 1] = 255 - data[i + 1]; // G
            data[i + 2] = 255 - data[i + 2]; // B
            // Alpha stays the same
        }

        maskCtx.putImageData(imageData, 0, 0);

        // Redraw display canvas
        if (canvasRef.current && imageRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");

            // Redraw image
            ctx.drawImage(imageRef.current, 0, 0, imageDimensions.width, imageDimensions.height);

            // Draw inverted overlay
            const displayImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

            const scaleX = maskCanvas.width / canvas.width;
            const scaleY = maskCanvas.height / canvas.height;

            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const displayIdx = (y * canvas.width + x) * 4;
                    const maskX = Math.floor(x * scaleX);
                    const maskY = Math.floor(y * scaleY);
                    const maskIdx = (maskY * maskCanvas.width + maskX) * 4;

                    const maskValue = maskData.data[maskIdx];
                    if (maskValue > 128) {
                        // Keep area - green tint
                        displayImageData.data[displayIdx] = Math.round(displayImageData.data[displayIdx] * 0.8);
                        displayImageData.data[displayIdx + 1] = Math.min(255, displayImageData.data[displayIdx + 1] * 0.8 + 50);
                        displayImageData.data[displayIdx + 2] = Math.round(displayImageData.data[displayIdx + 2] * 0.8);
                    } else {
                        // Remove area - red tint
                        displayImageData.data[displayIdx] = Math.min(255, displayImageData.data[displayIdx] * 0.8 + 50);
                        displayImageData.data[displayIdx + 1] = Math.round(displayImageData.data[displayIdx + 1] * 0.8);
                        displayImageData.data[displayIdx + 2] = Math.round(displayImageData.data[displayIdx + 2] * 0.8);
                    }
                }
            }

            ctx.putImageData(displayImageData, 0, 0);
        }

        if (onMaskChange) {
            const maskDataUrl = maskCanvasRef.current.toDataURL("image/png");
            onMaskChange(maskDataUrl);
        }
    }, [imageDimensions, onMaskChange]);

    // Fill background (auto-detect edges and fill outside)
    const handleFillBackground = useCallback(() => {
        if (!maskCanvasRef.current) return;

        const maskCanvas = maskCanvasRef.current;
        const maskCtx = maskCanvas.getContext("2d");

        // Fill entire mask with black (remove all)
        maskCtx.fillStyle = "black";
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        // Update display
        if (canvasRef.current && imageRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(imageRef.current, 0, 0, imageDimensions.width, imageDimensions.height);

            // Red overlay on everything
            ctx.fillStyle = "rgba(239, 68, 68, 0.3)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        if (onMaskChange) {
            const maskDataUrl = maskCanvasRef.current.toDataURL("image/png");
            onMaskChange(maskDataUrl);
        }
    }, [imageDimensions, onMaskChange]);

    if (!imageLoaded) {
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
                <Text variant="bodySm" tone="subdued">Loading image...</Text>
            </div>
        );
    }

    return (
        <div ref={containerRef}>
            {/* Controls */}
            <div style={{ marginBottom: "12px" }}>
                <InlineStack gap="200" align="start" blockAlign="center" wrap>
                    <Button
                        pressed={paintMode === "keep"}
                        onClick={() => setPaintMode("keep")}
                        size="slim"
                        disabled={disabled}
                    >
                        <span style={{ color: paintMode === "keep" ? "#22c55e" : "inherit" }}>
                            Keep (Green)
                        </span>
                    </Button>
                    <Button
                        pressed={paintMode === "remove"}
                        onClick={() => setPaintMode("remove")}
                        size="slim"
                        disabled={disabled}
                    >
                        <span style={{ color: paintMode === "remove" ? "#ef4444" : "inherit" }}>
                            Remove (Red)
                        </span>
                    </Button>
                    <div style={{ width: "1px", height: "24px", background: "#ddd" }} />
                    <Button size="slim" onClick={handleFillBackground} disabled={disabled}>
                        Remove All BG
                    </Button>
                    <Button size="slim" onClick={handleInvert} disabled={disabled}>
                        Invert
                    </Button>
                    <Button size="slim" onClick={handleClear} disabled={disabled}>
                        Clear
                    </Button>
                </InlineStack>
            </div>

            {/* Brush size slider */}
            <div style={{ marginBottom: "12px", maxWidth: "200px" }}>
                <RangeSlider
                    label={`Brush: ${brushSize}px`}
                    value={brushSize}
                    onChange={setBrushSize}
                    min={5}
                    max={100}
                    step={5}
                    disabled={disabled}
                />
            </div>

            {/* Canvas container */}
            <div
                style={{
                    position: "relative",
                    display: "inline-block",
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    overflow: "hidden",
                    cursor: disabled ? "not-allowed" : "crosshair",
                    touchAction: "none",
                }}
            >
                <canvas
                    ref={canvasRef}
                    onMouseDown={handleStart}
                    onMouseMove={handleMove}
                    onMouseUp={handleEnd}
                    onMouseLeave={handleEnd}
                    onTouchStart={handleStart}
                    onTouchMove={handleMove}
                    onTouchEnd={handleEnd}
                    style={{
                        display: "block",
                        opacity: disabled ? 0.5 : 1,
                    }}
                />

                {/* Hidden mask canvas for full resolution */}
                <canvas
                    ref={maskCanvasRef}
                    style={{ display: "none" }}
                />
            </div>

            <div style={{ marginTop: "8px" }}>
                <Text variant="bodySm" tone="subdued">
                    {paintMode === "keep"
                        ? "Paint green over what you want to KEEP"
                        : "Paint red over what you want to REMOVE"}
                </Text>
            </div>
        </div>
    );
}
