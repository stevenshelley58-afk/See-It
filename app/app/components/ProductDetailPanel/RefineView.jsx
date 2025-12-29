import React, { useState, useCallback, useRef, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { Spinner, RangeSlider } from "@shopify/polaris";
import { Button } from "../ui";

/**
 * RefineView - Canvas-based mask drawing for product isolation.
 * Replaced the main modal content when in "Refine" mode.
 */
export function RefineView({ product, imageUrl, onComplete, onCancel }) {
    const fetcher = useFetcher();

    // State from ManualSegmentModal
    const [imageDimensions, setImageDimensions] = useState(null);
    const [brushSize, setBrushSize] = useState(30);
    const [isDrawing, setIsDrawing] = useState(false);
    const [error, setError] = useState(null);

    // Canvas refs
    const canvasRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const imageRef = useRef(null);

    const isLoading = fetcher.state !== "idle";

    // Load image for canvas (copied from ManualSegmentModal)
    useEffect(() => {
        if (!imageUrl) return;

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
        img.src = imageUrl;
    }, [imageUrl]);

    // Initialize mask canvas (copied from ManualSegmentModal)
    useEffect(() => {
        if (!maskCanvasRef.current || !imageDimensions) return;

        const maskCanvas = maskCanvasRef.current;
        maskCanvas.width = imageDimensions.naturalWidth;
        maskCanvas.height = imageDimensions.naturalHeight;
        const ctx = maskCanvas.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }, [imageDimensions]);

    // Render main canvas with overlay (copied from ManualSegmentModal)
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
                    // Green overlay for "Keep" area
                    maskData.data[i] = 16;
                    maskData.data[i + 1] = 185;
                    maskData.data[i + 2] = 129;
                    maskData.data[i + 3] = 150;
                } else {
                    // Semi-transparent black for "Discard" area
                    maskData.data[i + 3] = 100;
                }
            }
            tempCtx.putImageData(maskData, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0);
        }
    }, [imageDimensions]);

    useEffect(() => {
        renderCanvas();
    }, [renderCanvas]);

    // Drawing handlers (copied from ManualSegmentModal)
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

    const handleClearDrawing = useCallback(() => {
        if (!maskCanvasRef.current || !imageDimensions) return;
        const ctx = maskCanvasRef.current.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, imageDimensions.naturalWidth, imageDimensions.naturalHeight);
        renderCanvas();
    }, [imageDimensions, renderCanvas]);

    const handleApply = useCallback(() => {
        if (!maskCanvasRef.current) return;

        const maskDataUrl = maskCanvasRef.current.toDataURL("image/png");
        const formData = new FormData();
        formData.append("productId", product.id.split('/').pop());
        formData.append("maskDataUrl", maskDataUrl);
        formData.append("imageUrl", imageUrl);

        fetcher.submit(formData, {
            method: "post",
            action: "/api/products/apply-mask",
        });
    }, [product.id, imageUrl, fetcher]);

    // Handle results
    useEffect(() => {
        if (fetcher.data && fetcher.state === 'idle') {
            if (fetcher.data.success) {
                if (onComplete) onComplete(fetcher.data);
            } else {
                setError(fetcher.data.error || "Failed to apply refinement");
            }
        }
    }, [fetcher.data, fetcher.state, onComplete]);

    return (
        <div className="flex flex-col h-full fade-in">
            {/* Refine Header (Internal) */}
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-neutral-900 text-white rounded-lg">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                        </svg>
                    </div>
                    <div>
                        <h3 className="font-bold text-neutral-900">Refine Isolation</h3>
                        <p className="text-xs text-neutral-500">Paint over the areas you want to keep</p>
                    </div>
                </div>
                <button onClick={onCancel} className="p-2 hover:bg-neutral-100 rounded-lg transition-colors">
                    <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-neutral-50/50">
                {/* Info Banner */}
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
                    <div className="bg-blue-500/10 p-1.5 rounded-lg shrink-0">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                    </div>
                    <div className="text-sm text-blue-800">
                        <p className="font-bold">Smart Selection</p>
                        <p className="opacity-90">Just paint roughly over the product. Our AI will detect the precise edges automatically based on your selection.</p>
                    </div>
                </div>

                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm flex items-center gap-3">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        {error}
                    </div>
                )}

                {/* Controls */}
                <div className="flex items-center gap-8 bg-white p-4 rounded-2xl border border-neutral-100 shadow-sm">
                    <div className="flex-1 max-w-[300px]">
                        <RangeSlider
                            label={<span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Brush Size: {brushSize}px</span>}
                            value={brushSize}
                            onChange={setBrushSize}
                            min={10}
                            max={80}
                            step={5}
                        />
                    </div>
                    <Button variant="secondary" onClick={handleClearDrawing}>Clear Canvas</Button>
                </div>

                {/* Canvas Area */}
                <div className="flex justify-center">
                    <div className="relative group">
                        {imageDimensions ? (
                            <div className="rounded-2xl overflow-hidden border-4 border-white shadow-2xl relative">
                                <canvas
                                    ref={canvasRef}
                                    onMouseDown={handleDrawStart}
                                    onMouseMove={handleDrawMove}
                                    onMouseUp={handleDrawEnd}
                                    onMouseLeave={handleDrawEnd}
                                    onTouchStart={handleDrawStart}
                                    onTouchMove={handleDrawMove}
                                    onTouchEnd={handleDrawEnd}
                                    className="block cursor-crosshair touch-none transition-transform duration-200 active:scale-[1.005]"
                                    style={{
                                        width: imageDimensions.displayWidth,
                                        height: imageDimensions.displayHeight
                                    }}
                                />
                                <canvas ref={maskCanvasRef} className="hidden" />

                                {isLoading && (
                                    <div className="absolute inset-0 bg-white/40 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
                                        <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4">
                                            <Spinner size="large" />
                                            <p className="font-bold text-neutral-900">Refining Isolation...</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="w-[580px] h-[400px] bg-neutral-200 animate-pulse rounded-2xl flex items-center justify-center">
                                <Spinner />
                            </div>
                        )}

                        {/* Visual indicator for "Keep" area */}
                        <div className="absolute bottom-4 left-4 bg-emerald-500 text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-lg pointer-events-none">
                            Green = Stay
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-5 border-t border-neutral-200 bg-white flex items-center justify-between shrink-0">
                <Button variant="tertiary" onClick={onCancel}>Cancel</Button>
                <div className="flex gap-3">
                    <Button
                        variant="primary"
                        onClick={handleApply}
                        loading={isLoading}
                        className="min-w-[140px]"
                    >
                        Apply Refinement
                    </Button>
                </div>
            </div>
        </div>
    );
}
