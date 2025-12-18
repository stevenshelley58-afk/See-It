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
import { SmartBrushCanvas } from "./SmartBrushCanvas";

/**
 * ManualSegmentModal - Background removal with smart refinement
 *
 * Flow:
 * 1. Auto Remove - AI removes background (Prodia ~190ms)
 * 2. Preview result
 * 3. If not perfect → Refine with smart brush
 *    - "Restore" brush: Bring back areas AI incorrectly removed
 *    - "Erase" brush: Remove areas AI missed
 * 4. Save
 *
 * This matches how Canva/Adobe/Photoroom work:
 * - AI does the heavy lifting
 * - Smart brush is for REFINEMENT only
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
    const [mode, setMode] = useState("auto"); // "auto" | "refine" | "upload" | "original"
    const [previewUrl, setPreviewUrl] = useState(null);
    const [refinedImageData, setRefinedImageData] = useState(null);
    const [processingTime, setProcessingTime] = useState(null);
    const [error, setError] = useState(null);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [selectedImageUrl, setSelectedImageUrl] = useState(sourceImageUrl);

    // Progress state
    const [progressStage, setProgressStage] = useState("");
    const [progressPercent, setProgressPercent] = useState(0);
    const progressIntervalRef = useRef(null);

    // Fetchers
    const autoFetcher = useFetcher();
    const saveFetcher = useFetcher();
    const uploadFetcher = useFetcher();
    const originalFetcher = useFetcher();

    const isLoading =
        autoFetcher.state !== "idle" ||
        saveFetcher.state !== "idle" ||
        uploadFetcher.state !== "idle" ||
        originalFetcher.state !== "idle";

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

    // === AUTO REMOVE ===
    const handleAutoRemove = useCallback(() => {
        setError(null);
        setPreviewUrl(null);
        setRefinedImageData(null);

        startProgress([
            "Sending to AI...",
            "Analyzing image...",
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
            stopProgress(autoFetcher.data.success);
            if (autoFetcher.data.success) {
                setPreviewUrl(autoFetcher.data.preparedImageUrl);
                setProcessingTime(autoFetcher.data.processingTimeMs);
            } else {
                setError(autoFetcher.data.error || "Failed to remove background");
            }
        }
    }, [autoFetcher.data, autoFetcher.state, stopProgress]);

    // === REFINE MODE ===
    const handleStartRefine = useCallback(() => {
        if (!previewUrl) return;
        setMode("refine");
    }, [previewUrl]);

    const handleRefinedImage = useCallback((dataUrl) => {
        setRefinedImageData(dataUrl);
    }, []);

    // Save refined image
    const handleSaveRefined = useCallback(() => {
        if (!refinedImageData) {
            // No refinements made, just confirm the auto result
            onSuccess?.();
            onClose();
            return;
        }

        startProgress(["Saving refinements...", "Uploading..."]);

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("imageDataUrl", refinedImageData);

        saveFetcher.submit(formData, {
            method: "post",
            action: "/api/products/save-refined",
        });
    }, [refinedImageData, productId, saveFetcher, startProgress, onSuccess, onClose]);

    // Handle save result
    useEffect(() => {
        if (saveFetcher.data && saveFetcher.state === "idle") {
            stopProgress(saveFetcher.data.success);
            if (saveFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else {
                setError(saveFetcher.data.error || "Failed to save");
            }
        }
    }, [saveFetcher.data, saveFetcher.state, stopProgress, onSuccess, onClose]);

    // === UPLOAD ===
    const handleDrop = useCallback((_dropFiles, acceptedFiles) => {
        if (acceptedFiles.length > 0) {
            setUploadedFile(acceptedFiles[0]);
            setError(null);
        }
    }, []);

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

    // === USE ORIGINAL ===
    const handleUseOriginal = useCallback(() => {
        startProgress(["Saving..."]);

        const formData = new FormData();
        formData.append("productId", productId);

        originalFetcher.submit(formData, {
            method: "post",
            action: "/api/products/use-original",
        });
    }, [productId, originalFetcher, startProgress]);

    useEffect(() => {
        if (originalFetcher.data && originalFetcher.state === "idle") {
            stopProgress(originalFetcher.data.success);
            if (originalFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else {
                setError(originalFetcher.data.error);
            }
        }
    }, [originalFetcher.data, originalFetcher.state, stopProgress, onSuccess, onClose]);

    // === CONFIRM (save auto result without refinement) ===
    const handleConfirm = useCallback(() => {
        onSuccess?.();
        onClose();
    }, [onSuccess, onClose]);

    // === CLOSE/RESET ===
    const handleClose = useCallback(() => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
        }
        setMode("auto");
        setPreviewUrl(null);
        setRefinedImageData(null);
        setProcessingTime(null);
        setError(null);
        setUploadedFile(null);
        setProgressStage("");
        setProgressPercent(0);
        setSelectedImageUrl(sourceImageUrl);
        onClose();
    }, [onClose, sourceImageUrl]);

    const switchMode = useCallback((newMode) => {
        setMode(newMode);
        setError(null);
        if (newMode === "auto") {
            setPreviewUrl(null);
            setRefinedImageData(null);
        }
    }, []);

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

                    {/* Mode tabs */}
                    <InlineStack gap="200">
                        <Button
                            variant={mode === "auto" || mode === "refine" ? "primary" : "tertiary"}
                            onClick={() => switchMode("auto")}
                            disabled={isLoading}
                            size="slim"
                        >
                            Remove Background
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

                    {/* Image selector */}
                    {allImages.length > 1 && mode === "auto" && !previewUrl && (
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

                    {/* === AUTO MODE === */}
                    {mode === "auto" && (
                        <BlockStack gap="300">
                            <InlineStack gap="400" align="start" wrap={false}>
                                {/* Original */}
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

                                {/* Result */}
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
                                        <Button onClick={handleStartRefine}>
                                            Refine with Brush
                                        </Button>
                                        <Button
                                            onClick={handleAutoRemove}
                                            loading={autoFetcher.state !== "idle"}
                                        >
                                            Try Again
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

                    {/* === REFINE MODE === */}
                    {mode === "refine" && previewUrl && (
                        <BlockStack gap="300">
                            <Banner tone="info">
                                <p>
                                    <strong>Restore:</strong> Paint to bring back areas that were incorrectly removed.{" "}
                                    <strong>Erase:</strong> Paint to remove areas that should be transparent.
                                </p>
                            </Banner>

                            <SmartBrushCanvas
                                originalImageUrl={selectedImageUrl}
                                processedImageUrl={previewUrl}
                                width={500}
                                height={450}
                                onRefinedImage={handleRefinedImage}
                                disabled={isLoading}
                            />

                            <InlineStack gap="200">
                                <Button
                                    variant="primary"
                                    onClick={handleSaveRefined}
                                    loading={saveFetcher.state !== "idle"}
                                >
                                    Save
                                </Button>
                                <Button onClick={() => switchMode("auto")}>
                                    Back
                                </Button>
                            </InlineStack>
                        </BlockStack>
                    )}

                    {/* === UPLOAD MODE === */}
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
                                    <DropZone.FileUpload actionHint="Drop PNG with transparency" />
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

                    {/* === ORIGINAL MODE === */}
                    {mode === "original" && (
                        <BlockStack gap="300">
                            <Text variant="bodyMd">
                                Use the original image without removing the background.
                            </Text>

                            <div style={{
                                border: "1px solid #ddd",
                                borderRadius: "8px",
                                overflow: "hidden",
                                maxWidth: "300px",
                            }}>
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
