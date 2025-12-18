import { useRef, useEffect, useState, useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import {
    InlineStack,
    Button,
    Text,
    BlockStack,
    Badge,
    Banner,
    Spinner,
} from "@shopify/polaris";

/**
 * SAMSelectionCanvas - Click on product to select it using Meta SAM 2
 *
 * Flow:
 * 1. Show product image
 * 2. User clicks on the PRODUCT they want to keep
 * 3. Call SAM API → Get mask preview (green = keep, red = remove)
 * 4. User can add more points to refine selection
 * 5. User applies → Generates transparent PNG
 *
 * This is how Adobe/Canva work - click on what you want to KEEP.
 */
export function SAMSelectionCanvas({
    productId,
    imageUrl,
    width = 580,
    height = 450,
    onSuccess,
    disabled = false,
}) {
    // Canvas ref
    const canvasRef = useRef(null);
    const imageRef = useRef(null);

    // State
    const [imageLoaded, setImageLoaded] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0, scale: 1 });
    const [points, setPoints] = useState([]); // { x, y, label } - normalized 0-1
    const [maskOverlayUrl, setMaskOverlayUrl] = useState(null);
    const [error, setError] = useState(null);

    // Fetchers for API calls
    const previewFetcher = useFetcher();
    const applyFetcher = useFetcher();

    const isLoading = previewFetcher.state !== "idle" || applyFetcher.state !== "idle";

    // Load image
    useEffect(() => {
        if (!imageUrl) return;

        setImageLoaded(false);
        setPoints([]);
        setMaskOverlayUrl(null);
        setError(null);

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
                displayWidth: Math.round(displayWidth),
                displayHeight: Math.round(displayHeight),
                naturalWidth: img.width,
                naturalHeight: img.height,
                scale: img.width / displayWidth,
            });
            setImageLoaded(true);
        };
        img.onerror = () => {
            setError("Failed to load image");
        };
        img.src = imageUrl;
    }, [imageUrl, width, height]);

    // Draw canvas
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imageRef.current;
        if (!canvas || !img || !imageLoaded) return;

        const ctx = canvas.getContext("2d");
        canvas.width = dimensions.displayWidth;
        canvas.height = dimensions.displayHeight;

        // Draw original image
        ctx.drawImage(img, 0, 0, dimensions.displayWidth, dimensions.displayHeight);

        // Draw points
        points.forEach((pt) => {
            const x = pt.x * dimensions.displayWidth;
            const y = pt.y * dimensions.displayHeight;

            // Draw point marker
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.fillStyle = pt.label === 1 ? "rgba(34, 197, 94, 0.8)" : "rgba(239, 68, 68, 0.8)";
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw + or - symbol
            ctx.fillStyle = "white";
            ctx.font = "bold 16px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(pt.label === 1 ? "+" : "−", x, y);
        });
    }, [imageLoaded, dimensions, points]);

    // Re-render when state changes
    useEffect(() => {
        renderCanvas();
    }, [renderCanvas]);

    // Handle click on canvas
    const handleCanvasClick = useCallback(
        (e) => {
            if (disabled || isLoading) return;

            const canvas = canvasRef.current;
            const rect = canvas.getBoundingClientRect();

            // Calculate normalized coordinates (0-1)
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;

            // Determine label based on current mode
            // First click = include (1), subsequent clicks follow selection mode
            const label = e.shiftKey ? 0 : 1; // Shift+click = exclude

            const newPoint = { x, y, label };
            const newPoints = [...points, newPoint];
            setPoints(newPoints);

            // Call SAM preview API
            setError(null);
            const formData = new FormData();
            formData.append("productId", productId);
            formData.append("points", JSON.stringify(newPoints));

            previewFetcher.submit(formData, {
                method: "post",
                action: "/api/products/segment-preview",
            });
        },
        [disabled, isLoading, points, productId, previewFetcher]
    );

    // Handle preview result
    useEffect(() => {
        if (previewFetcher.data && previewFetcher.state === "idle") {
            if (previewFetcher.data.success) {
                setMaskOverlayUrl(previewFetcher.data.maskOverlayUrl);
            } else {
                setError(previewFetcher.data.error || "Failed to generate preview");
            }
        }
    }, [previewFetcher.data, previewFetcher.state]);

    // Apply the selection
    const handleApply = useCallback(() => {
        if (points.length === 0) {
            setError("Please click on the product first");
            return;
        }

        setError(null);
        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("points", JSON.stringify(points));

        applyFetcher.submit(formData, {
            method: "post",
            action: "/api/products/segment-apply",
        });
    }, [points, productId, applyFetcher]);

    // Handle apply result
    useEffect(() => {
        if (applyFetcher.data && applyFetcher.state === "idle") {
            if (applyFetcher.data.success) {
                onSuccess?.(applyFetcher.data.preparedImageUrl);
            } else {
                setError(applyFetcher.data.error || "Failed to apply selection");
            }
        }
    }, [applyFetcher.data, applyFetcher.state, onSuccess]);

    // Clear all points and start over
    const handleClear = useCallback(() => {
        setPoints([]);
        setMaskOverlayUrl(null);
        setError(null);
    }, []);

    // Undo last point
    const handleUndo = useCallback(() => {
        if (points.length === 0) return;

        const newPoints = points.slice(0, -1);
        setPoints(newPoints);

        if (newPoints.length > 0) {
            // Regenerate preview with remaining points
            const formData = new FormData();
            formData.append("productId", productId);
            formData.append("points", JSON.stringify(newPoints));

            previewFetcher.submit(formData, {
                method: "post",
                action: "/api/products/segment-preview",
            });
        } else {
            setMaskOverlayUrl(null);
        }
    }, [points, productId, previewFetcher]);

    if (!imageLoaded) {
        return (
            <div
                style={{
                    width,
                    height: 200,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f5f5f5",
                    borderRadius: "8px",
                }}
            >
                <Spinner size="large" />
            </div>
        );
    }

    return (
        <BlockStack gap="300">
            {/* Instructions */}
            <Banner tone="info">
                <p>
                    <strong>Click on the product</strong> you want to keep. Green areas will be kept, red areas removed.
                    <br />
                    <strong>Shift+click</strong> to mark areas to REMOVE. Add more points to refine selection.
                </p>
            </Banner>

            {/* Error message */}
            {error && (
                <Banner tone="critical" onDismiss={() => setError(null)}>
                    <p>{error}</p>
                </Banner>
            )}

            {/* Canvas area */}
            <div style={{ position: "relative", display: "inline-block" }}>
                {/* Original image with click handlers */}
                <canvas
                    ref={canvasRef}
                    onClick={handleCanvasClick}
                    style={{
                        display: "block",
                        border: "2px solid #2563eb",
                        borderRadius: "8px",
                        cursor: disabled || isLoading ? "not-allowed" : "crosshair",
                        opacity: disabled ? 0.5 : 1,
                    }}
                />

                {/* Mask overlay */}
                {maskOverlayUrl && (
                    <img
                        src={maskOverlayUrl}
                        alt="Selection preview"
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: dimensions.displayWidth,
                            height: dimensions.displayHeight,
                            borderRadius: "8px",
                            pointerEvents: "none",
                            opacity: 0.7,
                        }}
                    />
                )}

                {/* Loading overlay */}
                {isLoading && (
                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: dimensions.displayWidth,
                            height: dimensions.displayHeight,
                            background: "rgba(255,255,255,0.7)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "8px",
                        }}
                    >
                        <BlockStack gap="200" inlineAlign="center">
                            <Spinner size="large" />
                            <Text variant="bodyMd">
                                {previewFetcher.state !== "idle" ? "Getting selection..." : "Applying..."}
                            </Text>
                        </BlockStack>
                    </div>
                )}
            </div>

            {/* Status */}
            <InlineStack gap="200" blockAlign="center">
                <Badge tone={points.length > 0 ? "success" : "info"}>
                    {points.length === 0
                        ? "Click on product to start"
                        : `${points.length} point${points.length > 1 ? "s" : ""} selected`}
                </Badge>
                {points.filter((p) => p.label === 1).length > 0 && (
                    <Badge tone="success">
                        {points.filter((p) => p.label === 1).length} keep
                    </Badge>
                )}
                {points.filter((p) => p.label === 0).length > 0 && (
                    <Badge tone="critical">
                        {points.filter((p) => p.label === 0).length} remove
                    </Badge>
                )}
            </InlineStack>

            {/* Action buttons */}
            <InlineStack gap="200">
                <Button
                    variant="primary"
                    onClick={handleApply}
                    loading={applyFetcher.state !== "idle"}
                    disabled={points.length === 0 || disabled}
                >
                    ✓ Apply Selection
                </Button>
                <Button onClick={handleUndo} disabled={points.length === 0 || isLoading}>
                    ↩ Undo
                </Button>
                <Button onClick={handleClear} disabled={points.length === 0 || isLoading}>
                    ✕ Clear All
                </Button>
            </InlineStack>

            <Text variant="bodySm" tone="subdued">
                Powered by Meta SAM 2 • Green = keep, Red = remove
            </Text>
        </BlockStack>
    );
}
