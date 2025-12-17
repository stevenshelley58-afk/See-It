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
    Spinner,
    Box,
} from "@shopify/polaris";

/**
 * ManualSegmentModal - Simple Canva-style background remover
 *
 * Flow:
 * 1. Click "Remove Background" → auto removes in ~3 seconds
 * 2. Preview result
 * 3. Happy? Save. Not happy? Try manual selection or upload your own.
 */
export function ManualSegmentModal({
    open,
    onClose,
    productId,
    productTitle,
    sourceImageUrl,
    onSuccess,
}) {
    const [previewUrl, setPreviewUrl] = useState(null);
    const [processingTime, setProcessingTime] = useState(null);
    const [error, setError] = useState(null);
    const [mode, setMode] = useState("auto"); // "auto" | "manual" | "upload" | "original"
    const [uploadedFile, setUploadedFile] = useState(null);

    // Manual selection state
    const [clickPoints, setClickPoints] = useState([]);
    const [clickMode, setClickMode] = useState(1); // 1 = include, 0 = exclude
    const imageRef = useRef(null);

    const autoFetcher = useFetcher();
    const manualFetcher = useFetcher();
    const uploadFetcher = useFetcher();
    const originalFetcher = useFetcher();

    const isLoading =
        autoFetcher.state !== "idle" ||
        manualFetcher.state !== "idle" ||
        uploadFetcher.state !== "idle" ||
        originalFetcher.state !== "idle";

    // Auto remove background - one click!
    const handleAutoRemove = useCallback(() => {
        setError(null);
        setPreviewUrl(null);

        const formData = new FormData();
        formData.append("productId", productId);

        autoFetcher.submit(formData, {
            method: "post",
            action: "/api/products/remove-background",
        });
    }, [productId, autoFetcher]);

    // Handle auto result
    useEffect(() => {
        if (autoFetcher.data && autoFetcher.state === "idle") {
            if (autoFetcher.data.success) {
                setPreviewUrl(autoFetcher.data.preparedImageUrl);
                setProcessingTime(autoFetcher.data.processingTimeMs);
            } else if (autoFetcher.data.error) {
                setError(autoFetcher.data.error);
            }
        }
    }, [autoFetcher.data, autoFetcher.state]);

    // Manual selection click
    const handleImageClick = useCallback((e) => {
        if (isLoading || mode !== "manual") return;

        const rect = imageRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        const clickX = Math.max(0, Math.min(1, x));
        const clickY = Math.max(0, Math.min(1, y));

        setClickPoints(prev => [...prev, { x: clickX, y: clickY, label: clickMode }]);
    }, [clickMode, isLoading, mode]);

    // Apply manual selection
    const handleManualApply = useCallback(() => {
        if (clickPoints.length === 0) {
            setError("Click on the product first");
            return;
        }

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("points", JSON.stringify(clickPoints));

        manualFetcher.submit(formData, {
            method: "post",
            action: "/api/products/segment-apply",
        });
    }, [clickPoints, productId, manualFetcher]);

    // Handle manual result
    useEffect(() => {
        if (manualFetcher.data && manualFetcher.state === "idle") {
            if (manualFetcher.data.success) {
                setPreviewUrl(manualFetcher.data.preparedImageUrl);
            } else if (manualFetcher.data.error) {
                setError(manualFetcher.data.error);
            }
        }
    }, [manualFetcher.data, manualFetcher.state]);

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

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("image", uploadedFile);

        uploadFetcher.submit(formData, {
            method: "post",
            action: "/api/products/upload-prepared",
            encType: "multipart/form-data",
        });
    }, [productId, uploadedFile, uploadFetcher]);

    // Handle upload result
    useEffect(() => {
        if (uploadFetcher.data && uploadFetcher.state === "idle") {
            if (uploadFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else if (uploadFetcher.data.error) {
                setError(uploadFetcher.data.error);
            }
        }
    }, [uploadFetcher.data, uploadFetcher.state, onSuccess, onClose]);

    // Use original
    const handleUseOriginal = useCallback(() => {
        const formData = new FormData();
        formData.append("productId", productId);

        originalFetcher.submit(formData, {
            method: "post",
            action: "/api/products/use-original",
        });
    }, [productId, originalFetcher]);

    // Handle original result
    useEffect(() => {
        if (originalFetcher.data && originalFetcher.state === "idle") {
            if (originalFetcher.data.success) {
                onSuccess?.();
                onClose();
            } else if (originalFetcher.data.error) {
                setError(originalFetcher.data.error);
            }
        }
    }, [originalFetcher.data, originalFetcher.state, onSuccess, onClose]);

    // Confirm and close
    const handleConfirm = useCallback(() => {
        onSuccess?.();
        onClose();
    }, [onSuccess, onClose]);

    // Reset state on close
    const handleClose = useCallback(() => {
        setPreviewUrl(null);
        setProcessingTime(null);
        setError(null);
        setMode("auto");
        setUploadedFile(null);
        setClickPoints([]);
        setClickMode(1);
        onClose();
    }, [onClose]);

    // Switch mode and reset
    const switchMode = useCallback((newMode) => {
        setMode(newMode);
        setPreviewUrl(null);
        setError(null);
        setClickPoints([]);
    }, []);

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

                    {/* Mode tabs - subtle, not prominent */}
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
                            variant={mode === "manual" ? "primary" : "tertiary"}
                            onClick={() => switchMode("manual")}
                            disabled={isLoading}
                            size="slim"
                        >
                            Manual Select
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
                                            src={sourceImageUrl}
                                            alt={productTitle}
                                            style={{ display: "block", width: "100%", height: "auto" }}
                                        />
                                    </div>
                                </Box>

                                {/* Arrow or processing indicator */}
                                <Box paddingBlockStart="800">
                                    {isLoading ? (
                                        <Spinner size="small" />
                                    ) : (
                                        <Text variant="headingLg">→</Text>
                                    )}
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

                    {/* MANUAL MODE - Click to select */}
                    {mode === "manual" && (
                        <BlockStack gap="300">
                            <Text variant="bodyMd">
                                Click on the product to include it. Use exclude mode to remove unwanted areas.
                            </Text>

                            <InlineStack gap="200" align="center">
                                <Button
                                    pressed={clickMode === 1}
                                    onClick={() => setClickMode(1)}
                                    size="slim"
                                >
                                    + Include
                                </Button>
                                <Button
                                    pressed={clickMode === 0}
                                    onClick={() => setClickMode(0)}
                                    size="slim"
                                >
                                    − Exclude
                                </Button>
                                <Button
                                    onClick={() => setClickPoints([])}
                                    disabled={clickPoints.length === 0}
                                    size="slim"
                                >
                                    Clear
                                </Button>
                            </InlineStack>

                            <InlineStack gap="400" align="start" wrap={false}>
                                {/* Clickable image */}
                                <Box>
                                    <Text variant="bodySm" tone="subdued">Click to select:</Text>
                                    <div
                                        ref={imageRef}
                                        onClick={handleImageClick}
                                        style={{
                                            position: "relative",
                                            cursor: "crosshair",
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
                                        {/* Click points */}
                                        {clickPoints.map((point, idx) => (
                                            <div
                                                key={idx}
                                                style={{
                                                    position: "absolute",
                                                    left: `${point.x * 100}%`,
                                                    top: `${point.y * 100}%`,
                                                    transform: "translate(-50%, -50%)",
                                                    width: "20px",
                                                    height: "20px",
                                                    borderRadius: "50%",
                                                    border: `2px solid ${point.label === 1 ? "#22c55e" : "#ef4444"}`,
                                                    background: point.label === 1 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
                                                    pointerEvents: "none",
                                                }}
                                            />
                                        ))}
                                        {manualFetcher.state !== "idle" && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    background: "rgba(255,255,255,0.8)",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                <Spinner />
                                            </div>
                                        )}
                                    </div>
                                </Box>

                                {/* Result */}
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
                                        onClick={handleManualApply}
                                        loading={manualFetcher.state !== "idle"}
                                        disabled={clickPoints.length === 0}
                                    >
                                        Apply Selection
                                    </Button>
                                ) : (
                                    <>
                                        <Button variant="primary" onClick={handleConfirm}>
                                            Save
                                        </Button>
                                        <Button onClick={() => { setPreviewUrl(null); setClickPoints([]); }}>
                                            Try Again
                                        </Button>
                                    </>
                                )}
                            </InlineStack>

                            {clickPoints.length > 0 && !previewUrl && (
                                <Text variant="bodySm" tone="subdued">
                                    {clickPoints.filter(p => p.label === 1).length} include, {clickPoints.filter(p => p.label === 0).length} exclude
                                </Text>
                            )}
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
