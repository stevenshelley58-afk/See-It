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
    ButtonGroup,
} from "@shopify/polaris";

/**
 * ManualSegmentModal - Advanced segmentation with mask preview
 *
 * Flow:
 * 1. User adds click points (green = include, red = exclude)
 * 2. Click "Preview Mask" to see what will be selected
 * 3. Adjust points if needed
 * 4. Click "Apply & Save" to create final transparent PNG
 */
export function ManualSegmentModal({
    open,
    onClose,
    productId,
    productTitle,
    sourceImageUrl,
    onSuccess,
}) {
    // Click points: { x, y, label: 1 (include) | 0 (exclude) }
    const [clickPoints, setClickPoints] = useState([]);
    const [clickMode, setClickMode] = useState(1); // 1 = include (green), 0 = exclude (red)
    const [maskPreviewUrl, setMaskPreviewUrl] = useState(null);
    const [finalPreviewUrl, setFinalPreviewUrl] = useState(null);
    const [error, setError] = useState(null);
    const [mode, setMode] = useState("click"); // "click" | "upload" | "original"
    const [uploadedFile, setUploadedFile] = useState(null);
    const [step, setStep] = useState("select"); // "select" | "preview" | "done"
    const imageRef = useRef(null);

    const previewFetcher = useFetcher();
    const applyFetcher = useFetcher();
    const uploadFetcher = useFetcher();
    const originalFetcher = useFetcher();

    const isLoading =
        previewFetcher.state !== "idle" ||
        applyFetcher.state !== "idle" ||
        uploadFetcher.state !== "idle" ||
        originalFetcher.state !== "idle";

    // Handle click on image - add point
    const handleImageClick = useCallback((e) => {
        if (isLoading || step === "done") return;

        const rect = imageRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        const clickX = Math.max(0, Math.min(1, x));
        const clickY = Math.max(0, Math.min(1, y));

        setClickPoints(prev => [...prev, { x: clickX, y: clickY, label: clickMode }]);
        setMaskPreviewUrl(null); // Clear preview when points change
        setError(null);
    }, [clickMode, isLoading, step]);

    // Remove last point
    const handleUndo = useCallback(() => {
        setClickPoints(prev => prev.slice(0, -1));
        setMaskPreviewUrl(null);
    }, []);

    // Clear all points
    const handleClear = useCallback(() => {
        setClickPoints([]);
        setMaskPreviewUrl(null);
        setFinalPreviewUrl(null);
        setStep("select");
    }, []);

    // Generate mask preview
    const handlePreviewMask = useCallback(() => {
        if (clickPoints.length === 0) {
            setError("Click on the product first to add selection points");
            return;
        }

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("points", JSON.stringify(clickPoints));
        formData.append("previewOnly", "true");

        previewFetcher.submit(formData, {
            method: "post",
            action: "/api/products/segment-preview",
        });
    }, [clickPoints, productId, previewFetcher]);

    // Apply mask and create final image
    const handleApplyMask = useCallback(() => {
        if (clickPoints.length === 0) return;

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("points", JSON.stringify(clickPoints));

        applyFetcher.submit(formData, {
            method: "post",
            action: "/api/products/segment-apply",
        });
    }, [clickPoints, productId, applyFetcher]);

    // Handle preview result
    useEffect(() => {
        if (previewFetcher.data && previewFetcher.state === "idle") {
            if (previewFetcher.data.success) {
                setMaskPreviewUrl(previewFetcher.data.maskOverlayUrl);
                setStep("preview");
            } else if (previewFetcher.data.error) {
                setError(previewFetcher.data.error);
            }
        }
    }, [previewFetcher.data, previewFetcher.state]);

    // Handle apply result
    useEffect(() => {
        if (applyFetcher.data && applyFetcher.state === "idle") {
            if (applyFetcher.data.success) {
                setFinalPreviewUrl(applyFetcher.data.preparedImageUrl);
                setStep("done");
            } else if (applyFetcher.data.error) {
                setError(applyFetcher.data.error);
            }
        }
    }, [applyFetcher.data, applyFetcher.state]);

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

    // Handle use original result
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

    // Use original image
    const handleUseOriginal = useCallback(() => {
        const formData = new FormData();
        formData.append("productId", productId);

        originalFetcher.submit(formData, {
            method: "post",
            action: "/api/products/use-original",
        });
    }, [productId, originalFetcher]);

    // Confirm and close
    const handleConfirm = useCallback(() => {
        onSuccess?.();
        onClose();
    }, [onSuccess, onClose]);

    // Reset state on close
    const handleClose = useCallback(() => {
        setClickPoints([]);
        setMaskPreviewUrl(null);
        setFinalPreviewUrl(null);
        setError(null);
        setMode("click");
        setUploadedFile(null);
        setStep("select");
        setClickMode(1);
        onClose();
    }, [onClose]);

    return (
        <Modal
            open={open}
            onClose={handleClose}
            title={`Fix Background Removal: ${productTitle}`}
            large
        >
            <Modal.Section>
                <BlockStack gap="400">
                    {error && (
                        <Banner tone="critical" onDismiss={() => setError(null)}>
                            <p>{error}</p>
                        </Banner>
                    )}

                    {/* Mode selector */}
                    <InlineStack gap="200">
                        <Button
                            variant={mode === "click" ? "primary" : "secondary"}
                            onClick={() => { setMode("click"); handleClear(); }}
                            disabled={isLoading}
                        >
                            Select Product
                        </Button>
                        <Button
                            variant={mode === "upload" ? "primary" : "secondary"}
                            onClick={() => setMode("upload")}
                            disabled={isLoading}
                        >
                            Upload Image
                        </Button>
                        <Button
                            variant={mode === "original" ? "primary" : "secondary"}
                            onClick={() => setMode("original")}
                            disabled={isLoading}
                        >
                            Use Original
                        </Button>
                    </InlineStack>

                    {/* Click to select mode */}
                    {mode === "click" && (
                        <BlockStack gap="300">
                            {step === "select" && (
                                <>
                                    <Text variant="bodyMd">
                                        Click to add points. <strong>Green = include</strong>, <strong>Red = exclude</strong>.
                                        Then preview the selection before applying.
                                    </Text>

                                    {/* Point mode selector */}
                                    <InlineStack gap="200" align="center">
                                        <Text variant="bodySm">Click mode:</Text>
                                        <ButtonGroup segmented>
                                            <Button
                                                pressed={clickMode === 1}
                                                onClick={() => setClickMode(1)}
                                            >
                                                <span style={{ color: "#22c55e" }}>● Include</span>
                                            </Button>
                                            <Button
                                                pressed={clickMode === 0}
                                                onClick={() => setClickMode(0)}
                                            >
                                                <span style={{ color: "#ef4444" }}>● Exclude</span>
                                            </Button>
                                        </ButtonGroup>
                                        <Button onClick={handleUndo} disabled={clickPoints.length === 0}>
                                            Undo
                                        </Button>
                                        <Button onClick={handleClear} disabled={clickPoints.length === 0}>
                                            Clear All
                                        </Button>
                                    </InlineStack>
                                </>
                            )}

                            {step === "preview" && (
                                <Banner tone="info">
                                    <p>Review the highlighted area. Green = will be kept. If it looks wrong, go back and adjust your points.</p>
                                </Banner>
                            )}

                            {step === "done" && (
                                <Banner tone="success">
                                    <p>Background removed! Review the result below.</p>
                                </Banner>
                            )}

                            {/* Image display */}
                            <InlineStack gap="400" align="start" wrap={false}>
                                {/* Source image with points / mask overlay */}
                                <Box>
                                    <Text variant="bodySm" tone="subdued">
                                        {step === "select" ? "Click to add points:" :
                                         step === "preview" ? "Mask preview (green = keep):" : "Original:"}
                                    </Text>
                                    <div
                                        ref={imageRef}
                                        onClick={step === "select" ? handleImageClick : undefined}
                                        style={{
                                            position: "relative",
                                            cursor: step === "select" ? (isLoading ? "wait" : "crosshair") : "default",
                                            border: `2px solid ${step === "preview" ? "#22c55e" : "#ccc"}`,
                                            borderRadius: "8px",
                                            overflow: "hidden",
                                            maxWidth: "350px",
                                        }}
                                    >
                                        {/* Show mask overlay in preview mode, otherwise original */}
                                        <img
                                            src={step === "preview" && maskPreviewUrl ? maskPreviewUrl : sourceImageUrl}
                                            alt={productTitle}
                                            style={{
                                                display: "block",
                                                width: "100%",
                                                height: "auto",
                                            }}
                                        />

                                        {/* Click point indicators (only in select mode) */}
                                        {step === "select" && clickPoints.map((point, idx) => (
                                            <div
                                                key={idx}
                                                style={{
                                                    position: "absolute",
                                                    left: `${point.x * 100}%`,
                                                    top: `${point.y * 100}%`,
                                                    transform: "translate(-50%, -50%)",
                                                    width: "24px",
                                                    height: "24px",
                                                    borderRadius: "50%",
                                                    border: `3px solid ${point.label === 1 ? "#22c55e" : "#ef4444"}`,
                                                    background: point.label === 1
                                                        ? "rgba(34, 197, 94, 0.4)"
                                                        : "rgba(239, 68, 68, 0.4)",
                                                    pointerEvents: "none",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    color: "white",
                                                    fontSize: "14px",
                                                    fontWeight: "bold",
                                                    textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                                                }}
                                            >
                                                {point.label === 1 ? "+" : "−"}
                                            </div>
                                        ))}

                                        {/* Loading overlay */}
                                        {isLoading && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    background: "rgba(255, 255, 255, 0.8)",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    flexDirection: "column",
                                                    gap: "8px",
                                                }}
                                            >
                                                <Spinner size="large" />
                                                <Text variant="bodySm">Processing...</Text>
                                            </div>
                                        )}
                                    </div>
                                </Box>

                                {/* Final result preview (only in done step) */}
                                {step === "done" && finalPreviewUrl && (
                                    <Box>
                                        <Text variant="bodySm" tone="subdued">Final result:</Text>
                                        <div
                                            style={{
                                                border: "2px solid #22c55e",
                                                borderRadius: "8px",
                                                overflow: "hidden",
                                                maxWidth: "350px",
                                                background: "repeating-conic-gradient(#ddd 0% 25%, transparent 0% 50%) 50% / 16px 16px",
                                            }}
                                        >
                                            <img
                                                src={finalPreviewUrl}
                                                alt={`${productTitle} - transparent`}
                                                style={{
                                                    display: "block",
                                                    width: "100%",
                                                    height: "auto",
                                                }}
                                            />
                                        </div>
                                    </Box>
                                )}
                            </InlineStack>

                            {/* Action buttons based on step */}
                            <InlineStack gap="200">
                                {step === "select" && (
                                    <Button
                                        variant="primary"
                                        onClick={handlePreviewMask}
                                        loading={previewFetcher.state !== "idle"}
                                        disabled={clickPoints.length === 0}
                                    >
                                        Preview Selection
                                    </Button>
                                )}

                                {step === "preview" && (
                                    <>
                                        <Button
                                            variant="primary"
                                            onClick={handleApplyMask}
                                            loading={applyFetcher.state !== "idle"}
                                        >
                                            Apply & Remove Background
                                        </Button>
                                        <Button onClick={() => { setStep("select"); setMaskPreviewUrl(null); }}>
                                            Adjust Points
                                        </Button>
                                    </>
                                )}

                                {step === "done" && (
                                    <>
                                        <Button variant="primary" onClick={handleConfirm}>
                                            Looks Good - Save
                                        </Button>
                                        <Button onClick={handleClear}>
                                            Start Over
                                        </Button>
                                    </>
                                )}
                            </InlineStack>

                            {/* Point count indicator */}
                            {clickPoints.length > 0 && step === "select" && (
                                <Text variant="bodySm" tone="subdued">
                                    {clickPoints.filter(p => p.label === 1).length} include point(s), {" "}
                                    {clickPoints.filter(p => p.label === 0).length} exclude point(s)
                                </Text>
                            )}
                        </BlockStack>
                    )}

                    {/* Upload mode */}
                    {mode === "upload" && (
                        <BlockStack gap="300">
                            <Text variant="bodyMd">
                                Upload your own image with transparent background (PNG recommended).
                            </Text>

                            <DropZone
                                accept="image/*"
                                type="image"
                                onDrop={handleDrop}
                                disabled={isLoading}
                            >
                                {uploadedFile ? (
                                    <InlineStack gap="400" align="center" blockAlign="center">
                                        <Thumbnail
                                            source={URL.createObjectURL(uploadedFile)}
                                            alt={uploadedFile.name}
                                            size="large"
                                        />
                                        <BlockStack>
                                            <Text variant="bodyMd" fontWeight="bold">
                                                {uploadedFile.name}
                                            </Text>
                                            <Text variant="bodySm" tone="subdued">
                                                {(uploadedFile.size / 1024).toFixed(1)} KB
                                            </Text>
                                        </BlockStack>
                                    </InlineStack>
                                ) : (
                                    <DropZone.FileUpload actionHint="or drop file to upload" />
                                )}
                            </DropZone>

                            {uploadedFile && (
                                <Button
                                    variant="primary"
                                    onClick={handleUploadSubmit}
                                    loading={uploadFetcher.state !== "idle"}
                                >
                                    Upload Image
                                </Button>
                            )}
                        </BlockStack>
                    )}

                    {/* Use original mode */}
                    {mode === "original" && (
                        <BlockStack gap="300">
                            <Text variant="bodyMd">
                                Skip background removal and use the original product image as-is.
                            </Text>

                            <div
                                style={{
                                    border: "2px solid #ccc",
                                    borderRadius: "8px",
                                    overflow: "hidden",
                                    maxWidth: "300px",
                                }}
                            >
                                <img
                                    src={sourceImageUrl}
                                    alt={productTitle}
                                    style={{
                                        display: "block",
                                        width: "100%",
                                        height: "auto",
                                    }}
                                />
                            </div>

                            <Button
                                variant="primary"
                                onClick={handleUseOriginal}
                                loading={originalFetcher.state !== "idle"}
                            >
                                Use Original Image
                            </Button>
                        </BlockStack>
                    )}
                </BlockStack>
            </Modal.Section>
        </Modal>
    );
}
