import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFetcher } from '@remix-run/react';
import { Spinner } from '@shopify/polaris';
import { Button } from '../ui';

function cx(...c) {
    return c.filter(Boolean).join(" ");
}

function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}

/**
 * PrepareTab - Merged Version
 *
 * Unified "Prepare Image" experience:
 * - View & Compare (Original vs Prepared)
 * - Auto Remove Background
 * - Manual Refine (Add/Remove brush) with Undo/Redo
 * - Mobile-first responsive layout (Bottom bar on mobile, Sidebar on desktop)
 */
export function PrepareTab({ product, asset, onPrepareComplete, onRefine }) {
    const fetcher = useFetcher();

    // -- STATE --

    // Source selection
    const allImages = product.images?.edges?.map((e) => e.node) || [];
    const [selectedImageUrl, setSelectedImageUrl] = useState(
        asset?.sourceImageUrl || product.featuredImage?.url || allImages[0]?.url
    );

    // Prepared result
    const [preparedImageUrl, setPreparedImageUrl] = useState(
        asset?.preparedImageUrlFresh || asset?.preparedImageUrl
    );

    // Mode: "normal" | "editing"
    const [mode, setMode] = useState("normal");

    // View: "prepared" | "original"
    const [view, setView] = useState("prepared");

    // Edit Tools
    const [brushMode, setBrushMode] = useState("add"); // "add" | "remove"
    const [brushSize, setBrushSize] = useState(30);
    const [strokeStore, setStrokeStore] = useState({ strokes: [], cursor: 0 }); // { strokes: [], cursor: 0 }

    // Canvas Refs
    const canvasRef = useRef(null);
    const imageRef = useRef(null);
    const maskCanvasRef = useRef(null); // Hidden canvas for generating the mask blob

    // Loading / Status
    const [error, setError] = useState(null);
    const isFetcherLoading = fetcher.state !== "idle";
    const [isBusy, setIsBusy] = useState(false); // Local busy state for smooth transitions

    const status = preparedImageUrl ? "ready" : "none";
    const hasPrepared = status === "ready";
    const isLoading = isFetcherLoading || isBusy;
    const canInteract = !isLoading;

    // Sync prop changes
    useEffect(() => {
        if (asset?.preparedImageUrlFresh || asset?.preparedImageUrl) {
            setPreparedImageUrl(asset.preparedImageUrlFresh || asset.preparedImageUrl);
        }
    }, [asset]);

    // Handle Fetcher Responses
    useEffect(() => {
        if (fetcher.data && fetcher.state === 'idle') {
            if (fetcher.data.success) {
                if (fetcher.data.preparedImageUrl) {
                    setPreparedImageUrl(fetcher.data.preparedImageUrl);
                }
                setError(null);
                if (onPrepareComplete) onPrepareComplete(fetcher.data);

                // If we just finished applying a mask, switch back to normal
                if (mode === 'editing' && fetcher.data.preparedImageUrl) {
                    setMode("normal");
                    setView("prepared");
                    // Clear strokes after successful apply? Or keep them? 
                    // Clearing them makes sense as we are now working on a "new" base, 
                    // but technically the base image is the same. 
                    // For now, let's keep them in case they want to edit again immediately, 
                    // although strictly speaking the "prepared" image is updated.
                    // Actually, if we apply mask, the backend generates a NEW prepared image.
                    // The strokes were relative to the *original*.
                    // If we edit again, we probably edit the *original* again?
                    // Yes, typically we refine the mask on the original.
                }
            } else {
                setError(fetcher.data.error || 'Operation failed');
            }
            setIsBusy(false);
        }
    }, [fetcher.data, fetcher.state, onPrepareComplete, mode]);


    // Initialize Canvas Image
    useEffect(() => {
        if (!selectedImageUrl) return;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            imageRef.current = img;
            // Force redraw if needed
            if (mode === "editing") {
                // trigger redraw? The CanvasPainter handles this via refs usually
            }
        };
        img.src = selectedImageUrl;
    }, [selectedImageUrl]);


    // -- ACTIONS --

    const handleRemoveBackground = useCallback(() => {
        setError(null);
        setIsBusy(true); // Artificial delay start

        const formData = new FormData();
        formData.append('productId', product.id.split('/').pop());
        formData.append('imageUrl', selectedImageUrl);

        fetcher.submit(formData, {
            method: 'post',
            action: '/api/products/remove-background'
        });
    }, [product.id, selectedImageUrl, fetcher]);

    const handleStartOver = () => {
        // Re-run auto remove
        setStrokeStore({ strokes: [], cursor: 0 }); // Clear history
        setMode("normal");
        handleRemoveBackground();
    };

    const handleEnterEdit = () => {
        setMode("editing");
        // Always start editing on "original" so you see what you are doing
        setView("original");
        setBrushMode("add");
        // Ensure we have the latest mask or start fresh?
        // For this lightweight version, we start fresh strokes on top of "Original".
        // ideally we would load the existing mask, but we don't have it easily.
        // So "Edit" here effectively means "Refine Manually" drawing from scratch or adding to current session.
    };

    const handleCancelEdit = () => {
        setMode("normal");
        setView(hasPrepared ? "prepared" : "original");
    };

    // Convert strokes to mask and submit
    const handleApplyEdits = async () => {
        if (!imageRef.current || !maskCanvasRef.current) return;
        setIsBusy(true);

        // 1. Draw final mask to hidden canvas
        const img = imageRef.current;
        const canvas = maskCanvasRef.current;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");

        // Default: Black (Hidden)
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw strokes
        // We need to replay strokes at full resolution
        // We need a helper to draw strokes on a context
        strokesToContext(ctx, strokeStore.strokes.slice(0, strokeStore.cursor), canvas.width, canvas.height);

        // 2. Get Data URL
        const maskDataUrl = canvas.toDataURL("image/png");

        // 3. Submit
        const formData = new FormData();
        formData.append("productId", product.id.split('/').pop());
        formData.append("maskDataUrl", maskDataUrl);
        formData.append("imageUrl", selectedImageUrl); // Source image to apply mask to

        fetcher.submit(formData, {
            method: "post",
            action: "/api/products/apply-mask",
        });
    };

    // -- HELPER: Draw strokes to a context --
    const strokesToContext = (ctx, strokes, w, h) => {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        strokes.forEach(stroke => {
            const { mode, size, points } = stroke;
            if (points.length < 2) return;

            ctx.beginPath();
            // Scale points (0-1) to width/height
            ctx.moveTo(points[0].x * w, points[0].y * h);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x * w, points[i].y * h);
            }

            // Add = White (Keep), Remove = Black (Delete/Hide)
            if (mode === "add") {
                ctx.globalCompositeOperation = "source-over"; // Paint color
                ctx.strokeStyle = "white";
            } else {
                ctx.globalCompositeOperation = "source-over"; // Paint black to remove 'keep' area
                ctx.strokeStyle = "black";
            }

            // Scale brush size relative to image? 
            // Let's assume stroke.size is proportional to the view width (e.g. 1/20th) 
            // OR we just used raw pixels on screen. 
            // We should try to scale it to be consistent. 
            // For now, let's map screen pixels roughly to image pixels.
            // If screen view was ~500px, and image is 2000px, multiplier is 4.
            const scale = w / 500; // rough approximation
            ctx.lineWidth = size * scale;

            ctx.stroke();
        });
    };

    const undo = () => {
        if (!canInteract || strokeStore.cursor <= 0) return;
        setStrokeStore(prev => ({ ...prev, cursor: prev.cursor - 1 }));
    };

    const redo = () => {
        if (!canInteract || strokeStore.cursor >= strokeStore.strokes.length) return;
        setStrokeStore(prev => ({ ...prev, cursor: prev.cursor + 1 }));
    };


    // -- RENDER --

    const showPrepared = mode === "normal" && hasPrepared && view === "prepared";

    return (
        <div className="h-full flex flex-col font-['SF_Pro_Display',-apple-system,BlinkMacSystemFont,sans-serif]">
            {/* Hidden mask canvas for processing */}
            <canvas ref={maskCanvasRef} className="hidden" />

            {/* Main Content Body */}
            <div className="flex-1 flex flex-col min-h-0 lg:flex-row">

                {/* Left: Canvas Area */}
                <div className="flex-1 p-4 lg:p-6 overflow-y-auto lg:overflow-hidden flex flex-col">

                    <div className="relative flex-1 min-h-[400px] w-full bg-neutral-50 rounded-2xl border border-neutral-200 overflow-hidden shadow-inner flex items-center justify-center">

                        {/* Checkerboard Background */}
                        <div className={cx("absolute inset-0 pointer-events-none", showPrepared ? "opacity-100" : "opacity-0")}
                            style={{
                                backgroundImage: 'repeating-conic-gradient(#e5e5e5 0% 25%, #f5f5f5 0% 50%)',
                                backgroundSize: '20px 20px'
                            }}
                        />

                        {/* Content Container */}
                        <div className="relative w-full h-full max-w-full max-h-full flex items-center justify-center p-6">

                            {isLoading && (
                                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm transition-all duration-300">
                                    <div className="bg-white p-6 rounded-3xl shadow-xl border border-neutral-100 flex flex-col items-center gap-4">
                                        <Spinner size="large" />
                                        <div className="text-center">
                                            <p className="font-bold text-neutral-900">{mode === 'editing' ? 'Applying Edits...' : 'Removing Background...'}</p>
                                            <p className="text-xs text-neutral-500 mt-1">This may take a few seconds</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* The Image */}
                            <img
                                src={showPrepared ? preparedImageUrl : selectedImageUrl}
                                alt="Product"
                                className={cx(
                                    "max-h-full max-w-full object-contain transition-all duration-300",
                                    showPrepared ? "drop-shadow-xl" : ""
                                )}
                            />

                            {/* Canvas Painter Overlay (Only in Edit Mode) */}
                            {mode === "editing" && !isLoading && (
                                <MaskPainter
                                    imageUrl={selectedImageUrl}
                                    strokes={strokeStore.strokes}
                                    cursor={strokeStore.cursor}
                                    brushMode={brushMode}
                                    brushSize={brushSize}
                                    disabled={!canInteract}
                                    onCommitStroke={(stroke) => {
                                        setStrokeStore(prev => {
                                            const newStrokes = prev.strokes.slice(0, prev.cursor);
                                            newStrokes.push(stroke);
                                            return { strokes: newStrokes, cursor: newStrokes.length };
                                        });
                                    }}
                                />
                            )}
                        </div>

                        {/* View Toggle Pill (Normal Mode + Has Prepared) */}
                        {mode === "normal" && hasPrepared && (
                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
                                <div className="flex p-1 bg-white/90 backdrop-blur border border-neutral-200 rounded-full shadow-lg">
                                    <button
                                        onClick={() => setView("original")}
                                        className={cx(
                                            "px-4 py-2 rounded-full text-xs font-bold transition-all duration-200",
                                            view === "original" ? "bg-neutral-900 text-white shadow-sm" : "text-neutral-500 hover:bg-neutral-100"
                                        )}
                                    >
                                        Original
                                    </button>
                                    <button
                                        onClick={() => setView("prepared")}
                                        className={cx(
                                            "px-4 py-2 rounded-full text-xs font-bold transition-all duration-200",
                                            view === "prepared" ? "bg-emerald-500 text-white shadow-sm" : "text-neutral-500 hover:bg-neutral-100"
                                        )}
                                    >
                                        Prepared
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Editing Tools Overlay (Bottom of Canvas) */}
                        {mode === "editing" && (
                            <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-auto md:w-auto md:min-w-[400px] md:-translate-x-1/2 md:left-1/2 z-10">
                                <div className="bg-white/95 backdrop-blur-md border border-neutral-200 shadow-xl rounded-2xl p-3 flex flex-col gap-3 md:flex-row md:items-center">

                                    {/* Brush Mode */}
                                    <div className="flex bg-neutral-100 p-1 rounded-xl shrink-0">
                                        <button
                                            onClick={() => setBrushMode("add")}
                                            className={cx(
                                                "flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all",
                                                brushMode === "add" ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5" : "text-neutral-500 hover:text-neutral-700"
                                            )}
                                        >
                                            <span className="flex items-center justify-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-blue-500" /> Add
                                            </span>
                                        </button>
                                        <button
                                            onClick={() => setBrushMode("remove")}
                                            className={cx(
                                                "flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all",
                                                brushMode === "remove" ? "bg-white text-red-600 shadow-sm ring-1 ring-black/5" : "text-neutral-500 hover:text-neutral-700"
                                            )}
                                        >
                                            <span className="flex items-center justify-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-red-500" /> Remove
                                            </span>
                                        </button>
                                    </div>

                                    {/* Divider */}
                                    <div className="hidden md:block w-px h-8 bg-neutral-200"></div>

                                    {/* Size Slider */}
                                    <div className="flex items-center gap-3 px-2 flex-1">
                                        <div className="w-2 h-2 bg-neutral-300 rounded-full shrink-0" />
                                        <input
                                            type="range"
                                            min="10"
                                            max="80"
                                            value={brushSize}
                                            onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                            className="flex-1 h-1.5 bg-neutral-100 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-900"
                                        />
                                        <div className="w-4 h-4 bg-neutral-900 rounded-full shrink-0 border border-neutral-200 shadow-sm" style={{ transform: `scale(${brushSize / 40})` }} />
                                    </div>

                                    {/* Divider */}
                                    <div className="hidden md:block w-px h-8 bg-neutral-200"></div>

                                    {/* Undo / Redo */}
                                    <div className="flex items-center gap-1 justify-end">
                                        <button
                                            onClick={undo}
                                            disabled={strokeStore.cursor === 0}
                                            className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                        </button>
                                        <button
                                            onClick={redo}
                                            disabled={strokeStore.cursor === strokeStore.strokes.length}
                                            className="p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg>
                                        </button>
                                    </div>

                                </div>
                            </div>
                        )}
                    </div>

                    {/* Use Source Image strip */}
                    {mode === "normal" && allImages.length > 1 && (
                        <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-hide py-1">
                            {allImages.map((img, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setSelectedImageUrl(img.url)}
                                    className={cx(
                                        "relative w-12 h-12 rounded-lg overflow-hidden border transition-all flex-shrink-0",
                                        selectedImageUrl === img.url ? "border-neutral-900 ring-2 ring-neutral-900/10 opacity-100" : "border-neutral-200 opacity-60 hover:opacity-100"
                                    )}
                                >
                                    <img src={img.url} className="w-full h-full object-cover" alt="" />
                                </button>
                            ))}
                        </div>
                    )}

                </div>

                {/* Right: Sidebar Actions (Desktop) */}
                <div className="hidden lg:flex w-[320px] bg-white border-l border-neutral-100 flex-col p-6 z-20">
                    <h3 className="text-lg font-bold text-neutral-900 mb-1">
                        {mode === 'editing' ? 'Refine Selection' : 'Preparation'}
                    </h3>
                    <p className="text-sm text-neutral-500 mb-6 leading-relaxed">
                        {mode === 'editing'
                            ? "Paint over the object to fix any missing or extra areas. Use 'Add' to keep parts, 'Remove' to erase."
                            : hasPrepared
                                ? "Your image is ready. Use the toggle to compare results or 'Edit' to manually refine edges."
                                : "Remove the background to isolate your product. This enables realistic placement."
                        }
                    </p>

                    <div className="flex-1 space-y-3">
                        {/* NORMAL MODE ACTIONS */}
                        {mode === "normal" && (
                            <>
                                {!hasPrepared ? (
                                    <Button variant="primary" onClick={handleRemoveBackground} disabled={isLoading} className="w-full">
                                        {isLoading ? "Processing..." : "Remove Background"}
                                    </Button>
                                ) : (
                                    <Button variant="primary" onClick={() => { }} disabled={isLoading} className="w-full">
                                        Save & Close
                                    </Button>
                                )}

                                <Button variant="secondary" onClick={handleEnterEdit} disabled={isLoading} className="w-full">
                                    {hasPrepared ? "Edit Manually" : "Manual Selection"}
                                </Button>

                                {hasPrepared && (
                                    <div className="pt-4 mt-2 border-t border-neutral-100">
                                        <Button variant="tertiary" onClick={handleStartOver} disabled={isLoading} className="w-full text-red-600 hover:bg-red-50 hover:text-red-700">
                                            Start Over (Auto)
                                        </Button>
                                    </div>
                                )}
                            </>
                        )}

                        {/* EDIT MODE ACTIONS */}
                        {mode === "editing" && (
                            <>
                                <Button variant="primary" onClick={handleApplyEdits} disabled={isLoading} className="w-full">
                                    Done
                                </Button>
                                <Button variant="secondary" onClick={handleCancelEdit} disabled={isLoading} className="w-full">
                                    Cancel
                                </Button>

                                <div className="p-4 bg-neutral-50 rounded-xl mt-4 border border-neutral-100">
                                    <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-widest mb-2">Shortcuts</h4>
                                    <ul className="text-xs text-neutral-500 space-y-1">
                                        <li className="flex justify-between"><span>Undo</span> <span className="font-mono bg-white px-1 rounded border">Cmd+Z</span></li>
                                        <li className="flex justify-between"><span>Redo</span> <span className="font-mono bg-white px-1 rounded border">Shift+Cmd+Z</span></li>
                                    </ul>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-xl border border-red-100 flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2">
                            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            {error}
                        </div>
                    )}
                </div>

            </div>

            {/* Bottom Bar: Mobile Actions (< lg) */}
            <div className="lg:hidden p-4 bg-white border-t border-neutral-100 sticky bottom-0 z-30 shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
                <div className="flex gap-3">
                    {mode === "normal" ? (
                        <>
                            {hasPrepared ? (
                                <Button variant="primary" className="flex-1" onClick={() => { }} disabled={isLoading}>Save</Button>
                            ) : (
                                <Button variant="primary" className="flex-1" onClick={handleRemoveBackground} disabled={isLoading}>
                                    {isLoading ? "..." : "Remove BG"}
                                </Button>
                            )}
                            <Button variant="secondary" className="flex-1" onClick={handleEnterEdit} disabled={isLoading}>Edit</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="secondary" className="flex-1" onClick={handleCancelEdit} disabled={isLoading}>Cancel</Button>
                            <Button variant="primary" className="flex-1" onClick={handleApplyEdits} disabled={isLoading}>Done</Button>
                        </>
                    )}
                </div>
                {/* Safe area spacer if needed, usually handled by padding */}
            </div>

        </div>
    );
}


