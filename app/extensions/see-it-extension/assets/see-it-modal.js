document.addEventListener('DOMContentLoaded', function () {
    // --- DOM Elements ---
    const $ = id => document.getElementById(id);
    const trigger = $('see-it-trigger');
    const modal = $('see-it-modal');
    const closeBtn = document.querySelector('.see-it-close');

    if (!trigger || !modal) {
        console.log('[See It] Button not rendered - product may not have a featured image');
        return;
    }

    // Steps
    const stepWelcome = $('see-it-step-welcome');
    const stepEdit = $('see-it-step-edit-room');
    const stepPlace = $('see-it-step-place');
    const stepResult = $('see-it-step-result');

    // Welcome
    const uploadBtn = $('see-it-btn-upload');
    const cameraBtn = $('see-it-btn-camera');
    const uploadInput = $('see-it-upload');
    const cameraInput = $('see-it-camera-input');

    // Edit
    const canvasWrapper = $('see-it-canvas-wrapper');
    const roomPreview = $('see-it-room-preview');
    const maskCanvas = $('see-it-mask-canvas');
    const btnConfirmRoom = $('see-it-confirm-room');
    const btnBackToWelcome = $('see-it-back-to-welcome');
    const cleanupLoading = $('see-it-cleanup-loading');
    const uploadIndicator = $('see-it-upload-indicator');
    const btnUndo = $('see-it-undo-btn');
    const btnClear = $('see-it-clear-btn');
    const btnRemove = $('see-it-remove-btn');

    // Place
    const roomImage = $('see-it-room-image');
    const productContainer = $('see-it-product-container');
    const productImage = $('see-it-product-image');
    const scaleSlider = $('see-it-scale-slider');
    const scaleValue = $('see-it-scale-value');
    const btnGenerate = $('see-it-generate');

    // Result
    const resultDiv = $('see-it-result');
    const statusText = $('see-it-status');
    const errorDiv = $('see-it-global-error') || $('see-it-error');
    const actionsDiv = $('see-it-actions');
    const btnAdjust = $('see-it-adjust-placement');
    const btnRetry = $('see-it-retry');
    const btnStartOver = $('see-it-start-over');

    // --- State ---
    let state = {
        sessionId: null,
        originalRoomImageUrl: null,
        cleanedRoomImageUrl: null,
        localImageDataUrl: null,
        productImageUrl: trigger?.dataset.productImage || '',
        productId: trigger?.dataset.productId || '',
        scale: 1.0,
        x: 0,
        y: 0,
        isUploading: false,
        isCleaningUp: false,
        uploadComplete: false
    };

    // Canvas state - SIMPLIFIED
    let ctx = null;
    let isDrawing = false;
    let strokes = []; // Store strokes for undo, not full canvas state
    const BRUSH_SIZE = 35;
    const BRUSH_COLOR = 'rgba(138, 43, 226, 0.7)';
    
    // Click suppression: prevent accidental clicks after drawing
    let lastDrawEndTime = 0;
    const CLICK_COOLDOWN_MS = 250; // Ignore clicks for 250ms after drawing ends
    let activePointerId = null; // Track active pointer for capture

    const getActiveRoomUrl = () => state.cleanedRoomImageUrl || state.originalRoomImageUrl || state.localImageDataUrl;

    // --- Helpers ---
    const showStep = (step) => {
        [stepWelcome, stepEdit, stepPlace, stepResult].forEach(s => s?.classList.add('hidden'));
        step?.classList.remove('hidden');
        if (step === stepEdit) initCanvas();
    };

    const showError = (msg) => {
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.classList.remove('hidden');
        }
        console.error('[See It]', msg);
    };

    const resetError = () => errorDiv?.classList.add('hidden');

    const updateButtons = () => {
        const hasStrokes = strokes.length > 0;
        if (btnUndo) btnUndo.disabled = !hasStrokes;
        if (btnClear) btnClear.disabled = !hasStrokes;
        if (btnRemove) {
            const canRemove = hasStrokes && !state.isCleaningUp && state.uploadComplete;
            btnRemove.disabled = !canRemove;
            btnRemove.textContent = hasStrokes && !state.uploadComplete ? 'Uploading...' : 'Remove';
        }
    };

    const updateUploadIndicator = () => {
        uploadIndicator?.classList.toggle('hidden', !state.isUploading);
    };

    // --- Canvas Drawing (SIMPLIFIED) ---
    const initCanvas = () => {
        if (!maskCanvas || !roomPreview) return;

        // Wait for image
        if (!roomPreview.complete || !roomPreview.naturalWidth) {
            roomPreview.onload = initCanvas;
            return;
        }

        // SIMPLE: Canvas matches natural image size, CSS scales it
        const natW = roomPreview.naturalWidth;
        const natH = roomPreview.naturalHeight;

        maskCanvas.width = natW;
        maskCanvas.height = natH;

        ctx = maskCanvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = BRUSH_COLOR;
        // Scale brush relative to image size (bigger images need bigger brush)
        ctx.lineWidth = Math.max(20, Math.min(60, natW / 15));

        ctx.clearRect(0, 0, natW, natH);
        strokes = [];
        updateButtons();

        console.log('[See It] Canvas init:', natW, 'x', natH);
    };

    const getCanvasPos = (e) => {
        const rect = maskCanvas.getBoundingClientRect();
        const touch =
            (e.touches && e.touches[0]) ||
            (e.changedTouches && e.changedTouches[0]) ||
            null;
        const clientX = touch ? touch.clientX : e.clientX;
        const clientY = touch ? touch.clientY : e.clientY;
        // Scale from CSS size to canvas size
        const scaleX = maskCanvas.width / rect.width;
        const scaleY = maskCanvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    let currentStroke = [];

    const startDraw = (e) => {
        if (!ctx) return;
        e.preventDefault();
        e.stopPropagation(); // Prevent event bubbling to buttons
        isDrawing = true;
        currentStroke = [];
        const pos = getCanvasPos(e);
        currentStroke.push(pos);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + 0.1, pos.y + 0.1);
        ctx.stroke();
        
        // Log for debugging
        console.log('[See It] Drawing started', { pointerId: e.pointerId, type: e.type });
    };

    const draw = (e) => {
        if (!isDrawing || !ctx) return;
        e.preventDefault();
        e.stopPropagation(); // Prevent event bubbling
        const pos = getCanvasPos(e);
        currentStroke.push(pos);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };

    const stopDraw = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (currentStroke.length > 0) {
            strokes.push([...currentStroke]);
            currentStroke = [];
        }
        ctx?.beginPath();
        lastDrawEndTime = Date.now(); // Record when drawing ended for cooldown
        activePointerId = null;
        updateButtons();
        console.log('[See It] Drawing stopped', { strokes: strokes.length, time: lastDrawEndTime });
    };

    // Redraw all strokes
    const redrawStrokes = () => {
        if (!ctx) return;
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        strokes.forEach(stroke => {
            if (stroke.length === 0) return;
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            stroke.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();
        });
    };

    if (maskCanvas) {
        // Prefer Pointer Events when available (prevents "mouse up outside canvas" issues)
        if (window.PointerEvent) {
            maskCanvas.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                activePointerId = e.pointerId;
                try { 
                    maskCanvas.setPointerCapture(e.pointerId);
                    console.log('[See It] Pointer captured', e.pointerId);
                } catch (err) {
                    console.warn('[See It] Pointer capture failed', err);
                }
                startDraw(e);
            });
            maskCanvas.addEventListener('pointermove', draw);
            maskCanvas.addEventListener('pointerup', (e) => {
                if (e.pointerId === activePointerId) {
                    try { maskCanvas.releasePointerCapture(e.pointerId); } catch {}
                    stopDraw(e);
                }
            });
            maskCanvas.addEventListener('pointercancel', (e) => {
                if (e.pointerId === activePointerId) {
                    try { maskCanvas.releasePointerCapture(e.pointerId); } catch {}
                    stopDraw(e);
                }
            });
            // Fallback safety: if something goes wrong with capture, still stop drawing
            const globalPointerUp = (e) => {
                if (e.pointerId === activePointerId) {
                    stopDraw(e);
                }
            };
            window.addEventListener('pointerup', globalPointerUp);
        } else {
        maskCanvas.addEventListener('mousedown', startDraw);
        maskCanvas.addEventListener('mousemove', draw);
        maskCanvas.addEventListener('mouseup', stopDraw);
        maskCanvas.addEventListener('mouseleave', stopDraw);
        maskCanvas.addEventListener('touchstart', startDraw, { passive: false });
        maskCanvas.addEventListener('touchmove', draw, { passive: false });
        maskCanvas.addEventListener('touchend', stopDraw);
        maskCanvas.addEventListener('touchcancel', stopDraw);
            // Fallback: ensure strokes are committed even if finger/mouse ends outside canvas
            window.addEventListener('mouseup', stopDraw);
            window.addEventListener('touchend', stopDraw);
            window.addEventListener('touchcancel', stopDraw);
        }
        
        // Suppress clicks on canvas during/after drawing
        maskCanvas.addEventListener('click', (e) => {
            const timeSinceDrawEnd = Date.now() - lastDrawEndTime;
            if (isDrawing || timeSinceDrawEnd < CLICK_COOLDOWN_MS) {
                e.preventDefault();
                e.stopPropagation();
                console.log('[See It] Click suppressed', { isDrawing, timeSinceDrawEnd });
            }
        }, true); // Use capture phase to catch early
    }

    btnUndo?.addEventListener('click', () => {
        if (strokes.length > 0) {
            strokes.pop();
            redrawStrokes();
            updateButtons();
        }
    });

    btnClear?.addEventListener('click', () => {
        strokes = [];
        ctx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        updateButtons();
    });

    // Generate mask: white on black, at natural image resolution
    // White = areas to REMOVE (inpaint), Black = areas to KEEP
    const generateMask = () => {
        if (!maskCanvas || !ctx) {
            console.error('[See It] generateMask: canvas or context not ready');
            return null;
        }

        const w = maskCanvas.width;
        const h = maskCanvas.height;

        if (w === 0 || h === 0) {
            console.error('[See It] generateMask: canvas has zero dimensions');
            return null;
        }

        console.log(`[See It] Generating mask: ${w}x${h}, strokes: ${strokes.length}`);

        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const outCtx = out.getContext('2d');

        // Start with black background (areas to KEEP)
        outCtx.fillStyle = '#000000';
        outCtx.fillRect(0, 0, w, h);

        // Redraw strokes in solid white on the output canvas
        // This ensures clean, solid mask regions
        outCtx.strokeStyle = '#FFFFFF';
        outCtx.lineCap = 'round';
        outCtx.lineJoin = 'round';
        outCtx.lineWidth = ctx.lineWidth; // Use same brush size

        strokes.forEach(stroke => {
            if (stroke.length === 0) return;
            outCtx.beginPath();
            outCtx.moveTo(stroke[0].x, stroke[0].y);
            stroke.forEach(p => outCtx.lineTo(p.x, p.y));
            outCtx.stroke();
        });

        // Count white pixels for debugging and validation
        const imgData = outCtx.getImageData(0, 0, w, h);
        let whitePixels = 0;
        for (let i = 0; i < imgData.data.length; i += 4) {
            if (imgData.data[i] > 128) whitePixels++;
        }
        const coverage = ((whitePixels / (w * h)) * 100).toFixed(2);
        console.log(`[See It] Mask generated: ${whitePixels} white pixels, ${coverage}% coverage`);

        // Validate mask has content
        if (whitePixels === 0) {
            console.error('[See It] generateMask: mask is empty (no white pixels)');
            return null;
        }

        const dataUrl = out.toDataURL('image/png');
        console.log(`[See It] Mask data URL length: ${dataUrl.length}`);

        return dataUrl;
    };

    // --- API ---
    const startSession = async () => {
        const res = await fetch('/apps/see-it/room/start', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to start session');
        return res.json();
    };

    const uploadImage = async (file, url) => {
        const res = await fetch(url, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type },
            mode: 'cors'
        });
        if (!res.ok) throw new Error('Upload failed');
    };

    const confirmRoom = async (sessionId) => {
        const res = await fetch('/apps/see-it/room/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_session_id: sessionId })
        });
        if (!res.ok) throw new Error('Failed to confirm');
        return res.json();
    };

    const cleanupWithMask = async (maskDataUrl) => {
        const requestId = `cleanup-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        console.log('[See It] cleanupWithMask called', { requestId, sessionId: state.sessionId, maskLength: maskDataUrl?.length });
        
        const res = await fetch('/apps/see-it/room/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room_session_id: state.sessionId,
                mask_data_url: maskDataUrl
            })
        });
        
        console.log('[See It] cleanupWithMask response', { requestId, status: res.status, ok: res.ok });
        
        if (!res.ok) {
            let errorMessage = 'Cleanup failed';
            try {
                const err = await res.json();
                errorMessage = err.message || err.status || errorMessage;
                console.error('[See It] cleanupWithMask error response', { requestId, error: err });
            } catch (parseErr) {
                console.error('[See It] cleanupWithMask error parse failed', { requestId, status: res.status, parseErr });
                errorMessage = `Server error (${res.status})`;
            }
            throw new Error(errorMessage);
        }
        
        const result = await res.json();
        console.log('[See It] cleanupWithMask success', { requestId, hasResult: !!result });
        return result;
    };

    const fetchPreparedProduct = async (productId) => {
        try {
            const res = await fetch(`/apps/see-it/product/prepared?product_id=${encodeURIComponent(productId)}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.prepared_image_url || null;
        } catch { return null; }
    };

    // --- Flow ---
    trigger?.addEventListener('click', async () => {
        modal.classList.remove('hidden');
        resetError(); // Clear any previous errors
        state.productId = trigger.dataset.productId || state.productId;

        const preparedUrl = await fetchPreparedProduct(state.productId);
        state.productImageUrl = preparedUrl || trigger.dataset.productImage;
        if (productImage) productImage.src = state.productImageUrl;

        if (state.sessionId && getActiveRoomUrl()) {
            roomPreview && (roomPreview.src = getActiveRoomUrl());
            roomImage && (roomImage.src = getActiveRoomUrl());
            showStep(stepEdit);
        } else {
            state.originalRoomImageUrl = null;
            state.cleanedRoomImageUrl = null;
            state.sessionId = null;
            state.uploadComplete = false;
            showStep(stepWelcome);
        }
    });

    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

    // Upload handler
    const handleFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Reset
        state.cleanedRoomImageUrl = null;
        state.originalRoomImageUrl = null;
        state.sessionId = null;
        state.uploadComplete = false;

        // Instant preview
        const reader = new FileReader();
        reader.onload = (ev) => {
            state.localImageDataUrl = ev.target.result;
            if (roomPreview) roomPreview.src = state.localImageDataUrl;
            if (roomImage) roomImage.src = state.localImageDataUrl;
            showStep(stepEdit);
        };
        reader.readAsDataURL(file);

        // Background upload
        state.isUploading = true;
        updateUploadIndicator();
        updateButtons();

        try {
            const session = await startSession();
            state.sessionId = session.sessionId;
            await uploadImage(file, session.uploadUrl);
            const confirm = await confirmRoom(state.sessionId);
            state.originalRoomImageUrl = confirm.roomImageUrl;
            state.uploadComplete = true;
            console.log('[See It] Upload done');
        } catch (err) {
            console.error('[See It] Upload error:', err);
            showError('Upload failed: ' + err.message);
            state.sessionId = null;
        } finally {
            state.isUploading = false;
            updateUploadIndicator();
            updateButtons();
        }
    };

    uploadBtn?.addEventListener('click', () => uploadInput?.click());
    cameraBtn?.addEventListener('click', () => cameraInput?.click());
    uploadInput?.addEventListener('change', handleFile);
    cameraInput?.addEventListener('change', handleFile);

    // Edit step
    btnBackToWelcome?.addEventListener('click', () => showStep(stepWelcome));

    btnConfirmRoom?.addEventListener('click', () => {
        if (state.isCleaningUp) return;
        const url = getActiveRoomUrl();
        if (!url) return showError('Please upload an image first');

        if (state.isUploading) {
            btnConfirmRoom.textContent = 'Finishing...';
            btnConfirmRoom.disabled = true;
            const check = setInterval(() => {
                if (!state.isUploading) {
                    clearInterval(check);
                    btnConfirmRoom.textContent = 'Continue →';
                    btnConfirmRoom.disabled = false;
                    if (state.uploadComplete) proceed();
                }
            }, 100);
            return;
        }
        proceed();

        function proceed() {
            if (roomImage) roomImage.src = getActiveRoomUrl();
            showStep(stepPlace);
            state.x = 0; state.y = 0; state.scale = 1.0;
            updateTransform();
        }
    });

    // Remove (magic eraser) - with click suppression
    btnRemove?.addEventListener('click', async (e) => {
        // Suppress clicks that happen too soon after drawing ends
        const timeSinceDrawEnd = Date.now() - lastDrawEndTime;
        if (timeSinceDrawEnd < CLICK_COOLDOWN_MS) {
            console.log('[See It] Remove click suppressed (cooldown)', { timeSinceDrawEnd, cooldown: CLICK_COOLDOWN_MS });
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }
        
        // Suppress if currently drawing
        if (isDrawing) {
            console.log('[See It] Remove click suppressed (drawing active)');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }
        
        if (state.isCleaningUp || !state.sessionId || strokes.length === 0 || !state.uploadComplete) {
            console.log('[See It] Remove blocked', { isCleaningUp: state.isCleaningUp, hasSession: !!state.sessionId, hasStrokes: strokes.length > 0, uploadComplete: state.uploadComplete });
            return;
        }

        const requestId = `cleanup-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        console.log('[See It] Remove clicked', { requestId, strokes: strokes.length });

        state.isCleaningUp = true;
        cleanupLoading?.classList.remove('hidden');
        btnRemove.disabled = true;
        btnRemove.textContent = 'Removing...';
        btnUndo && (btnUndo.disabled = true);
        btnClear && (btnClear.disabled = true);
        btnConfirmRoom && (btnConfirmRoom.disabled = false); // Keep Continue enabled so user can skip if cleanup fails
        
        // Store strokes backup in case cleanup fails (so user can retry)
        const strokesBackup = JSON.parse(JSON.stringify(strokes));
        
        // Add timeout for cleanup request
        const CLEANUP_TIMEOUT_MS = 60000; // 60 seconds
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error('Cleanup timed out after 60 seconds. Please try again.'));
            }, CLEANUP_TIMEOUT_MS);
        });

        try {
            const mask = generateMask();
            if (!mask) {
                throw new Error('Failed to generate mask. Please draw over the area to remove.');
            }
            
            console.log('[See It] Calling cleanup API', { requestId, maskLength: mask.length });
            const result = await Promise.race([
                cleanupWithMask(mask),
                timeoutPromise
            ]);
            
            if (timeoutId) clearTimeout(timeoutId);
            
            console.log('[See It] Cleanup API success', { requestId, hasResult: !!result });
            state.cleanedRoomImageUrl = result.cleaned_room_image_url;

            if (roomPreview) {
                roomPreview.src = state.cleanedRoomImageUrl;
                roomPreview.onload = initCanvas;
            }
            if (roomImage) roomImage.src = state.cleanedRoomImageUrl;

            // Only clear strokes on success
            strokes = [];
            ctx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            console.log('[See It] Cleanup done', { requestId });
        } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            console.error('[See It] Cleanup error', { requestId, error: err.message, stack: err.stack });
            
            // Restore strokes on failure so user can retry
            strokes = strokesBackup;
            redrawStrokes();
            
            showError('Remove failed: ' + (err.message || 'Unknown error. Please try again.'));
        } finally {
            state.isCleaningUp = false;
            cleanupLoading?.classList.add('hidden');
            btnRemove.textContent = 'Remove';
            btnConfirmRoom && (btnConfirmRoom.disabled = false);
            updateButtons();
            console.log('[See It] Cleanup UI reset', { requestId });
        }
    });

    // Place product
    const updateTransform = () => {
        if (productContainer) {
            productContainer.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        }
        if (scaleValue) scaleValue.textContent = state.scale.toFixed(1);
        if (scaleSlider) scaleSlider.value = state.scale;
    };

    let isDragging = false, startX, startY, initX, initY;

    productContainer?.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        e.preventDefault();
        isDragging = true;
        productContainer.classList.add('is-dragging');
        startX = e.clientX; startY = e.clientY;
        initX = state.x; initY = state.y;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        state.x = initX + (e.clientX - startX);
        state.y = initY + (e.clientY - startY);
        updateTransform();
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        productContainer?.classList.remove('is-dragging');
    });

    productContainer?.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1 || e.target.classList.contains('resize-handle')) return;
        isDragging = true;
        productContainer.classList.add('is-dragging');
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        initX = state.x; initY = state.y;
    });

    window.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        state.x = initX + (e.touches[0].clientX - startX);
        state.y = initY + (e.touches[0].clientY - startY);
        updateTransform();
    }, { passive: true });

    window.addEventListener('touchend', () => {
        isDragging = false;
        productContainer?.classList.remove('is-dragging');
    });

    // Resize handles
    document.querySelectorAll('.resize-handle').forEach(handle => {
        let resizing = false, startDist = 0, startScale = 1;

        const getDist = (x, y) => {
            const rect = productContainer.getBoundingClientRect();
            return Math.hypot(x - (rect.left + rect.width/2), y - (rect.top + rect.height/2));
        };

        const onDown = (e) => {
            e.stopPropagation(); e.preventDefault();
            resizing = true;
            const cx = e.clientX || e.touches[0].clientX;
            const cy = e.clientY || e.touches[0].clientY;
            startDist = getDist(cx, cy);
            startScale = state.scale;
        };

        const onMove = (e) => {
            if (!resizing) return;
            const cx = e.clientX || e.touches?.[0]?.clientX;
            const cy = e.clientY || e.touches?.[0]?.clientY;
            if (cx == null) return;
            state.scale = Math.max(0.2, Math.min(5, startScale * (getDist(cx, cy) / startDist)));
            updateTransform();
        };

        const onUp = () => { resizing = false; };

        handle.addEventListener('mousedown', onDown);
        handle.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
    });

    scaleSlider?.addEventListener('input', (e) => {
        state.scale = parseFloat(e.target.value);
        updateTransform();
    });

    // Generate
    btnGenerate?.addEventListener('click', () => {
        if (!state.sessionId || !state.productId) return showError('Missing session or product');
        if (!roomImage || !productImage) return showError('Images not loaded');

        showStep(stepResult);
        resetError();
        statusText.textContent = 'Generating...';
        resultDiv.innerHTML = '';
        actionsDiv.classList.add('hidden');

        const roomRect = roomImage.getBoundingClientRect();
        const prodRect = productImage.getBoundingClientRect();

        const cx = prodRect.left + prodRect.width/2 - roomRect.left;
        const cy = prodRect.top + prodRect.height/2 - roomRect.top;

        const payload = {
            room_session_id: state.sessionId,
            product_id: state.productId,
            placement: {
                x: Math.max(0, Math.min(1, cx / roomRect.width)),
                y: Math.max(0, Math.min(1, cy / roomRect.height)),
                scale: state.scale || 1
            },
            config: {
                style_preset: 'neutral',
                quality: 'standard',
                product_image_url: state.productImageUrl
            }
        };

        fetch('/apps/see-it/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(data => {
            if (data.status === 'failed') {
                showError(data.error === 'room_not_found' ? 'Session expired, please re-upload' : 'Render failed');
                actionsDiv.classList.remove('hidden');
                btnRetry?.classList.remove('hidden');
                return;
            }
            if (data.job_id) pollStatus(data.job_id);
            else throw new Error('No job ID');
        })
        .catch(err => {
            showError('Error: ' + err.message);
            actionsDiv.classList.remove('hidden');
            btnRetry?.classList.remove('hidden');
        });
    });

    const pollStatus = (jobId) => {
        let attempts = 0;
        const interval = setInterval(() => {
            if (++attempts > 30) {
                clearInterval(interval);
                showError('Timeout - please try again');
                actionsDiv.classList.remove('hidden');
                btnRetry?.classList.remove('hidden');
                return;
            }

            fetch(`/apps/see-it/render/${jobId}`)
            .then(r => r.json())
            .then(data => {
                if (data.status === 'completed') {
                    clearInterval(interval);
                    statusText.textContent = 'Done!';
                    const img = document.createElement('img');
                    img.src = data.imageUrl;
                    resultDiv.appendChild(img);
                    actionsDiv.classList.remove('hidden');
                    btnRetry?.classList.add('hidden');
                } else if (data.status === 'failed') {
                    clearInterval(interval);
                    showError(data.errorMessage || 'Failed');
                    actionsDiv.classList.remove('hidden');
                    btnRetry?.classList.remove('hidden');
                }
            })
            .catch(() => {
                clearInterval(interval);
                showError('Network error');
                actionsDiv.classList.remove('hidden');
                btnRetry?.classList.remove('hidden');
            });
        }, 2000);
    };

    btnAdjust?.addEventListener('click', () => showStep(stepPlace));
    btnStartOver?.addEventListener('click', () => showStep(stepWelcome));
});
