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
 * - Mobile-first responsive layout (Global Footer controlled via props)
 */
export function PrepareTab({ product, asset, onPrepareComplete, onRefine, setFooterConfig, onSave }) {
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

    // Mode: "normal" | "edit"
    const [mode, setMode] = useState("normal");

    // View: "original" | "result"
    const [view, setView] = useState(() => {
        const hasResult = !!(asset?.preparedImageUrlFresh || asset?.preparedImageUrl);
        return hasResult ? "result" : "original";
    });
    
    // Derived: resultExists
    const resultExists = !!preparedImageUrl;

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
    const timeoutRef = useRef(null); // Timeout ref for stuck requests

    const isLoading = isFetcherLoading || isBusy;
    const canInteract = !isLoading;

    // Sync prop changes
    useEffect(() => {
        if (asset?.preparedImageUrlFresh || asset?.preparedImageUrl) {
            const newUrl = asset.preparedImageUrlFresh || asset.preparedImageUrl;
            const hadResult = !!preparedImageUrl;
            setPreparedImageUrl(newUrl);
            // Update view if result now exists and we didn't have one before
            if (newUrl && !hadResult && mode === "normal") {
                setView("result");
            }
        }
    }, [asset, preparedImageUrl, mode]);

    // Handle Fetcher Responses
    useEffect(() => {
        // Clear any existing timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }

        if (fetcher.state === 'idle') {
            setIsBusy(false);
            
            if (fetcher.data) {
                if (fetcher.data.success) {
                    if (fetcher.data.preparedImageUrl) {
                        setPreparedImageUrl(fetcher.data.preparedImageUrl);
                        // If we just generated a result, switch to result view
                        if (mode === 'normal' && !resultExists) {
                            setView("result");
                        }
                    }
                    setError(null);
                    if (onPrepareComplete) onPrepareComplete(fetcher.data);

                    // If we just finished applying a mask, switch back to normal
                    if (mode === 'edit' && fetcher.data.preparedImageUrl) {
                        setMode("normal");
                        setView("result");
                        // Keep strokes in history but we are done
                    }
                } else {
                    setError(fetcher.data.error || 'Operation failed');
                }
            }
            // If fetcher.state is 'idle' but no data, it might be a network error
            // The error will be handled by the timeout below
        } else if (fetcher.state === 'submitting' || fetcher.state === 'loading') {
            // Set a timeout to detect stuck requests (60 seconds)
            timeoutRef.current = setTimeout(() => {
                console.error('[PrepareTab] Request timeout - clearing loading state');
                setIsBusy(false);
                setError('Request timed out. Please try again.');
            }, 60000);
        }

        // Cleanup timeout on unmount
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [fetcher.data, fetcher.state, onPrepareComplete, mode, resultExists]);


    // Initialize Canvas Image - update when view or image changes
    useEffect(() => {
        const imageUrlToLoad = (mode === "edit" && view === "result" && preparedImageUrl) 
            ? preparedImageUrl 
            : selectedImageUrl;
        
        if (!imageUrlToLoad) return;
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            imageRef.current = img;
        };
        img.src = imageUrlToLoad;
    }, [selectedImageUrl, preparedImageUrl, view, mode]);


    // -- ACTIONS --

    const handleRemoveBackground = useCallback(() => {
        setError(null);
        setIsBusy(true);

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
        setMode("edit");
        // Keep current view - if viewing result, edit the result; if viewing original, edit original
        // Don't change the view - user is already looking at what they want to edit
        setBrushMode("add");
    };

    const handleCancelEdit = () => {
        setMode("normal");
        setView(resultExists ? "result" : "original");
    };

    // Convert strokes to mask and submit
    const handleApplyEdits = async () => {
        if (!imageRef.current || !maskCanvasRef.current) return;
        setError(null);
        setIsBusy(true);

        try {
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
            strokesToContext(ctx, strokeStore.strokes.slice(0, strokeStore.cursor), canvas.width, canvas.height);

            // 2. Get Data URL
            const maskDataUrl = canvas.toDataURL("image/png");

            // 3. Determine source image - if editing result, use prepared image; otherwise use original
            const sourceImageUrl = (view === "result" && preparedImageUrl) ? preparedImageUrl : selectedImageUrl;

            // 4. Submit
            const formData = new FormData();
            formData.append("productId", product.id.split('/').pop());
            formData.append("maskDataUrl", maskDataUrl);
            formData.append("imageUrl", sourceImageUrl); // Use prepared image if editing result

            fetcher.submit(formData, {
                method: "post",
                action: "/api/products/apply-mask",
            });
        } catch (err) {
            console.error('[PrepareTab] Error in handleApplyEdits:', err);
            setError(err instanceof Error ? err.message : 'Failed to apply edits');
            setIsBusy(false);
        }
    };

    // Handle Save: If no result exists, auto-generate first, then show result. If result exists, save and exit.
    const handleSave = useCallback(() => {
        if (!resultExists) {
            // Auto-generate first
            setError(null);
            setIsBusy(true);
            
            const formData = new FormData();
            formData.append('productId', product.id.split('/').pop());
            formData.append('imageUrl', selectedImageUrl);
            
            fetcher.submit(formData, {
                method: 'post',
                action: '/api/products/remove-background'
            });
            // After fetcher completes, view will be set to "result" via useEffect
        } else {
            // Save and exit
            if (onSave) onSave();
        }
    }, [resultExists, product.id, selectedImageUrl, fetcher, onSave]);

    // -- FOOTER INTEGRATION --
    useEffect(() => {
        if (!setFooterConfig) return;

        if (mode === 'edit') {
            setFooterConfig({
                primary: {
                    label: 'Apply',
                    onClick: handleApplyEdits,
                    disabled: isLoading,
                    loading: isLoading
                },
                secondary: {
                    label: 'Cancel',
                    onClick: handleCancelEdit,
                    disabled: isLoading
                }
            });
        } else {
            // Normal Mode
            // Primary: Save (auto-generates if no result, saves and exits if result exists)
            // Secondary: Edit
            setFooterConfig({
                primary: {
                    label: 'Save',
                    onClick: handleSave,
                    disabled: isLoading,
                    loading: isLoading && !resultExists // Show loading when auto-generating
                },
                secondary: {
                    label: 'Edit',
                    onClick: handleEnterEdit,
                    disabled: isLoading || !resultExists // Disable edit if no result exists
                },
                tertiary: resultExists ? {
                    label: 'Start over',
                    onClick: handleStartOver,
                    disabled: isLoading,
                } : null
            });
        }
    }, [mode, resultExists, isLoading, setFooterConfig, handleSave, handleApplyEdits, handleCancelEdit, handleEnterEdit, handleStartOver]);


    // -- HELPER: Draw strokes to a context --
    const strokesToContext = (ctx, strokes, w, h) => {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        strokes.forEach(stroke => {
            const { mode, size, points } = stroke;
            if (points.length < 2) return;

            ctx.beginPath();
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

    const showResult = mode === "normal" && resultExists && view === "result";

    return (
        <div className="flex flex-col h-full min-h-0 font-['SF_Pro_Display',-apple-system,BlinkMacSystemFont,sans-serif]">
            {/* Hidden mask canvas for processing */}
            <canvas ref={maskCanvasRef} className="hidden" />

            {/* Content Region: Canvas + Overlays */}
            <div className="flex-1 min-h-0 relative bg-neutral-50 overflow-hidden flex items-center justify-center">

                {/* Checkerboard Background (only in result view) */}
                <div className={cx("absolute inset-0 pointer-events-none transition-opacity duration-300", showResult ? "opacity-100" : "opacity-0")}
                    style={{
                        backgroundImage: 'repeating-conic-gradient(#e5e5e5 0% 25%, #f5f5f5 0% 50%)',
                        backgroundSize: '20px 20px'
                    }}
                />

                {/* Content Container (Constrained) */}
                <div className="relative w-full h-full p-4 lg:p-6 flex items-center justify-center min-h-0">

                    {isLoading && (
                        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm transition-all duration-300">
                            <div className="bg-white p-6 rounded-3xl shadow-xl border border-neutral-100 flex flex-col items-center gap-4">
                                <Spinner size="large" />
                                <div className="text-center">
                                    <p className="font-bold text-neutral-900">{mode === 'edit' ? 'Applying Edits...' : 'Removing Background...'}</p>
                                    <p className="text-xs text-neutral-500 mt-1">This may take a few seconds</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* The Image (Card backed for contrast) */}
                    <div className={cx(
                        "relative flex items-center justify-center transition-all duration-500 w-full h-full",
                        showResult ? "p-0" : ""
                    )}>
                        {showResult && (
                            /* White card backing for result image to improve contrast */
                            <div className="absolute inset-4 bg-white rounded-xl shadow-2xl -z-10 opacity-0 animate-[fadeIn_0.5s_ease_forwards]" />
                        )}

                        <img
                            src={
                                mode === "edit" && view === "result" && preparedImageUrl
                                    ? preparedImageUrl
                                    : showResult
                                    ? preparedImageUrl
                                    : selectedImageUrl
                            }
                            alt="Product"
                            className={cx(
                                "max-h-full max-w-full w-auto h-auto object-contain transition-all duration-300 select-none",
                                (showResult || (mode === "edit" && view === "result")) ? "drop-shadow-sm" : ""
                            )}
                            draggable={false}
                            onLoad={(e) => {
                                // Update imageRef when image loads
                                imageRef.current = e.target;
                            }}
                        />

                        {/* Canvas Painter Overlay (Only in Edit Mode) */}
                        {mode === "edit" && !isLoading && (
                            <MaskPainter
                                imageUrl={view === "result" && preparedImageUrl ? preparedImageUrl : selectedImageUrl}
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
                </div>


                {/* Edit Tools Overlay (Edit Mode) - Bottom Center of Canvas */}
                {mode === "edit" && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-[90%] max-w-[400px]">
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
                                <span className="text-xs font-medium text-neutral-600 min-w-[32px] text-right">{brushSize}px</span>
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

            {/* View Toggle + Controls Bar (Normal Mode + Has Result) - Outside image area */}
            {mode === "normal" && resultExists && (
                <div className="bg-white border-t border-neutral-200 flex-shrink-0 px-4 lg:px-6 py-3 flex items-center justify-center">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-neutral-500">View:</span>
                        <div className="flex p-0.5 bg-neutral-100 rounded-lg border border-neutral-200">
                            <button
                                onClick={() => setView("original")}
                                className={cx(
                                    "px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200",
                                    view === "original" ? "bg-white text-neutral-900 shadow-sm border border-neutral-200" : "text-neutral-600 hover:text-neutral-900"
                                )}
                            >
                                Original
                            </button>
                            <button
                                onClick={() => setView("result")}
                                className={cx(
                                    "px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200",
                                    view === "result" ? "bg-white text-neutral-900 shadow-sm border border-neutral-200" : "text-neutral-600 hover:text-neutral-900"
                                )}
                            >
                                Result
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Thumbnails Row (Fixed Height) */}
            {mode === "normal" && allImages.length > 1 && (
                <div className="bg-white border-t border-neutral-100 flex-shrink-0 z-10 w-full overflow-hidden">
                    <div className="h-[68px] lg:h-[76px] flex items-center gap-3 overflow-x-auto overflow-y-hidden px-4 lg:px-6 hide-scrollbar whitespace-nowrap">
                        {allImages.map((img, idx) => (
                            <button
                                key={idx}
                                onClick={() => setSelectedImageUrl(img.url)}
                                className={cx(
                                    "relative w-12 h-12 lg:w-14 lg:h-14 rounded-lg overflow-hidden border transition-all flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-neutral-900/10",
                                    selectedImageUrl === img.url ? "border-neutral-900 ring-1 ring-neutral-900 opacity-100 shadow-md scale-105" : "border-neutral-200 opacity-60 hover:opacity-100 hover:scale-105"
                                )}
                            >
                                <img src={img.url} className="w-full h-full object-cover" alt="" />
                            </button>
                        ))}
                        {/* Spacers for end of scroll */}
                        <div className="w-2 shrink-0"></div>
                    </div>
                </div>
            )}

            {/* Error Message Toast */}
            {error && (
                <div className="absolute top-4 left-4 right-4 z-50 flex justify-center">
                    <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl border border-red-100 shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2 fade-in">
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        <span className="text-sm font-medium">{error}</span>
                    </div>
                </div>
            )}

            <style dangerouslySetInnerHTML={{
                __html: `
                .hide-scrollbar::-webkit-scrollbar { display: none; }
                .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}} />
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

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;

        // Resize canvas to match display size (responsive)
        const rect = wrap.getBoundingClientRect();
        // DPR usually 2 or 3
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

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