/**
 * Sub-component: Handle the specific Canvas Drawing logic
 * We use a transparent canvas overlaid on the image.
 */
function MaskPainter({ imageUrl, strokes, cursor, brushMode, brushSize, disabled, onCommitStroke }) {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const drawingRef = useRef(false);
    const currentRef = useRef(null);

    // Helper: Screen coords -> 0..1 coords
    const getLocal = (e) => {
        const wrap = wrapRef.current;
        if (!wrap) return null;
        const rect = wrap.getBoundingClientRect();
        // Handle touches
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;
        return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    };

    const drawLine = (ctx, p1, p2, width, color) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    };

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;

        // Resize canvas to match display size (responsive)
        const rect = wrap.getBoundingClientRect();
        // DPR usually 2 or 3
        const dpr = window.devicePixelRatio || 1;

        // Logical size
        const w = rect.width;
        const h = rect.height;

        // Physical size
        canvas.width = w * dpr;
        canvas.height = h * dpr;

        // Style size
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        // -- VISUALIZATION STRATEGY --
        // We want to show "What is being added" (Blue) and "What is being removed" (Red).
        // Since we are just drawing strokes on top of an image, we can just draw them directly.
        // We don't need to actually composite a mask here visually, 
        // passing the stroke data to the backend handles the semantic logic.
        // Here we just give visual feedback.

        // 1. Draw committed strokes
        const activeStrokes = strokes.slice(0, cursor);
        activeStrokes.forEach(s => {
            drawStrokeVisually(ctx, s, w, h);
        });

        // 2. Draw current stroke being drawn
        if (currentRef.current) {
            drawStrokeVisually(ctx, currentRef.current, w, h);
        }

    }, [strokes, cursor]);

    const drawStrokeVisually = (ctx, stroke, w, h) => {
        const { mode, size, points } = stroke;
        if (points.length === 0) return;

        ctx.strokeStyle = mode === "add" ? "rgba(59, 130, 246, 0.6)" : "rgba(239, 68, 68, 0.6)";
        // Adjust brush size from 'screen pixels' (30) to current canvas context
        // Since we already set up 1:1 logical pixels with scale, 'size' 30 means 30 logical pixels.
        ctx.lineWidth = size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        const start = points[0];
        ctx.moveTo(start.x * w, start.y * h);

        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            ctx.lineTo(p.x * w, p.y * h);
        }
        ctx.stroke();
    };

    // Redraw when strokes change
    useEffect(() => {
        redraw();
    }, [redraw]);

    // Handle Window Resize
    useEffect(() => {
        const handleResize = () => requestAnimationFrame(redraw);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [redraw]);

    // Interactions
    const onStart = (e) => {
        if (disabled) return;
        if (e.type === 'mousedown' && e.button !== 0) return; // Only left click
        e.preventDefault(); // Prevent scrolling on touch

        const p = getLocal(e);
        if (!p) return;

        drawingRef.current = true;
        currentRef.current = { mode: brushMode, size: brushSize, points: [p] };
        redraw();
    };

    const onMove = (e) => {
        if (!drawingRef.current || disabled) return;
        e.preventDefault();

        const p = getLocal(e);
        if (!p) return;

        currentRef.current.points.push(p);
        redraw();
    };

    const onEnd = (e) => {
        if (!drawingRef.current) return;
        drawingRef.current = false;

        if (currentRef.current && currentRef.current.points.length > 1) {
            onCommitStroke(currentRef.current);
        }
        currentRef.current = null;
        redraw();
    };

    return (
        <div
            ref={wrapRef}
            className="absolute inset-0 z-10 cursor-crosshair touch-none"
            onMouseDown={onStart}
            onMouseMove={onMove}
            onMouseUp={onEnd}
            onMouseLeave={onEnd}
            onTouchStart={onStart}
            onTouchMove={onMove}
            onTouchEnd={onEnd}
        >
            <canvas ref={canvasRef} className="block pointer-events-none" />
        </div>
    );
}

// Add Styles for scrollbar hiding
const style = document.createElement('style');
style.textContent = `
  .scrollbar-hide::-webkit-scrollbar { display: none; }
  .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
`;
if (typeof document !== 'undefined') document.head.appendChild(style);
