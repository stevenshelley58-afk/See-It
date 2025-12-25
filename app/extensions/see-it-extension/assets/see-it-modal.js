document.addEventListener('DOMContentLoaded', function () {
    const VERSION = '1.0.31';
    console.log('[See It] === SEE IT MODAL LOADED ===', { VERSION, timestamp: Date.now() });
    
    // Helper: check if element is visible (has non-zero dimensions)
    const isVisible = (el) => el && el.offsetWidth > 0 && el.offsetHeight > 0;

    // ============================================================================
    // ASPECT RATIO NORMALIZATION (Gemini-compatible)
    // ============================================================================
    const GEMINI_SUPPORTED_RATIOS = [
        { label: '1:1',   value: 1.0 },
        { label: '4:5',   value: 0.8 },
        { label: '5:4',   value: 1.25 },
        { label: '3:4',   value: 0.75 },
        { label: '4:3',   value: 4/3 },
        { label: '2:3',   value: 2/3 },
        { label: '3:2',   value: 1.5 },
        { label: '9:16',  value: 9/16 },
        { label: '16:9', value: 16/9 },
        { label: '21:9', value: 21/9 },
    ];

    function findClosestGeminiRatio(width, height) {
        const inputRatio = width / height;
        let closest = GEMINI_SUPPORTED_RATIOS[0];
        let minDiff = Math.abs(inputRatio - closest.value);
        
        for (const r of GEMINI_SUPPORTED_RATIOS) {
            const diff = Math.abs(inputRatio - r.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }
        return closest;
    }

    async function normalizeRoomImage(file, maxDimension = 2048) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const { naturalWidth: w, naturalHeight: h } = img;
                const closest = findClosestGeminiRatio(w, h);
                
                // Compute crop dimensions (center crop)
                let cropW, cropH;
                if (w / h > closest.value) {
                    cropH = h;
                    cropW = Math.round(h * closest.value);
                } else {
                    cropW = w;
                    cropH = Math.round(w / closest.value);
                }
                
                const offsetX = Math.round((w - cropW) / 2);
                const offsetY = Math.round((h - cropH) / 2);
                
                // Scale down if needed
                let outW = cropW, outH = cropH;
                if (Math.max(outW, outH) > maxDimension) {
                    const scale = maxDimension / Math.max(outW, outH);
                    outW = Math.round(outW * scale);
                    outH = Math.round(outH * scale);
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = outW;
                canvas.height = outH;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, offsetX, offsetY, cropW, cropH, 0, 0, outW, outH);
                
                canvas.toBlob(blob => {
                    if (!blob) return reject(new Error('Canvas toBlob failed'));
                    console.log('[See It] Room normalized:', {
                        original: `${w}×${h}`,
                        normalized: `${outW}×${outH}`,
                        ratio: closest.label,
                    });
                    resolve({
                        blob,
                        width: outW,
                        height: outH,
                        ratio: closest.label,
                        originalWidth: w,
                        originalHeight: h,
                    });
                }, 'image/jpeg', 0.92);
            };
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = URL.createObjectURL(file);
        });
    }

    // --- DOM Elements ---
    const $ = id => document.getElementById(id);
    const trigger = $('see-it-trigger');
    const triggerWidget = trigger?.closest('.see-it-widget-hook');
    const modal = $('see-it-modal');

    if (!trigger || !modal) {
        console.log('[See It] Button not rendered - product may not have a featured image');
        return;
    }

    // --- Modal placement & scroll lock ---
    let savedScrollY = 0;
    
    const ensureModalPortaled = () => {
        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.right = '0';
        modal.style.bottom = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.transform = 'none';
        modal.style.zIndex = '999999';
    };

    const lockScroll = () => {
        savedScrollY = window.scrollY;
        document.documentElement.classList.add('see-it-modal-open');
        document.body.style.top = `-${savedScrollY}px`;
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
    };
    const unlockScroll = () => {
        document.documentElement.classList.remove('see-it-modal-open');
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, savedScrollY);
    };

    // Screens
    const screenEntry = $('see-it-screen-entry');
    const screenPrepare = $('see-it-screen-prepare');
    const screenPosition = $('see-it-screen-position');
    const screenResult = $('see-it-screen-result');

    // Entry screen elements
    const btnCloseEntry = $('see-it-close-entry');
    const btnTakePhoto = $('see-it-btn-take-photo');
    const btnUpload = $('see-it-btn-upload');
    const btnSaved = $('see-it-btn-saved');
    const uploadInput = $('see-it-upload-input');
    const cameraInput = $('see-it-camera-input');

    // Prepare screen elements
    const btnBackPrepare = $('see-it-back-prepare');
    const roomPreview = $('see-it-room-preview');
    const maskCanvas = $('see-it-mask-canvas');
    const btnUndo = $('see-it-undo-btn');
    const btnRemove = $('see-it-remove-btn');
    const btnConfirmRoom = $('see-it-confirm-room');

    // Position screen elements
    const btnBackPosition = $('see-it-back-position');
    const roomImage = $('see-it-room-image');
    const btnGenerate = $('see-it-generate');
    const saveRoomToggle = $('see-it-save-room-toggle');

    // Result screen elements
    const btnCloseResult = $('see-it-close-result');
    const resultImage = $('see-it-result-image');
    const btnShare = $('see-it-share');
    const btnNewRoom = $('see-it-new-room');
    const errorDiv = $('see-it-global-error');

    // DEBUG: Log which critical elements exist
    console.log('[See It] Element check:', {
        btnRemove: !!btnRemove,
        maskCanvas: !!maskCanvas,
        roomPreview: !!roomPreview,
        errorDiv: !!errorDiv
    });

    // --- State ---
    let state = {
        sessionId: null,
        originalRoomImageUrl: null,
        cleanedRoomImageUrl: null,
        localImageDataUrl: null,
        productImageUrl: trigger?.dataset.productImage || '',
        productId: trigger?.dataset.productId || '',
        productTitle: trigger?.dataset.productTitle || '',
        productPrice: trigger?.dataset.productPrice || '',
        scale: 1.0,
        x: 0,
        y: 0,
        isUploading: false,
        isCleaningUp: false,
        uploadComplete: false,
        shopperToken: localStorage.getItem('see_it_shopper_token'),
        currentScreen: 'entry',
        normalizedWidth: 0,
        normalizedHeight: 0
    };

    // Canvas state
    let ctx = null;
    let isDrawing = false;
    let strokes = [];
    let currentStroke = [];
    let hasErased = false;
    let canvasListenersAttached = false; // PREVENT DUPLICATE LISTENERS
    const BRUSH_COLOR = 'rgba(139, 92, 246, 0.9)';

    const getActiveRoomUrl = () => state.cleanedRoomImageUrl || state.originalRoomImageUrl || state.localImageDataUrl;

    // --- Screen Navigation ---
    const showScreen = (screenName) => {
        const screens = {
            entry: screenEntry,
            prepare: screenPrepare,
            position: screenPosition,
            result: screenResult
        };

        const targetScreen = screens[screenName];
        if (!targetScreen) return;

        const currentScreenEl = screens[state.currentScreen];
        if (currentScreenEl && currentScreenEl !== targetScreen) {
            currentScreenEl.classList.add('prev');
            currentScreenEl.classList.remove('active');
            setTimeout(() => {
                currentScreenEl.classList.remove('prev');
            }, 300);
        }

        targetScreen.classList.add('active');
        state.currentScreen = screenName;

        if (screenName === 'prepare') {
            initCanvas();
            setupCanvasListenersOnce(); // Only attach once!
            updatePaintButtons();
        } else if (screenName === 'position') {
            initPosition();
        }
    };

    // FIX: Show error by removing BOTH possible hidden classes
    const showError = (msg) => {
        console.error('[See It] ERROR:', msg);
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.classList.remove('hidden');
            errorDiv.classList.remove('see-it-hidden');
            errorDiv.style.display = 'block'; // Force show
            errorDiv.style.color = '#ef4444';
            errorDiv.style.padding = '12px';
            errorDiv.style.marginBottom = '12px';
            errorDiv.style.backgroundColor = '#fef2f2';
            errorDiv.style.borderRadius = '8px';
        }
        // Also show alert for debugging
        // alert('[See It Error] ' + msg);
    };

    const resetError = () => {
        if (errorDiv) {
            errorDiv.classList.add('hidden');
            errorDiv.style.display = 'none';
        }
    };

    // --- Canvas Drawing ---
    const initCanvas = () => {
        console.log('[See It] initCanvas called', {
            normalizedWidth: state.normalizedWidth,
            normalizedHeight: state.normalizedHeight,
            maskCanvasExists: !!maskCanvas
        });

        if (!maskCanvas) {
            console.error('[See It] initCanvas: maskCanvas element not found!');
            return;
        }

        // Use stored normalized dimensions
        let natW = state.normalizedWidth;
        let natH = state.normalizedHeight;

        // Fallback to preview image dimensions
        if (!natW || !natH) {
            if (roomPreview && roomPreview.complete && roomPreview.naturalWidth > 0) {
                natW = roomPreview.naturalWidth;
                natH = roomPreview.naturalHeight;
                state.normalizedWidth = natW;
                state.normalizedHeight = natH;
                console.log('[See It] initCanvas: using preview dimensions', natW, 'x', natH);
            } else {
                console.log('[See It] initCanvas: waiting for image to load...');
                if (roomPreview) {
                    roomPreview.onload = () => {
                        console.log('[See It] roomPreview loaded, reinitializing canvas');
                        initCanvas();
                    };
                }
                return;
            }
        }

        // Set canvas internal dimensions
        maskCanvas.width = natW;
        maskCanvas.height = natH;

        // Get drawing context
        ctx = maskCanvas.getContext('2d');
        if (!ctx) {
            console.error('[See It] initCanvas: failed to get 2d context!');
            return;
        }

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = BRUSH_COLOR;
        ctx.lineWidth = Math.max(20, Math.min(50, natW / 20));
        ctx.globalCompositeOperation = 'source-over';

        // Clear canvas
        ctx.clearRect(0, 0, natW, natH);
        
        console.log('[See It] Canvas initialized:', {
            width: maskCanvas.width,
            height: maskCanvas.height,
            lineWidth: ctx.lineWidth,
            ctxExists: !!ctx
        });
    };

    const getCanvasPos = (e) => {
        if (!maskCanvas) return { x: 0, y: 0, valid: false };

        const touch = e.touches?.[0] || e.changedTouches?.[0] || null;
        const clientX = touch ? touch.clientX : e.clientX;
        const clientY = touch ? touch.clientY : e.clientY;

        const rect = maskCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            console.warn('[See It] getCanvasPos: canvas has no dimensions');
            return { x: 0, y: 0, valid: false };
        }

        const canvasW = maskCanvas.width;
        const canvasH = maskCanvas.height;
        if (!canvasW || !canvasH) {
            console.warn('[See It] getCanvasPos: canvas internal dimensions are 0');
            return { x: 0, y: 0, valid: false };
        }

        // Position relative to canvas element
        const xIn = clientX - rect.left;
        const yIn = clientY - rect.top;
        
        // Check bounds
        if (xIn < 0 || yIn < 0 || xIn > rect.width || yIn > rect.height) {
            return { x: 0, y: 0, valid: false };
        }

        // Scale from CSS size to internal canvas coordinates
        const scaleX = canvasW / rect.width;
        const scaleY = canvasH / rect.height;

        return {
            x: xIn * scaleX,
            y: yIn * scaleY,
            valid: true
        };
    };

    const startDraw = (e) => {
        console.log('[See It] startDraw', { ctxExists: !!ctx, canvasExists: !!maskCanvas });
        
        if (!ctx) {
            console.warn('[See It] startDraw: ctx not initialized, attempting init...');
            initCanvas();
            if (!ctx) {
                console.error('[See It] startDraw: ctx still null after init!');
                showError('Canvas not ready. Please try again.');
                return;
            }
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        isDrawing = true;
        currentStroke = [];
        
        const pos = getCanvasPos(e);
        console.log('[See It] startDraw pos:', pos);
        
        if (!pos.valid) {
            console.warn('[See It] startDraw: invalid position');
            isDrawing = false;
            return;
        }
        
        currentStroke.push(pos);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + 0.1, pos.y + 0.1);
        ctx.stroke();
    };

    const draw = (e) => {
        if (!isDrawing || !ctx) return;
        e.preventDefault();
        e.stopPropagation();
        
        const pos = getCanvasPos(e);
        if (!pos.valid) return;
        
        currentStroke.push(pos);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };

    const stopDraw = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        
        if (currentStroke.length > 0) {
            strokes.push([...currentStroke]);
            console.log('[See It] Stroke recorded:', {
                points: currentStroke.length,
                totalStrokes: strokes.length
            });
        }
        currentStroke = [];
        ctx?.beginPath();
        updatePaintButtons();
    };

    const redrawStrokes = () => {
        if (!ctx || !maskCanvas) return;
        
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        
        strokes.forEach(stroke => {
            if (stroke.length === 0) return;
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            stroke.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();
        });
    };

    const updatePaintButtons = () => {
        const hasStrokes = strokes.length > 0;
        const canErase = hasStrokes && !state.isCleaningUp && state.uploadComplete;
        
        console.log('[See It] updatePaintButtons:', {
            hasStrokes,
            isCleaningUp: state.isCleaningUp,
            uploadComplete: state.uploadComplete,
            canErase
        });

        if (btnUndo) {
            btnUndo.disabled = !hasStrokes;
            btnUndo.style.opacity = hasStrokes ? '1' : '0.5';
        }
        
        if (btnRemove) {
            btnRemove.disabled = !canErase;
            btnRemove.style.opacity = canErase ? '1' : '0.5';
            
            // Update button text to show status
            if (!state.uploadComplete && !state.isCleaningUp) {
                btnRemove.textContent = 'Uploading...';
            } else if (state.isCleaningUp) {
                btnRemove.textContent = 'Erasing...';
            } else if (!hasStrokes) {
                btnRemove.textContent = 'Draw First';
            } else {
                btnRemove.textContent = 'Erase';
            }
        }
        
        if (btnConfirmRoom) {
            btnConfirmRoom.textContent = hasErased ? 'Continue' : 'Skip';
        }
    };

    // FIX: Only attach listeners ONCE
    const setupCanvasListenersOnce = () => {
        if (canvasListenersAttached) {
            console.log('[See It] Canvas listeners already attached, skipping');
            return;
        }
        
        if (!maskCanvas) {
            console.error('[See It] setupCanvasListenersOnce: maskCanvas not found!');
            return;
        }
        
        console.log('[See It] Attaching canvas event listeners');
        
        maskCanvas.style.touchAction = 'none';
        maskCanvas.addEventListener('pointerdown', startDraw);
        maskCanvas.addEventListener('pointermove', draw);
        maskCanvas.addEventListener('pointerup', stopDraw);
        maskCanvas.addEventListener('pointerleave', stopDraw);
        maskCanvas.addEventListener('pointercancel', stopDraw);
        
        canvasListenersAttached = true;
    };

    // Undo button
    if (btnUndo) {
        btnUndo.addEventListener('click', () => {
            console.log('[See It] Undo clicked, strokes:', strokes.length);
            if (strokes.length > 0) {
                strokes.pop();
                redrawStrokes();
                updatePaintButtons();
            }
        });
    }

    const generateMask = () => {
        if (!maskCanvas) {
            console.error('[See It] generateMask: no canvas');
            return null;
        }

        const w = maskCanvas.width;
        const h = maskCanvas.height;

        if (w === 0 || h === 0) {
            console.error('[See It] generateMask: canvas has zero dimensions');
            return null;
        }

        if (strokes.length === 0) {
            console.error('[See It] generateMask: no strokes');
            return null;
        }

        const lineWidth = ctx?.lineWidth || Math.max(20, Math.min(50, w / 20));

        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const outCtx = out.getContext('2d');

        // Black background = keep, White strokes = remove
        outCtx.fillStyle = '#000000';
        outCtx.fillRect(0, 0, w, h);

        outCtx.strokeStyle = '#FFFFFF';
        outCtx.lineCap = 'round';
        outCtx.lineJoin = 'round';
        outCtx.lineWidth = lineWidth;

        strokes.forEach(stroke => {
            if (stroke.length === 0) return;
            outCtx.beginPath();
            outCtx.moveTo(stroke[0].x, stroke[0].y);
            stroke.forEach(p => outCtx.lineTo(p.x, p.y));
            outCtx.stroke();
        });

        const dataUrl = out.toDataURL('image/png');
        console.log('[See It] Mask generated:', {
            dimensions: `${w}x${h}`,
            strokes: strokes.length,
            dataUrlLength: dataUrl.length
        });
        return dataUrl;
    };

    // --- Product Positioning ---
    const initPosition = () => {
        const url = getActiveRoomUrl();
        if (roomImage) roomImage.src = url;
        
        state.x = 0;
        state.y = 0;
        state.scale = 1.0;
    };

    // --- API Calls ---
    const startSession = async () => {
        const res = await fetch('/apps/see-it/room/upload', { method: 'POST' });
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

    const pollJobStatus = async (jobId, maxAttempts = 60) => {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const res = await fetch(`/apps/see-it/render/${jobId}`);
            if (!res.ok) throw new Error(`Failed to poll: ${res.status}`);
            const data = await res.json();
            const status = data.status || data.job_status;
            
            if (status === 'completed') return data;
            if (status === 'failed') throw new Error(data.error_message || 'Failed');
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error('Timeout');
    };

    const cleanupWithMask = async (maskDataUrl) => {
        console.log('[See It] Cleanup request:', { sessionId: state.sessionId });
        
        const res = await fetch('/apps/see-it/room/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room_session_id: state.sessionId,
                mask_data_url: maskDataUrl
            })
        });
        
        console.log('[See It] Cleanup response:', res.status);
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || err.error || 'Cleanup failed');
        }
        
        const data = await res.json();
        
        if (data.status === 'completed') {
            return {
                cleanedRoomImageUrl: data.cleaned_room_image_url || data.cleanedRoomImageUrl
            };
        }
        
        const jobId = data.job_id || data.jobId;
        if (!jobId) throw new Error('No job_id');
        
        console.log('[See It] Polling cleanup job:', jobId);
        const result = await pollJobStatus(jobId);
        
        return {
            cleanedRoomImageUrl: result.image_url || result.imageUrl
        };
    };

    // --- Modal Open/Close ---
    trigger.addEventListener('click', async () => {
        console.log('[See It] Modal opened');
        ensureModalPortaled();
        lockScroll();
        modal.classList.remove('hidden');
        if (triggerWidget) triggerWidget.style.display = 'none';
        resetError();
        
        state.productId = trigger.dataset.productId || state.productId;
        state.productTitle = trigger.dataset.productTitle || state.productTitle;
        state.productPrice = trigger.dataset.productPrice || state.productPrice;
        state.productImageUrl = trigger.dataset.productImage || state.productImageUrl;

        if (state.sessionId && getActiveRoomUrl()) {
            showScreen('prepare');
        } else {
            state.originalRoomImageUrl = null;
            state.cleanedRoomImageUrl = null;
            state.sessionId = null;
            state.uploadComplete = false;
            showScreen('entry');
        }
    });

    const closeModal = () => {
        modal.classList.add('hidden');
        unlockScroll();
        if (triggerWidget) triggerWidget.style.display = '';
        showScreen('entry');
    };

    btnCloseEntry?.addEventListener('click', closeModal);
    btnCloseResult?.addEventListener('click', closeModal);

    // --- File Upload Handler ---
    const handleFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        console.log('[See It] File selected:', file.name, file.size);

        // Reset state
        state.cleanedRoomImageUrl = null;
        state.originalRoomImageUrl = null;
        state.sessionId = null;
        state.uploadComplete = false;
        hasErased = false;
        strokes = [];
        currentStroke = [];
        ctx = null;

        state.isUploading = true;
        updatePaintButtons();

        try {
            // Normalize image
            const normalized = await normalizeRoomImage(file);
            state.normalizedWidth = normalized.width;
            state.normalizedHeight = normalized.height;
            console.log('[See It] Normalized:', normalized.width, 'x', normalized.height);

            // Set preview
            const dataUrl = URL.createObjectURL(normalized.blob);
            state.localImageDataUrl = dataUrl;

            if (roomPreview) {
                roomPreview.src = dataUrl;
            }
            if (roomImage) {
                roomImage.src = dataUrl;
            }

            showScreen('prepare');

            // Wait for image to load
            await new Promise(resolve => {
                if (roomPreview) {
                    roomPreview.onload = resolve;
                    setTimeout(resolve, 200); // Fallback
                } else {
                    resolve();
                }
            });

            initCanvas();

            // Upload to backend
            console.log('[See It] Starting upload...');
            const session = await startSession();
            state.sessionId = session.sessionId || session.room_session_id;
            console.log('[See It] Session:', state.sessionId);
            
            const normalizedFile = new File([normalized.blob], 'room.jpg', { type: 'image/jpeg' });
            await uploadImage(normalizedFile, session.uploadUrl || session.upload_url);
            console.log('[See It] Upload complete, confirming...');
            
            const confirm = await confirmRoom(state.sessionId);
            state.originalRoomImageUrl = confirm.roomImageUrl || confirm.room_image_url;
            state.uploadComplete = true;
            
            console.log('[See It] Upload confirmed!', {
                sessionId: state.sessionId,
                uploadComplete: state.uploadComplete
            });
            
        } catch (err) {
            console.error('[See It] Upload error:', err);
            showError('Upload failed: ' + err.message);
            state.sessionId = null;
        } finally {
            state.isUploading = false;
            updatePaintButtons();
        }
    };

    btnTakePhoto?.addEventListener('click', () => cameraInput?.click());
    btnUpload?.addEventListener('click', () => uploadInput?.click());
    uploadInput?.addEventListener('change', handleFile);
    cameraInput?.addEventListener('change', handleFile);

    // --- Navigation ---
    btnBackPrepare?.addEventListener('click', () => showScreen('entry'));
    btnBackPosition?.addEventListener('click', () => showScreen('prepare'));

    btnConfirmRoom?.addEventListener('click', () => {
        if (state.isCleaningUp) return;
        const url = getActiveRoomUrl();
        if (!url) {
            showError('Please upload an image first');
            return;
        }

        if (state.isUploading) {
            showError('Please wait for upload to complete');
            return;
        }
        showScreen('position');
    });

    // --- ERASE BUTTON ---
    const handleRemove = async () => {
        console.log('[See It] ========== ERASE CLICKED ==========');
        console.log('[See It] State:', {
            isCleaningUp: state.isCleaningUp,
            sessionId: state.sessionId,
            uploadComplete: state.uploadComplete,
            strokeCount: strokes.length,
            ctxExists: !!ctx
        });
        
        // Validation
        if (state.isCleaningUp) {
            console.log('[See It] Blocked: already cleaning');
            return;
        }
        if (!state.sessionId) {
            showError('Session expired. Please re-upload your image.');
            return;
        }
        if (!state.uploadComplete) {
            showError('Please wait for upload to complete.');
            return;
        }
        if (strokes.length === 0) {
            showError('Draw over the object you want to remove first.');
            return;
        }

        resetError();
        state.isCleaningUp = true;
        updatePaintButtons();

        const strokesBackup = JSON.parse(JSON.stringify(strokes));

        try {
            const mask = generateMask();
            if (!mask) {
                throw new Error('Failed to generate mask');
            }

            console.log('[See It] Sending cleanup request...');
            const result = await cleanupWithMask(mask);
            
            console.log('[See It] Cleanup API response:', result);
            
            const newUrl = result.cleanedRoomImageUrl;
            if (!newUrl) {
                console.error('[See It] No URL in result:', result);
                throw new Error('No cleaned image URL returned');
            }
            
            console.log('[See It] Got cleaned URL:', newUrl.substring(0, 100) + '...');
            console.log('[See It] Full URL length:', newUrl.length);
            
            state.cleanedRoomImageUrl = newUrl;

            // Clear strokes and canvas FIRST before loading new image
            strokes = [];
            if (ctx && maskCanvas) {
                ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            }
            hasErased = true;
            
            // CRITICAL: Load the new image with verification
            const loadImageWithVerification = (imgEl, url, name) => {
                return new Promise((resolve, reject) => {
                    if (!imgEl) {
                        console.warn(`[See It] ${name} element not found`);
                        resolve(false);
                        return;
                    }
                    
                    const oldSrc = imgEl.src;
                    console.log(`[See It] ${name} - old src:`, oldSrc ? oldSrc.substring(0, 60) + '...' : 'none');
                    
                    // Add cache-busting parameter
                    const cacheBustedUrl = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
                    
                    imgEl.onload = () => {
                        console.log(`[See It] ✅ ${name} LOADED successfully!`);
                        console.log(`[See It] ${name} naturalWidth:`, imgEl.naturalWidth);
                        console.log(`[See It] ${name} naturalHeight:`, imgEl.naturalHeight);
                        resolve(true);
                    };
                    
                    imgEl.onerror = (e) => {
                        console.error(`[See It] ❌ ${name} FAILED to load!`, e);
                        console.error(`[See It] ${name} attempted URL:`, cacheBustedUrl.substring(0, 100));
                        reject(new Error(`${name} failed to load`));
                    };
                    
                    console.log(`[See It] ${name} - setting src to cleaned URL...`);
                    imgEl.src = cacheBustedUrl;
                });
            };
            
            // Load both images
            const loadPromises = [];
            if (roomPreview) {
                loadPromises.push(loadImageWithVerification(roomPreview, newUrl, 'roomPreview'));
            }
            if (roomImage) {
                loadPromises.push(loadImageWithVerification(roomImage, newUrl, 'roomImage'));
            }
            
            if (loadPromises.length === 0) {
                throw new Error('No image elements found to update');
            }
            
            // Wait for at least one image to load
            try {
                await Promise.race(loadPromises);
                console.log('[See It] ✅ Cleanup complete - image updated!');
            } catch (loadErr) {
                console.error('[See It] Image load error:', loadErr);
                // Don't throw - the URL might still work, just logging failed
            }
            
        } catch (err) {
            console.error('[See It] Cleanup error:', err);
            strokes = strokesBackup;
            redrawStrokes();
            showError('Erase failed: ' + err.message);
        } finally {
            state.isCleaningUp = false;
            updatePaintButtons();
        }
    };
    
    // ERASE BUTTON EVENT LISTENER
    if (btnRemove) {
        console.log('[See It] Attaching Erase button listener');
        btnRemove.addEventListener('click', (e) => {
            console.log('[See It] Erase button click event fired!');
            e.preventDefault();
            e.stopPropagation();
            handleRemove();
        });
    } else {
        console.error('[See It] CRITICAL: btnRemove element not found!');
    }

    // --- Generate ---
    const handleGenerate = async () => {
        if (!state.sessionId || !state.productId) {
            showError('Missing session or product');
            return;
        }

        showScreen('result');
        resetError();

        try {
            const payload = {
                room_session_id: state.sessionId,
                product_id: state.productId,
                placement: { x: 0.5, y: 0.5, scale: state.scale || 1 },
                config: {
                    style_preset: 'neutral',
                    quality: 'standard',
                    product_image_url: state.productImageUrl
                }
            };

            console.log('[See It] Generate request:', payload);
            
            const res = await fetch('/apps/see-it/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await res.json();
            console.log('[See It] Generate response:', data);
            
            if (data.status === 'failed') {
                throw new Error(data.error || 'Render failed');
            }
            
            if (data.status === 'completed' && data.imageUrl) {
                if (resultImage) resultImage.src = data.imageUrl;
                return;
            }
            
            if (data.job_id) {
                const result = await pollJobStatus(data.job_id);
                if (resultImage && result.imageUrl) {
                    resultImage.src = result.imageUrl;
                }
            }
        } catch (err) {
            console.error('[See It] Generate error:', err);
            showError('Generate failed: ' + err.message);
        }
    };
    
    btnGenerate?.addEventListener('click', handleGenerate);

    // --- Result Actions ---
    btnNewRoom?.addEventListener('click', () => {
        state.sessionId = null;
        state.originalRoomImageUrl = null;
        state.cleanedRoomImageUrl = null;
        state.localImageDataUrl = null;
        state.uploadComplete = false;
        hasErased = false;
        strokes = [];
        showScreen('entry');
    });

    btnShare?.addEventListener('click', async () => {
        if (!resultImage?.src) return;
        
        try {
            const response = await fetch(resultImage.src);
            const blob = await response.blob();
            const file = new File([blob], 'see-it-result.jpg', { type: 'image/jpeg' });
            
            if (navigator.share) {
                await navigator.share({ files: [file], title: 'See It Result' });
            } else {
                const a = document.createElement('a');
                a.href = resultImage.src;
                a.download = 'see-it-result.jpg';
                a.click();
            }
        } catch (err) {
            console.error('[See It] Share error:', err);
        }
    });

    console.log('[See It] Initialization complete');
});
