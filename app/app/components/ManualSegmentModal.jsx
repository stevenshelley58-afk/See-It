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
} from "@shopify/polaris";
import { PaintBrushCanvas } from "./PaintBrushCanvas";

/**
 * ManualSegmentModal - Background removal with paint tool
 *
 * Flow:
 * 1. Auto Remove - One click, uses AI (Prodia)
 * 2. Paint & Remove - User paints what to keep/remove, instant local processing
 * 3. Upload - User uploads their own transparent PNG
 * 4. Use Original - Keep the original image
 *
 * New features:
 * - Paint brush tool (replaces click points)
 * - Image selector (pick from product images)
 * - Streaming progress indicators
 */
export function ManualSegmentModal({
    open,
    onClose,
    productId,
    productTitle,
    sourceImageUrl,
    productImages = [], // Array of {url, altText} for image selection
    onSuccess,
}) {
    const [previewUrl, setPreviewUrl] = useState(null);
    const [processingTime, setProcessingTime] = useState(null);
    const [error, setError] = useState(null);
    const [mode, setMode] = useState("auto"); // "auto" | "paint" | "upload" | "original"
    const [uploadedFile, setUploadedFile] = useState(null);

    // Image selection
    const [selectedImageUrl, setSelectedImageUrl] = useState(sourceImageUrl);

    // Paint mode state
    const [maskDataUrl, setMaskDataUrl] = useState(null);

    // Progress state for streaming-style updates
    const [progressStage, setProgressStage] = useState("");
    const [progressPercent, setProgressPercent] = useState(0);

    const autoFetcher = useFetcher();
    const paintFetcher = useFetcher();
    const uploadFetcher = useFetcher();
    const originalFetcher = useFetcher();

    const isLoading =
        autoFetcher.state !== "idle" ||
        paintFetcher.state !== "idle" ||
        uploadFetcher.state !== "idle" ||
        originalFetcher.state !== "idle";

    // Progress simulation for better UX
    const progressIntervalRef = useRef(null);

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

        // Start immediately
        advance();

        // Continue advancing
        progressIntervalRef.current = setInterval(advance, 800);
    }, []);

    const stopProgress = useCallback((success = true) => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
        if (success) {
            setProgressStage("Complete!");
            setProgressPercent(100);
            setTimeout(() => {
                setProgressStage("");
                setProgressPercent(0);
            }, 1000);
        } else {
            setProgressStage("");
            setProgressPercent(0);
        }
    }, []);

    // Update selected image when sourceImageUrl changes
    useEffect(() => {
        setSelectedImageUrl(sourceImageUrl);
    }, [sourceImageUrl]);

    // Auto remove background - one click!
    const handleAutoRemove = useCallback(() => {
        setError(null);
        setPreviewUrl(null);

        startProgress([
            "Sending to AI...",
            "Detecting product...",
            "Removing background...",
            "Finalizing...",
        ]);

        const formData = new FormData();
        formData.append("productId", productId);

        autoFetcher.submit(formData, {
            method: "post",
            action: "/api/products/remove-background",
        });
    }, [productId, autoFetcher, startProgress]);

    // Handle auto result
    useEffect(() => {
        if (autoFetcher.data && autoFetcher.state === "idle") {
            if (autoFetcher.data.success) {
                stopProgress(true);
                setPreviewUrl(autoFetcher.data.preparedImageUrl);
                setProcessingTime(autoFetcher.data.processingTimeMs);
            } else if (autoFetcher.data.error) {
                stopProgress(false);
                setError(autoFetcher.data.error);
            }
        }
    }, [autoFetcher.data, autoFetcher.state, stopProgress]);

    // Apply painted mask
    const handlePaintApply = useCallback(() => {
        if (!maskDataUrl) {
            setError("Paint on the image first to select what to keep/remove");
            return;
        }

        setError(null);
        setPreviewUrl(null);

        startProgress([
            "Processing mask...",
            "Applying transparency...",
            "Saving...",
        ]);

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("maskDataUrl", maskDataUrl);
        if (selectedImageUrl !== sourceImageUrl) {
            formData.append("imageUrl", selectedImageUrl);
        }

        paintFetcher.submit(formData, {
            method: "post",
            action: "/api/products/apply-mask",
        });
    }, [maskDataUrl, productId, selectedImageUrl, sourceImageUrl, paintFetcher, startProgress]);

    // Handle paint result
    useEffect(() => {
        if (paintFetcher.data && paintFetcher.state === "idle") {
            if (paintFetcher.data.success) {
                stopProgress(true);
                setPreviewUrl(paintFetcher.data.preparedImageUrl);
                setProcessingTime(paintFetcher.data.processingTimeMs);
            } else if (paintFetcher.data.error) {
                stopProgress(false);
                setError(paintFetcher.data.error);
            }
        }
    }, [paintFetcher.data, paintFetcher.state, stopProgress]);

    // Handle file drop
    const handleDrop = useCallback((_dropFiles, acceptedFiles) => {
        if (acceptedFiles.length > 0) {
            setUploadedFile(acceptedFiles[0]);
            setError(null);
        }
    }, []);

    // Submit uploaded file
    const handleUploadSubmit = useCallback(() => {
        if (!uploadedFile) return;

        startProgress(["Uploading...", "Processing...", "Saving..."]);

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("image", uploadedFile);

        uploadFetcher.submit(formData, {
            method: "post",
            action: "/api/products/upload-prepared",
            encType: "multipart/form-data",
        });
    }, [productId, uploadedFile, uploadFetcher, startProgress]);

    // Handle upload result
    useEffect(() => {
        if (uploadFetcher.data && uploadFetcher.state === "idle") {
            stopProgress(uploadFetcher.data.success);
            if (uploadFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else if (uploadFetcher.data.error) {
                setError(uploadFetcher.data.error);
            }
        }
    }, [uploadFetcher.data, uploadFetcher.state, onSuccess, onClose, stopProgress]);

    // Use original
    const handleUseOriginal = useCallback(() => {
        startProgress(["Saving..."]);

        const formData = new FormData();
        formData.append("productId", productId);

        originalFetcher.submit(formData, {
            method: "post",
            action: "/api/products/use-original",
        });
    }, [productId, originalFetcher, startProgress]);

    // Handle original result
    useEffect(() => {
        if (originalFetcher.data && originalFetcher.state === "idle") {
            stopProgress(originalFetcher.data.success);
            if (originalFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else if (originalFetcher.data.error) {
                setError(originalFetcher.data.error);
            }
        }
    }, [originalFetcher.data, originalFetcher.state, onSuccess, onClose, stopProgress]);

    // Confirm and close
    const handleConfirm = useCallback(() => {
        onSuccess?.();
        onClose();
    }, [onSuccess, onClose]);

    // Reset state on close
    const handleClose = useCallback(() => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
        }
        setPreviewUrl(null);
        setProcessingTime(null);
        setError(null);
        setMode("auto");
        setUploadedFile(null);
        setMaskDataUrl(null);
        setProgressStage("");
        setProgressPercent(0);
        setSelectedImageUrl(sourceImageUrl);
        onClose();
    }, [onClose, sourceImageUrl]);

    // Switch mode and reset
    const switchMode = useCallback((newMode) => {
        setMode(newMode);
        setPreviewUrl(null);
        setError(null);
        setMaskDataUrl(null);
    }, []);

    // All product images including featured
    const allImages = productImages.length > 0
        ? productImages
        : sourceImageUrl
            ? [{ url: sourceImageUrl, altText: productTitle }]
            : [];

    return (
        <Modal
            open={open}
            onClose={handleClose}
            title={`Fix Background: ${productTitle}`}
            large
        >
            <Modal.Section>
                <BlockStack gap="400">
                    {error && (
                        <Banner tone="critical" onDismiss={() => setError(null)}>
                            <p>{error}</p>
                        </Banner>
                    )}

                    {/* Progress indicator */}
                    {progressStage && (
                        <div style={{ marginBottom: "8px" }}>
                            <BlockStack gap="200">
                                <InlineStack align="space-between">
                                    <Text variant="bodySm" fontWeight="medium">
                                        {progressStage}
                                    </Text>
                                    <Text variant="bodySm" tone="subdued">
                                        {Math.round(progressPercent)}%
                                    </Text>
                                </InlineStack>
                                <ProgressBar progress={progressPercent} size="small" />
                            </BlockStack>
                        </div>
                    )}

                    {/* Mode tabs */}
                    <InlineStack gap="200">
                        <Button
                            variant={mode === "auto" ? "primary" : "tertiary"}
                            onClick={() => switchMode("auto")}
                            disabled={isLoading}
                            size="slim"
                        >
                            Auto Remove
                        </Button>
                        <Button
                            variant={mode === "paint" ? "primary" : "tertiary"}
                            onClick={() => switchMode("paint")}
                            disabled={isLoading}
                            size="slim"
                        >
                            Paint & Remove
                        </Button>
                        <Button
                            variant={mode === "upload" ? "primary" : "tertiary"}
                            onClick={() => switchMode("upload")}
                            disabled={isLoading}
                            size="slim"
                        >
                            Upload
                        </Button>
                        <Button
                            variant={mode === "original" ? "primary" : "tertiary"}
                            onClick={() => switchMode("original")}
                            disabled={isLoading}
                            size="slim"
                        >
                            Use Original
                        </Button>
                    </InlineStack>

                    {/* Image selector (when multiple images available) */}
                    {allImages.length > 1 && (mode === "auto" || mode === "paint") && (
                        <BlockStack gap="200">
                            <Text variant="bodySm" fontWeight="medium">Select image:</Text>
                            <InlineStack gap="200" wrap>
                                {allImages.map((img, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => !isLoading && setSelectedImageUrl(img.url)}
                                        style={{
                                            cursor: isLoading ? "not-allowed" : "pointer",
                                            border: selectedImageUrl === img.url
                                                ? "2px solid #2563eb"
                                                : "1px solid #ddd",
                                            borderRadius: "6px",
                                            overflow: "hidden",
                                            opacity: isLoading ? 0.5 : 1,
                                        }}
                                    >
                                        <img
                                            src={img.url}
                                            alt={img.altText || `Image ${idx + 1}`}
                                            style={{
                                                width: "60px",
                                                height: "60px",
                                                objectFit: "cover",
                                                display: "block",
                                            }}
                                        />
                                    </div>
                                ))}
                            </InlineStack>
                        </BlockStack>
                    )}

                    {/* AUTO MODE - Simple one-click */}
                    {mode === "auto" && (
                        <BlockStack gap="300">
                            <InlineStack gap="400" align="start" wrap={false}>
                                {/* Original image */}
                                <Box>
                                    <Text variant="bodySm" tone="subdued">Original:</Text>
                                    <div
                                        style={{
                                            border: "1px solid #ddd",
                                            borderRadius: "8px",
                                            overflow: "hidden",
                                            maxWidth: "300px",
                                        }}
                                    >
                                        <img
                                            src={selectedImageUrl}
                                            alt={productTitle}
                                            style={{ display: "block", width: "100%", height: "auto" }}
                                        />
                                    </div>
                                </Box>

                                {/* Arrow */}
                                <Box paddingBlockStart="800">
                                    <Text variant="headingLg">→</Text>
                                </Box>

                                {/* Result preview */}
                                <Box>
                                    <Text variant="bodySm" tone="subdued">
                                        {previewUrl ? "Result:" : "Preview:"}
                                    </Text>
                                    <div
                                        style={{
                                            border: previewUrl ? "2px solid #22c55e" : "1px dashed #ccc",
                                            borderRadius: "8px",
                                            overflow: "hidden",
                                            maxWidth: "300px",
                                            minHeight: "200px",
                                            background: previewUrl
                                                ? "repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px"
                                                : "#f5f5f5",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                        }}
                                    >
                                        {previewUrl ? (
                                            <img
                                                src={previewUrl}
                                                alt={`${productTitle} - processed`}
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
                                            Save
                                        </Button>
                                        <Button onClick={handleAutoRemove} loading={autoFetcher.state !== "idle"}>
                                            Try Again
                                        </Button>
                                        <Button onClick={() => switchMode("paint")}>
                                            Fix Manually
                                        </Button>
                                    </>
                                )}
                            </InlineStack>

                            {processingTime && (
                                <Text variant="bodySm" tone="subdued">
                                    Processed in {(processingTime / 1000).toFixed(1)}s
                                </Text>
                            )}
                        </BlockStack>
                    )}

                    {/* PAINT MODE - Brush tool */}
                    {mode === "paint" && (
                        <BlockStack gap="300">
                            <Banner tone="info">
                                <p>Paint green over what you want to <strong>KEEP</strong>. Paint red over what you want to <strong>REMOVE</strong>. Then click "Apply".</p>
                            </Banner>

                            <InlineStack gap="400" align="start" wrap>
                                {/* Paint canvas */}
                                <Box>
                                    <PaintBrushCanvas
                                        imageUrl={selectedImageUrl}
                                        width={350}
                                        height={350}
                                        onMaskChange={setMaskDataUrl}
                                        disabled={isLoading}
                                    />
                                </Box>

                                {/* Result preview */}
                                {previewUrl && (
                                    <Box>
                                        <Text variant="bodySm" tone="subdued">Result:</Text>
                                        <div
                                            style={{
                                                border: "2px solid #22c55e",
                                                borderRadius: "8px",
                                                overflow: "hidden",
                                                maxWidth: "300px",
                                                background: "repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px",
                                            }}
                                        >
                                            <img
                                                src={previewUrl}
                                                alt={`${productTitle} - processed`}
                                                style={{ display: "block", width: "100%", height: "auto" }}
                                            />
                                        </div>
                                    </Box>
                                )}
                            </InlineStack>

                            <InlineStack gap="200">
                                {!previewUrl ? (
                                    <Button
                                        variant="primary"
                                        onClick={handlePaintApply}
                                        loading={paintFetcher.state !== "idle"}
                                        disabled={!maskDataUrl}
                                    >
                                        Apply Mask
                                    </Button>
                                ) : (
                                    <>
                                        <Button variant="primary" onClick={handleConfirm}>
                                            Save
                                        </Button>
                                        <Button onClick={() => { setPreviewUrl(null); setMaskDataUrl(null); }}>
                                            Try Again
                                        </Button>
                                    </>
                                )}
                            </InlineStack>
                        </BlockStack>
                    )}

                    {/* UPLOAD MODE */}
                    {mode === "upload" && (
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
                                    <DropZone.FileUpload actionHint="Drop image or click to upload" />
                                )}
                            </DropZone>

                            {uploadedFile && (
                                <Button
                                    variant="primary"
                                    onClick={handleUploadSubmit}
                                    loading={uploadFetcher.state !== "idle"}
                                >
                                    Upload & Save
                                </Button>
                            )}
                        </BlockStack>
                    )}

                    {/* ORIGINAL MODE */}
                    {mode === "original" && (
                        <BlockStack gap="300">
                            <Text variant="bodyMd">
                                Use the original image without removing the background.
                            </Text>

                            <div
                                style={{
                                    border: "1px solid #ddd",
                                    borderRadius: "8px",
                                    overflow: "hidden",
                                    maxWidth: "300px",
                                }}
                            >
                                <img
                                    src={sourceImageUrl}
                                    alt={productTitle}
                                    style={{ display: "block", width: "100%", height: "auto" }}
                                />
                            </div>

                            <Button
                                variant="primary"
                                onClick={handleUseOriginal}
                                loading={originalFetcher.state !== "idle"}
                            >
                                Use Original
                            </Button>
                        </BlockStack>
                    )}
                </BlockStack>
            </Modal.Section>
        </Modal>
    );
}
