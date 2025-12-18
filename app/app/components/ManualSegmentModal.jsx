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
} from "@shopify/polaris";

/**
 * ManualSegmentModal - Simple background removal
 *
 * Flow:
 * 1. Prodia auto-removes background (fast, one-click)
 * 2. If not perfect → "Adjust" → User clicks on product to KEEP
 * 3. SAM uses that selection to segment properly
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
    const [step, setStep] = useState("auto"); // "auto" | "adjust" | "upload"
    const [previewUrl, setPreviewUrl] = useState(null);
    const [error, setError] = useState(null);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [selectedImageUrl, setSelectedImageUrl] = useState(sourceImageUrl);

    // SAM adjustment state
    const [points, setPoints] = useState([]);
    const [maskOverlayUrl, setMaskOverlayUrl] = useState(null);
    const [imageDimensions, setImageDimensions] = useState(null);
    const canvasRef = useRef(null);
    const imageRef = useRef(null);

    // Progress
    const [progressStage, setProgressStage] = useState("");
    const [progressPercent, setProgressPercent] = useState(0);
    const progressIntervalRef = useRef(null);

    // Fetchers
    const autoFetcher = useFetcher();
    const previewFetcher = useFetcher();
    const applyFetcher = useFetcher();
    const uploadFetcher = useFetcher();

    const isLoading =
        autoFetcher.state !== "idle" ||
        previewFetcher.state !== "idle" ||
        applyFetcher.state !== "idle" ||
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

    // === ADJUST MODE (SAM) ===
    const handleStartAdjust = useCallback(() => {
        setStep("adjust");
        setPoints([]);
        setMaskOverlayUrl(null);
    }, []);

    // Load image for canvas
    useEffect(() => {
        if (step !== "adjust" || !selectedImageUrl) return;

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
            });
        };
        img.src = selectedImageUrl;
    }, [step, selectedImageUrl]);

    // Draw canvas
    useEffect(() => {
        if (!canvasRef.current || !imageRef.current || !imageDimensions) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        canvas.width = imageDimensions.displayWidth;
        canvas.height = imageDimensions.displayHeight;

        ctx.drawImage(imageRef.current, 0, 0, imageDimensions.displayWidth, imageDimensions.displayHeight);

        // Draw points
        points.forEach((pt) => {
            const x = pt.x * imageDimensions.displayWidth;
            const y = pt.y * imageDimensions.displayHeight;
            ctx.beginPath();
            ctx.arc(x, y, 14, 0, Math.PI * 2);
            ctx.fillStyle = pt.label === 1 ? "rgba(34, 197, 94, 0.9)" : "rgba(239, 68, 68, 0.9)";
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fillStyle = "white";
            ctx.font = "bold 18px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(pt.label === 1 ? "+" : "−", x, y);
        });
    }, [imageDimensions, points]);

    // Handle canvas click
    const handleCanvasClick = useCallback((e) => {
        if (isLoading || !imageDimensions) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const label = e.shiftKey ? 0 : 1; // Shift = exclude

        const newPoints = [...points, { x, y, label }];
        setPoints(newPoints);

        // Get SAM preview
        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("points", JSON.stringify(newPoints));

        previewFetcher.submit(formData, {
            method: "post",
            action: "/api/products/segment-preview",
        });
    }, [isLoading, imageDimensions, points, productId, previewFetcher]);

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

    // Apply SAM selection
    const handleApplySelection = useCallback(() => {
        if (points.length === 0) return;

        startProgress(["Applying selection...", "Creating transparent image..."]);

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("points", JSON.stringify(points));

        applyFetcher.submit(formData, {
            method: "post",
            action: "/api/products/segment-apply",
        });
    }, [points, productId, applyFetcher, startProgress]);

    // Handle apply result
    useEffect(() => {
        if (applyFetcher.data && applyFetcher.state === "idle") {
            stopProgress(applyFetcher.data.success);
            if (applyFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else {
                setError(applyFetcher.data.error || "Failed to apply selection");
            }
        }
    }, [applyFetcher.data, applyFetcher.state, stopProgress, onSuccess, onClose]);

    // Undo last point
    const handleUndo = useCallback(() => {
        if (points.length === 0) return;
        const newPoints = points.slice(0, -1);
        setPoints(newPoints);
        setMaskOverlayUrl(null);

        if (newPoints.length > 0) {
            const formData = new FormData();
            formData.append("productId", productId);
            formData.append("points", JSON.stringify(newPoints));
            previewFetcher.submit(formData, {
                method: "post",
                action: "/api/products/segment-preview",
            });
        }
    }, [points, productId, previewFetcher]);

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

    // === CONFIRM (save auto result) ===
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
        setPoints([]);
        setMaskOverlayUrl(null);
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

                    {/* === AUTO MODE (default) === */}
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
                                        <Button onClick={handleStartAdjust}>
                                            Adjust Selection
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

                    {/* === ADJUST MODE (SAM) === */}
                    {step === "adjust" && (
                        <BlockStack gap="300">
                            <Banner tone="info">
                                <p>
                                    <strong>Click on the product</strong> you want to keep.
                                    Green = keep, Red = remove.
                                    <strong>Shift+click</strong> to mark areas to remove.
                                </p>
                            </Banner>

                            {/* Canvas with overlay */}
                            <div style={{ position: "relative", display: "inline-block" }}>
                                {imageDimensions ? (
                                    <>
                                        <canvas
                                            ref={canvasRef}
                                            onClick={handleCanvasClick}
                                            style={{
                                                display: "block",
                                                border: "2px solid #2563eb",
                                                borderRadius: "8px",
                                                cursor: isLoading ? "wait" : "crosshair",
                                            }}
                                        />
                                        {maskOverlayUrl && (
                                            <img
                                                src={maskOverlayUrl}
                                                alt="Preview"
                                                style={{
                                                    position: "absolute",
                                                    top: 0,
                                                    left: 0,
                                                    width: imageDimensions.displayWidth,
                                                    height: imageDimensions.displayHeight,
                                                    borderRadius: "8px",
                                                    pointerEvents: "none",
                                                    opacity: 0.6,
                                                }}
                                            />
                                        )}
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
                                {points.length === 0
                                    ? "Click on the product to start"
                                    : `${points.length} point${points.length > 1 ? "s" : ""} • Green = keep, Red = remove`}
                            </Text>

                            {/* Action buttons */}
                            <InlineStack gap="200">
                                <Button
                                    variant="primary"
                                    onClick={handleApplySelection}
                                    loading={applyFetcher.state !== "idle"}
                                    disabled={points.length === 0}
                                >
                                    Apply Selection
                                </Button>
                                <Button onClick={handleUndo} disabled={points.length === 0 || isLoading}>
                                    Undo
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
