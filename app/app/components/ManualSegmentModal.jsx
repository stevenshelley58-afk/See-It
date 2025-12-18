import { useState, useCallback, useRef, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import {
    Modal,
    BlockStack,
    InlineStack,
    Text,
    Button,
    Banner,
    DropZone,
    Thumbnail,
    Box,
    ProgressBar,
    Spinner,
    RangeSlider,
} from "@shopify/polaris";

/**
 * ManualSegmentModal - Simple background removal
 *
 * Flow:
 * 1. Prodia auto-removes background (fast, one-click)
 * 2. If not perfect → Draw over the product to keep
 * 3. Upload as fallback
 */
export function ManualSegmentModal({
    open,
    onClose,
    productId,
    productTitle,
    sourceImageUrl,
    productImages = [],
    onSuccess,
}) {
    // State
    const [step, setStep] = useState("auto"); // "auto" | "draw" | "upload"
    const [previewUrl, setPreviewUrl] = useState(null);
    const [error, setError] = useState(null);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [selectedImageUrl, setSelectedImageUrl] = useState(sourceImageUrl);

    // Draw mode state
    const [imageDimensions, setImageDimensions] = useState(null);
    const [brushSize, setBrushSize] = useState(30);
    const [isDrawing, setIsDrawing] = useState(false);

    // Canvas refs
    const canvasRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const imageRef = useRef(null);

    // Progress
    const [progressStage, setProgressStage] = useState("");
    const [progressPercent, setProgressPercent] = useState(0);
    const progressIntervalRef = useRef(null);

    // Fetchers
    const autoFetcher = useFetcher();
    const maskFetcher = useFetcher();
    const uploadFetcher = useFetcher();

    const isLoading =
        autoFetcher.state !== "idle" ||
        maskFetcher.state !== "idle" ||
        uploadFetcher.state !== "idle";

    // Progress helpers
    const startProgress = useCallback((stages) => {
        let currentStage = 0;
        let currentPercent = 0;
        const advance = () => {
            if (currentStage < stages.length) {
                setProgressStage(stages[currentStage]);
                currentPercent = Math.min(95, currentPercent + Math.random() * 15 + 5);
                setProgressPercent(currentPercent);
                if (currentPercent >= (currentStage + 1) * (90 / stages.length)) {
                    currentStage++;
                }
            }
        };
        advance();
        progressIntervalRef.current = setInterval(advance, 600);
    }, []);

    const stopProgress = useCallback((success = true) => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
        if (success) {
            setProgressStage("Done!");
            setProgressPercent(100);
            setTimeout(() => {
                setProgressStage("");
                setProgressPercent(0);
            }, 800);
        } else {
            setProgressStage("");
            setProgressPercent(0);
        }
    }, []);

    // Update selected image when prop changes
    useEffect(() => {
        setSelectedImageUrl(sourceImageUrl);
    }, [sourceImageUrl]);

    // === AUTO REMOVE (Prodia) ===
    const handleAutoRemove = useCallback(() => {
        setError(null);
        setPreviewUrl(null);
        startProgress(["Sending to AI...", "Removing background...", "Finalizing..."]);

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("imageUrl", selectedImageUrl);

        autoFetcher.submit(formData, {
            method: "post",
            action: "/api/products/remove-background",
        });
    }, [productId, selectedImageUrl, autoFetcher, startProgress]);

    // Handle auto result
    useEffect(() => {
        if (autoFetcher.data && autoFetcher.state === "idle") {
            stopProgress(autoFetcher.data.success);
            if (autoFetcher.data.success) {
                setPreviewUrl(autoFetcher.data.preparedImageUrl);
            } else {
                setError(autoFetcher.data.error || "Failed to remove background");
            }
        }
    }, [autoFetcher.data, autoFetcher.state, stopProgress]);

    // === DRAW MODE ===
    const handleStartDraw = useCallback(() => {
        setStep("draw");
    }, []);

    // Load image for canvas
    useEffect(() => {
        if (step !== "draw" || !selectedImageUrl) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            imageRef.current = img;
            const maxWidth = 580;
            const maxHeight = 450;
            const aspectRatio = img.width / img.height;
            let displayWidth = maxWidth;
            let displayHeight = maxWidth / aspectRatio;
            if (displayHeight > maxHeight) {
                displayHeight = maxHeight;
                displayWidth = maxHeight * aspectRatio;
            }
            setImageDimensions({
                displayWidth: Math.round(displayWidth),
                displayHeight: Math.round(displayHeight),
                naturalWidth: img.width,
                naturalHeight: img.height,
            });
        };
        img.src = selectedImageUrl;
    }, [step, selectedImageUrl]);

    // Initialize mask canvas
    useEffect(() => {
        if (step !== "draw" || !maskCanvasRef.current || !imageDimensions) return;

        const maskCanvas = maskCanvasRef.current;
        maskCanvas.width = imageDimensions.naturalWidth;
        maskCanvas.height = imageDimensions.naturalHeight;
        const ctx = maskCanvas.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }, [step, imageDimensions]);

    // Draw main canvas with overlay
    const renderCanvas = useCallback(() => {
        if (!canvasRef.current || !imageRef.current || !imageDimensions) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        canvas.width = imageDimensions.displayWidth;
        canvas.height = imageDimensions.displayHeight;

        // Draw image
        ctx.drawImage(imageRef.current, 0, 0, imageDimensions.displayWidth, imageDimensions.displayHeight);

        // Draw mask overlay
        if (maskCanvasRef.current) {
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = imageDimensions.displayWidth;
            tempCanvas.height = imageDimensions.displayHeight;
            const tempCtx = tempCanvas.getContext("2d");
            tempCtx.drawImage(maskCanvasRef.current, 0, 0, imageDimensions.displayWidth, imageDimensions.displayHeight);

            const maskData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            for (let i = 0; i < maskData.data.length; i += 4) {
                if (maskData.data[i] > 128) {
                    maskData.data[i] = 34;
                    maskData.data[i + 1] = 197;
                    maskData.data[i + 2] = 94;
                    maskData.data[i + 3] = 150;
                } else {
                    maskData.data[i + 3] = 0;
                }
            }
            tempCtx.putImageData(maskData, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0);
        }
    }, [imageDimensions]);

    useEffect(() => {
        renderCanvas();
    }, [renderCanvas]);

    // Drawing handlers
    const getDrawCoords = useCallback((e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const scaleX = imageDimensions.naturalWidth / rect.width;
        const scaleY = imageDimensions.naturalHeight / rect.height;

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
    }, [imageDimensions]);

    const drawOnMask = useCallback((x, y) => {
        if (!maskCanvasRef.current || !imageDimensions) return;

        const ctx = maskCanvasRef.current.getContext("2d");
        const scaledBrush = brushSize * (imageDimensions.naturalWidth / imageDimensions.displayWidth);

        ctx.beginPath();
        ctx.arc(x, y, scaledBrush / 2, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();
    }, [brushSize, imageDimensions]);

    const handleDrawStart = useCallback((e) => {
        if (isLoading || !imageDimensions) return;
        e.preventDefault();
        setIsDrawing(true);
        const coords = getDrawCoords(e);
        drawOnMask(coords.x, coords.y);
        renderCanvas();
    }, [isLoading, imageDimensions, getDrawCoords, drawOnMask, renderCanvas]);

    const handleDrawMove = useCallback((e) => {
        if (!isDrawing || !imageDimensions) return;
        e.preventDefault();
        const coords = getDrawCoords(e);
        drawOnMask(coords.x, coords.y);
        renderCanvas();
    }, [isDrawing, imageDimensions, getDrawCoords, drawOnMask, renderCanvas]);

    const handleDrawEnd = useCallback(() => {
        setIsDrawing(false);
    }, []);

    // Apply drawn mask
    const handleApplyDrawn = useCallback(() => {
        if (!maskCanvasRef.current) return;

        startProgress(["Sending to AI...", "Refining edges...", "Creating transparent image..."]);

        const maskDataUrl = maskCanvasRef.current.toDataURL("image/png");

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("maskDataUrl", maskDataUrl);
        formData.append("imageUrl", selectedImageUrl);

        maskFetcher.submit(formData, {
            method: "post",
            action: "/api/products/apply-mask",
        });
    }, [productId, selectedImageUrl, maskFetcher, startProgress]);

    // Handle mask apply result
    useEffect(() => {
        if (maskFetcher.data && maskFetcher.state === "idle") {
            stopProgress(maskFetcher.data.success);
            if (maskFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else {
                setError(maskFetcher.data.error || "Failed to apply");
            }
        }
    }, [maskFetcher.data, maskFetcher.state, stopProgress, onSuccess, onClose]);

    // Clear drawing
    const handleClearDrawing = useCallback(() => {
        if (!maskCanvasRef.current || !imageDimensions) return;
        const ctx = maskCanvasRef.current.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, imageDimensions.naturalWidth, imageDimensions.naturalHeight);
        renderCanvas();
    }, [imageDimensions, renderCanvas]);

    // === UPLOAD ===
    const handleDrop = useCallback((_dropFiles, acceptedFiles) => {
        if (acceptedFiles.length > 0) {
            setUploadedFile(acceptedFiles[0]);
            setError(null);
        }
    }, []);

    const handleUploadSubmit = useCallback(() => {
        if (!uploadedFile) return;
        startProgress(["Uploading...", "Saving..."]);

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("image", uploadedFile);

        uploadFetcher.submit(formData, {
            method: "post",
            action: "/api/products/upload-prepared",
            encType: "multipart/form-data",
        });
    }, [productId, uploadedFile, uploadFetcher, startProgress]);

    useEffect(() => {
        if (uploadFetcher.data && uploadFetcher.state === "idle") {
            stopProgress(uploadFetcher.data.success);
            if (uploadFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else {
                setError(uploadFetcher.data.error);
            }
        }
    }, [uploadFetcher.data, uploadFetcher.state, stopProgress, onSuccess, onClose]);

    // === CONFIRM ===
    const handleConfirm = useCallback(() => {
        onSuccess?.();
        onClose();
    }, [onSuccess, onClose]);

    // === CLOSE/RESET ===
    const handleClose = useCallback(() => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
        }
        setStep("auto");
        setPreviewUrl(null);
        setError(null);
        setUploadedFile(null);
        setImageDimensions(null);
        setProgressStage("");
        setProgressPercent(0);
        setSelectedImageUrl(sourceImageUrl);
        onClose();
    }, [onClose, sourceImageUrl]);

    // All images for selector
    const allImages = productImages.length > 0
        ? productImages
        : sourceImageUrl
            ? [{ url: sourceImageUrl, altText: productTitle }]
            : [];

    return (
        <Modal
            open={open}
            onClose={handleClose}
            title={`Remove Background: ${productTitle}`}
            large
        >
            <Modal.Section>
                <BlockStack gap="400">
                    {/* Error banner */}
                    {error && (
                        <Banner tone="critical" onDismiss={() => setError(null)}>
                            <p>{error}</p>
                        </Banner>
                    )}

                    {/* Progress bar */}
                    {progressStage && (
                        <BlockStack gap="200">
                            <InlineStack align="space-between">
                                <Text variant="bodySm" fontWeight="medium">{progressStage}</Text>
                                <Text variant="bodySm" tone="subdued">{Math.round(progressPercent)}%</Text>
                            </InlineStack>
                            <ProgressBar progress={progressPercent} size="small" />
                        </BlockStack>
                    )}

                    {/* === AUTO MODE === */}
                    {step === "auto" && (
                        <BlockStack gap="300">
                            {/* Image selector */}
                            {allImages.length > 1 && !previewUrl && (
                                <BlockStack gap="200">
                                    <Text variant="bodySm" fontWeight="medium">Select image:</Text>
                                    <InlineStack gap="200" wrap>
                                        {allImages.map((img, idx) => (
                                            <div
                                                key={idx}
                                                onClick={() => !isLoading && setSelectedImageUrl(img.url)}
                                                style={{
                                                    cursor: isLoading ? "not-allowed" : "pointer",
                                                    border: selectedImageUrl === img.url ? "2px solid #2563eb" : "1px solid #ddd",
                                                    borderRadius: "6px",
                                                    overflow: "hidden",
                                                    opacity: isLoading ? 0.5 : 1,
                                                }}
                                            >
                                                <img
                                                    src={img.url}
                                                    alt={img.altText || `Image ${idx + 1}`}
                                                    style={{ width: "60px", height: "60px", objectFit: "cover", display: "block" }}
                                                />
                                            </div>
                                        ))}
                                    </InlineStack>
                                </BlockStack>
                            )}

                            {/* Original → Result */}
                            <InlineStack gap="400" align="start" wrap={false}>
                                <Box>
                                    <Text variant="bodySm" tone="subdued">Original:</Text>
                                    <div style={{
                                        border: "1px solid #ddd",
                                        borderRadius: "8px",
                                        overflow: "hidden",
                                        maxWidth: "280px",
                                    }}>
                                        <img
                                            src={selectedImageUrl}
                                            alt={productTitle}
                                            style={{ display: "block", width: "100%", height: "auto" }}
                                        />
                                    </div>
                                </Box>

                                <Box paddingBlockStart="800">
                                    <Text variant="headingLg">→</Text>
                                </Box>

                                <Box>
                                    <Text variant="bodySm" tone="subdued">
                                        {previewUrl ? "Result:" : "Preview:"}
                                    </Text>
                                    <div style={{
                                        border: previewUrl ? "2px solid #22c55e" : "1px dashed #ccc",
                                        borderRadius: "8px",
                                        overflow: "hidden",
                                        maxWidth: "280px",
                                        minHeight: "180px",
                                        background: previewUrl
                                            ? "repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px"
                                            : "#f5f5f5",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}>
                                        {previewUrl ? (
                                            <img
                                                src={previewUrl}
                                                alt="Result"
                                                style={{ display: "block", width: "100%", height: "auto" }}
                                            />
                                        ) : (
                                            <Text variant="bodySm" tone="subdued">
                                                Click "Remove Background"
                                            </Text>
                                        )}
                                    </div>
                                </Box>
                            </InlineStack>

                            {/* Action buttons */}
                            <InlineStack gap="200">
                                {!previewUrl ? (
                                    <Button
                                        variant="primary"
                                        onClick={handleAutoRemove}
                                        loading={autoFetcher.state !== "idle"}
                                    >
                                        Remove Background
                                    </Button>
                                ) : (
                                    <>
                                        <Button variant="primary" onClick={handleConfirm}>
                                            Looks Good - Save
                                        </Button>
                                        <Button onClick={handleStartDraw}>
                                            Adjust
                                        </Button>
                                        <Button
                                            onClick={handleAutoRemove}
                                            loading={autoFetcher.state !== "idle"}
                                        >
                                            Try Again
                                        </Button>
                                    </>
                                )}
                                <Button onClick={() => setStep("upload")} plain>
                                    Upload instead
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    )}

                    {/* === DRAW MODE (Smart selection) === */}
                    {step === "draw" && (
                        <BlockStack gap="300">
                            <Banner tone="info">
                                <p>
                                    <strong>Paint roughly over the product</strong> you want to keep.
                                    AI will refine the edges for you - no need to be precise!
                                </p>
                            </Banner>

                            {/* Brush size */}
                            <div style={{ width: "200px" }}>
                                <RangeSlider
                                    label={`Brush: ${brushSize}px`}
                                    value={brushSize}
                                    onChange={setBrushSize}
                                    min={10}
                                    max={100}
                                    step={5}
                                />
                            </div>

                            {/* Canvas */}
                            <div style={{ position: "relative", display: "inline-block" }}>
                                {imageDimensions ? (
                                    <>
                                        <canvas
                                            ref={canvasRef}
                                            onMouseDown={handleDrawStart}
                                            onMouseMove={handleDrawMove}
                                            onMouseUp={handleDrawEnd}
                                            onMouseLeave={handleDrawEnd}
                                            onTouchStart={handleDrawStart}
                                            onTouchMove={handleDrawMove}
                                            onTouchEnd={handleDrawEnd}
                                            style={{
                                                display: "block",
                                                border: "2px solid #2563eb",
                                                borderRadius: "8px",
                                                cursor: isLoading ? "wait" : "crosshair",
                                                touchAction: "none",
                                            }}
                                        />
                                        <canvas ref={maskCanvasRef} style={{ display: "none" }} />

                                        {isLoading && (
                                            <div style={{
                                                position: "absolute",
                                                top: 0,
                                                left: 0,
                                                width: imageDimensions.displayWidth,
                                                height: imageDimensions.displayHeight,
                                                background: "rgba(255,255,255,0.7)",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                borderRadius: "8px",
                                            }}>
                                                <Spinner size="large" />
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div style={{
                                        width: 580,
                                        height: 300,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        background: "#f5f5f5",
                                        borderRadius: "8px",
                                    }}>
                                        <Spinner size="large" />
                                    </div>
                                )}
                            </div>

                            <Text variant="bodySm" tone="subdued">
                                Just paint roughly - AI detects precise edges automatically
                            </Text>

                            {/* Buttons */}
                            <InlineStack gap="200">
                                <Button
                                    variant="primary"
                                    onClick={handleApplyDrawn}
                                    loading={maskFetcher.state !== "idle"}
                                >
                                    Apply
                                </Button>
                                <Button onClick={handleClearDrawing} disabled={isLoading}>
                                    Clear
                                </Button>
                                <Button onClick={() => setStep("auto")}>
                                    Back
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    )}

                    {/* === UPLOAD MODE === */}
                    {step === "upload" && (
                        <BlockStack gap="300">
                            <Text variant="bodyMd">
                                Upload your own image with transparent background.
                            </Text>

                            <DropZone accept="image/*" type="image" onDrop={handleDrop} disabled={isLoading}>
                                {uploadedFile ? (
                                    <InlineStack gap="400" align="center" blockAlign="center">
                                        <Thumbnail
                                            source={URL.createObjectURL(uploadedFile)}
                                            alt={uploadedFile.name}
                                            size="large"
                                        />
                                        <BlockStack>
                                            <Text variant="bodyMd" fontWeight="bold">{uploadedFile.name}</Text>
                                            <Text variant="bodySm" tone="subdued">
                                                {(uploadedFile.size / 1024).toFixed(1)} KB
                                            </Text>
                                        </BlockStack>
                                    </InlineStack>
                                ) : (
                                    <DropZone.FileUpload actionHint="Drop PNG with transparency" />
                                )}
                            </DropZone>

                            <InlineStack gap="200">
                                {uploadedFile && (
                                    <Button
                                        variant="primary"
                                        onClick={handleUploadSubmit}
                                        loading={uploadFetcher.state !== "idle"}
                                    >
                                        Upload & Save
                                    </Button>
                                )}
                                <Button onClick={() => setStep("auto")}>
                                    Back
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    )}
                </BlockStack>
            </Modal.Section>
        </Modal>
    );
}
