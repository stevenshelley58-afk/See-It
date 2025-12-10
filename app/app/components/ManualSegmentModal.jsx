import { useState, useCallback, useRef } from "react";
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
 * ManualSegmentModal - Allows users to manually segment a product when auto-detection fails
 *
 * Flow:
 * 1. User clicks on the product in the image
 * 2. SAM segments based on that point
 * 3. User previews and confirms, or tries again
 * 4. Fallback options: upload custom image or use original
 */
export function ManualSegmentModal({
    open,
    onClose,
    productId,
    productTitle,
    sourceImageUrl,
    onSuccess,
}) {
    const [clickPoint, setClickPoint] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [error, setError] = useState(null);
    const [mode, setMode] = useState("click"); // "click" | "upload" | "original"
    const [uploadedFile, setUploadedFile] = useState(null);
    const imageRef = useRef(null);

    const segmentFetcher = useFetcher();
    const uploadFetcher = useFetcher();
    const originalFetcher = useFetcher();

    const isLoading =
        segmentFetcher.state !== "idle" ||
        uploadFetcher.state !== "idle" ||
        originalFetcher.state !== "idle";

    // Handle click on image
    const handleImageClick = useCallback((e) => {
        if (isLoading) return;

        const rect = imageRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        // Clamp to 0-1 range
        const clickX = Math.max(0, Math.min(1, x));
        const clickY = Math.max(0, Math.min(1, y));

        setClickPoint({ x: clickX, y: clickY });
        setError(null);
        setPreviewUrl(null);

        // Submit to segment endpoint
        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("clickX", clickX.toString());
        formData.append("clickY", clickY.toString());

        segmentFetcher.submit(formData, {
            method: "post",
            action: "/api/products/segment-point",
        });
    }, [productId, isLoading, segmentFetcher]);

    // Handle segment result
    if (segmentFetcher.data && segmentFetcher.state === "idle") {
        if (segmentFetcher.data.success && !previewUrl) {
            setPreviewUrl(segmentFetcher.data.preparedImageUrl);
        } else if (segmentFetcher.data.error && !error) {
            setError(segmentFetcher.data.error);
        }
    }

    // Handle upload result
    if (uploadFetcher.data && uploadFetcher.state === "idle") {
        if (uploadFetcher.data.success && !previewUrl) {
            setPreviewUrl(uploadFetcher.data.preparedImageUrl);
            onSuccess?.();
            onClose();
        } else if (uploadFetcher.data.error && !error) {
            setError(uploadFetcher.data.error);
        }
    }

    // Handle use original result
    if (originalFetcher.data && originalFetcher.state === "idle") {
        if (originalFetcher.data.success) {
            onSuccess?.();
            onClose();
        } else if (originalFetcher.data.error && !error) {
            setError(originalFetcher.data.error);
        }
    }

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

    // Confirm segmented result
    const handleConfirm = useCallback(() => {
        onSuccess?.();
        onClose();
    }, [onSuccess, onClose]);

    // Reset state on close
    const handleClose = useCallback(() => {
        setClickPoint(null);
        setPreviewUrl(null);
        setError(null);
        setMode("click");
        setUploadedFile(null);
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
                            onClick={() => setMode("click")}
                            disabled={isLoading}
                        >
                            Click to Select
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
                            <Text variant="bodyMd">
                                Click on the product in the image to select it. The AI will segment only the object you click on.
                            </Text>

                            <InlineStack gap="400" align="start">
                                {/* Source image (clickable) */}
                                <Box>
                                    <Text variant="bodySm" tone="subdued">Click on your product:</Text>
                                    <div
                                        ref={imageRef}
                                        onClick={handleImageClick}
                                        style={{
                                            position: "relative",
                                            cursor: isLoading ? "wait" : "crosshair",
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
                                        {/* Click point indicator */}
                                        {clickPoint && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    left: `${clickPoint.x * 100}%`,
                                                    top: `${clickPoint.y * 100}%`,
                                                    transform: "translate(-50%, -50%)",
                                                    width: "20px",
                                                    height: "20px",
                                                    borderRadius: "50%",
                                                    border: "3px solid #ff4444",
                                                    background: "rgba(255, 68, 68, 0.3)",
                                                    pointerEvents: "none",
                                                }}
                                            />
                                        )}
                                        {/* Loading overlay */}
                                        {segmentFetcher.state !== "idle" && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    background: "rgba(255, 255, 255, 0.8)",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                <Spinner size="large" />
                                            </div>
                                        )}
                                    </div>
                                </Box>

                                {/* Preview result */}
                                {previewUrl && (
                                    <Box>
                                        <Text variant="bodySm" tone="subdued">Result preview:</Text>
                                        <div
                                            style={{
                                                border: "2px solid #22c55e",
                                                borderRadius: "8px",
                                                overflow: "hidden",
                                                maxWidth: "300px",
                                                background: "repeating-conic-gradient(#ddd 0% 25%, transparent 0% 50%) 50% / 16px 16px",
                                            }}
                                        >
                                            <img
                                                src={previewUrl}
                                                alt={`${productTitle} - segmented`}
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

                            {previewUrl && (
                                <InlineStack gap="200">
                                    <Button variant="primary" onClick={handleConfirm}>
                                        Looks Good - Save
                                    </Button>
                                    <Button onClick={() => { setPreviewUrl(null); setClickPoint(null); }}>
                                        Try Again
                                    </Button>
                                </InlineStack>
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
                                Use this if your product image already has a suitable background.
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
