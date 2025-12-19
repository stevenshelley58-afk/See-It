document.addEventListener('DOMContentLoaded', function () {
    const VERSION = '2.0.0';
    console.log('[See It] === SEE IT MODAL LOADED ===', { VERSION, timestamp: Date.now() });

    // --- DOM Elements ---
    const $ = id => document.getElementById(id);
    const trigger = $('see-it-trigger');
    const modal = $('see-it-modal');

    if (!trigger || !modal) {
        console.log('[See It] Button not rendered - product may not have a featured image');
        return;
    }

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
    const btnClear = $('see-it-clear-btn');
    const btnRemove = $('see-it-remove-btn');
    const btnConfirmRoom = $('see-it-confirm-room');
    const cleanupLoading = $('see-it-cleanup-loading');
    const uploadIndicator = $('see-it-upload-indicator');

    // Position screen elements
    const btnBackPosition = $('see-it-back-position');
    const roomImage = $('see-it-room-image');
    const productContainer = $('see-it-product-container');
    const productImage = $('see-it-product-image');
    const btnGenerate = $('see-it-generate');
    const saveRoomToggle = $('see-it-save-room-toggle');
    const toggleSwitch = saveRoomToggle?.closest('.see-it-toggle-switch');

    // Toggle switch handler
    saveRoomToggle?.addEventListener('change', (e) => {
        if (toggleSwitch) {
            if (e.target.checked) {
                toggleSwitch.classList.add('checked');
            } else {
                toggleSwitch.classList.remove('checked');
            }
        }
    });

    // Result screen elements
    const btnCloseResult = $('see-it-close-result');
    const resultImage = $('see-it-result-image');
    const statusText = $('see-it-status');
    const statusTextContainer = $('see-it-status-text');
    const btnShare = $('see-it-share');
    const btnAdjust = $('see-it-adjust');
    const btnNewRoom = $('see-it-new-room');
    const errorDiv = $('see-it-global-error') || $('see-it-error');

    // Email/Saved Rooms modals
    const emailModal = $('see-it-email-modal');
    const emailInput = $('see-it-email-input');
    const btnEmailSubmit = $('see-it-email-submit');
    const btnEmailCancel = $('see-it-email-cancel');
    const savedRoomsModal = $('see-it-saved-rooms-modal');
    const savedRoomsList = $('see-it-saved-rooms-list');
    const btnSavedRoomsClose = $('see-it-saved-rooms-close');

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
        currentScreen: 'entry'
    };

    // Canvas state
    let ctx = null;
    let isDrawing = false;
    let strokes = [];
    const BRUSH_COLOR = 'rgba(139, 92, 246, 0.7)';

    const getActiveRoomUrl = () => state.cleanedRoomImageUrl || state.originalRoomImageUrl || state.localImageDataUrl;

    // --- Screen Navigation with Smooth Transitions ---
    const showScreen = (screenName) => {
        const screens = {
            entry: screenEntry,
            prepare: screenPrepare,
            position: screenPosition,
            result: screenResult
        };

        const targetScreen = screens[screenName];
        if (!targetScreen) return;

        // Get current active screen
        const currentScreenEl = screens[state.currentScreen];
        if (currentScreenEl && currentScreenEl !== targetScreen) {
            // Mark current as prev for exit animation
            currentScreenEl.classList.add('prev');
            currentScreenEl.classList.remove('active');
            
            // Wait for transition, then remove prev class
            setTimeout(() => {
                currentScreenEl.classList.remove('prev');
            }, 300);
        }

        // Show new screen
        targetScreen.classList.add('active');
        state.currentScreen = screenName;

        // Initialize screen-specific functionality
        if (screenName === 'prepare') {
            initCanvas();
        } else if (screenName === 'position') {
            initPosition();
        }
    };

    const showError = (msg) => {
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.classList.remove('hidden');
        }
        console.error('[See It]', msg);
    };

    const resetError = () => errorDiv?.classList.add('hidden');

    // --- Canvas Drawing (Prepare Screen) ---
    const initCanvas = () => {
        if (!maskCanvas || !roomPreview) return;

        if (!roomPreview.complete || !roomPreview.naturalWidth) {
            roomPreview.onload = initCanvas;
            return;
        }

        const natW = roomPreview.naturalWidth;
        const natH = roomPreview.naturalHeight;

        maskCanvas.width = natW;
        maskCanvas.height = natH;

        ctx = maskCanvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = BRUSH_COLOR;
        ctx.lineWidth = Math.max(20, Math.min(60, natW / 15));

        ctx.clearRect(0, 0, natW, natH);
        strokes = [];
        updatePaintButtons();

        console.log('[See It] Canvas init:', natW, 'x', natH);
    };

    const getCanvasPos = (e) => {
        const rect = maskCanvas.getBoundingClientRect();
        const touch = e.touches?.[0] || e.changedTouches?.[0] || null;
        const clientX = touch ? touch.clientX : e.clientX;
        const clientY = touch ? touch.clientY : e.clientY;
        const scaleX = maskCanvas.width / rect.width;
        const scaleY = maskCanvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    let currentStroke = [];
    let justFinishedDrawing = false;

    const startDraw = (e) => {
        if (!ctx) return;
        e.preventDefault();
        isDrawing = true;
        currentStroke = [];
        const pos = getCanvasPos(e);
        currentStroke.push(pos);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + 0.1, pos.y + 0.1);
        ctx.stroke();
    };

    const draw = (e) => {
        if (!isDrawing || !ctx) return;
        e.preventDefault();
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
        if (currentStroke.length > 0) {
            strokes.push([...currentStroke]);
            currentStroke = [];
            justFinishedDrawing = true;
            Promise.resolve().then(() => { justFinishedDrawing = false; });
        }
        ctx?.beginPath();
        updatePaintButtons();
    };

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

    const updatePaintButtons = () => {
        const hasStrokes = strokes.length > 0;
        if (btnUndo) btnUndo.disabled = !hasStrokes;
        if (btnClear) btnClear.disabled = !hasStrokes;
        if (btnRemove) {
            const canRemove = hasStrokes && !state.isCleaningUp && state.uploadComplete;
            btnRemove.disabled = !canRemove;
        }
    };

    // Canvas event listeners
    if (maskCanvas) {
        maskCanvas.style.touchAction = 'none';
        maskCanvas.addEventListener('pointerdown', (e) => { e.stopPropagation(); startDraw(e); });
        maskCanvas.addEventListener('pointermove', (e) => { e.stopPropagation(); draw(e); });
        maskCanvas.addEventListener('pointerup', (e) => { e.stopPropagation(); stopDraw(e); });
        maskCanvas.addEventListener('pointerleave', (e) => { e.stopPropagation(); stopDraw(e); });
        maskCanvas.addEventListener('pointercancel', (e) => { e.stopPropagation(); stopDraw(e); });
    }

    btnUndo?.addEventListener('click', () => {
        if (strokes.length > 0) {
            strokes.pop();
            redrawStrokes();
            updatePaintButtons();
        }
    });

    btnClear?.addEventListener('click', () => {
        strokes = [];
        ctx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        updatePaintButtons();
    });

    const generateMask = () => {
        if (!maskCanvas || !ctx) return null;
        const w = maskCanvas.width;
        const h = maskCanvas.height;
        if (w === 0 || h === 0) return null;

        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const outCtx = out.getContext('2d');

        outCtx.fillStyle = '#000000';
        outCtx.fillRect(0, 0, w, h);

        outCtx.strokeStyle = '#FFFFFF';
        outCtx.lineCap = 'round';
        outCtx.lineJoin = 'round';
        outCtx.lineWidth = ctx.lineWidth;

        strokes.forEach(stroke => {
            if (stroke.length === 0) return;
            outCtx.beginPath();
            outCtx.moveTo(stroke[0].x, stroke[0].y);
            stroke.forEach(p => outCtx.lineTo(p.x, p.y));
            outCtx.stroke();
        });

        return out.toDataURL('image/png');
    };

    // --- Product Positioning (Position Screen) ---
    const initPosition = () => {
        if (roomImage) roomImage.src = getActiveRoomUrl();
        if (productImage) productImage.src = state.productImageUrl;
        state.x = 0;
        state.y = 0;
        state.scale = 1.0;
        updateTransform();
    };

    const updateTransform = () => {
        if (productContainer) {
            productContainer.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        }
    };

    let isDragging = false, startX, startY, initX, initY;
    let isPinching = false, initialDistance = 0, initialScale = 1;

    // Drag handlers
    productContainer?.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        e.preventDefault();
        isDragging = true;
        productContainer.classList.add('is-dragging');
        startX = e.clientX;
        startY = e.clientY;
        initX = state.x;
        initY = state.y;
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

    // Touch handlers with pinch-to-resize
    productContainer?.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch gesture
            e.preventDefault();
            isPinching = true;
            isDragging = false;
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            initialDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
            initialScale = state.scale;
        } else if (e.touches.length === 1 && !e.target.classList.contains('resize-handle')) {
            // Single touch drag
            isDragging = true;
            productContainer.classList.add('is-dragging');
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            initX = state.x;
            initY = state.y;
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (isPinching && e.touches.length === 2) {
            e.preventDefault();
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const currentDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
            const scaleFactor = currentDistance / initialDistance;
            state.scale = Math.max(0.2, Math.min(5, initialScale * scaleFactor));
            updateTransform();
        } else if (isDragging && e.touches.length === 1) {
            state.x = initX + (e.touches[0].clientX - startX);
            state.y = initY + (e.touches[0].clientY - startY);
            updateTransform();
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        isDragging = false;
        isPinching = false;
        productContainer?.classList.remove('is-dragging');
    });

    // Resize handles (desktop)
    document.querySelectorAll('.resize-handle').forEach(handle => {
        let resizing = false, startDist = 0, startScale = 1;

        const getDist = (x, y) => {
            const rect = productContainer.getBoundingClientRect();
            return Math.hypot(x - (rect.left + rect.width/2), y - (rect.top + rect.height/2));
        };

        const onDown = (e) => {
            e.stopPropagation();
            e.preventDefault();
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

    const cleanupWithMask = async (maskDataUrl) => {
        const res = await fetch('/apps/see-it/room/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room_session_id: state.sessionId,
                mask_data_url: maskDataUrl
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || 'Cleanup failed');
        }
        return res.json();
    };

    const fetchPreparedProduct = async (productId) => {
        try {
            const res = await fetch(`/apps/see-it/product/prepared?product_id=${encodeURIComponent(productId)}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.prepared_image_url || null;
        } catch { return null; }
    };

    // --- Saved Rooms API ---
    const identifyShopper = async (email) => {
        const res = await fetch('/apps/see-it/shopper/identify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        if (!res.ok) throw new Error('Failed to identify');
        return res.json();
    };

    const getSavedRooms = async () => {
        if (!state.shopperToken) return [];
        const res = await fetch('/apps/see-it/rooms', {
            headers: { 'X-Shopper-Token': state.shopperToken }
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.rooms || [];
    };

    const saveRoom = async (roomSessionId, title) => {
        if (!state.shopperToken) throw new Error('Not identified');
        const res = await fetch('/apps/see-it/rooms/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopper-Token': state.shopperToken
            },
            body: JSON.stringify({ room_session_id: roomSessionId, title })
        });
        if (!res.ok) throw new Error('Failed to save room');
        return res.json();
    };

    // --- Modal Open/Close ---
    trigger?.addEventListener('click', async () => {
        modal.classList.remove('hidden');
        resetError();
        state.productId = trigger.dataset.productId || state.productId;
        state.productTitle = trigger.dataset.productTitle || state.productTitle;
        state.productPrice = trigger.dataset.productPrice || state.productPrice;

        const preparedUrl = await fetchPreparedProduct(state.productId);
        state.productImageUrl = preparedUrl || trigger.dataset.productImage;
        if (productImage) productImage.src = state.productImageUrl;

        if (state.sessionId && getActiveRoomUrl()) {
            roomPreview && (roomPreview.src = getActiveRoomUrl());
            roomImage && (roomImage.src = getActiveRoomUrl());
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
        showScreen('entry');
    };

    btnCloseEntry?.addEventListener('click', closeModal);
    btnCloseResult?.addEventListener('click', closeModal);

    // --- File Upload Handler ---
    const handleFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        state.cleanedRoomImageUrl = null;
        state.originalRoomImageUrl = null;
        state.sessionId = null;
        state.uploadComplete = false;

        const reader = new FileReader();
        reader.onload = (ev) => {
            state.localImageDataUrl = ev.target.result;
            if (roomPreview) roomPreview.src = state.localImageDataUrl;
            if (roomImage) roomImage.src = state.localImageDataUrl;
            showScreen('prepare');
        };
        reader.readAsDataURL(file);

        state.isUploading = true;
        if (uploadIndicator) uploadIndicator.classList.remove('hidden');
        updatePaintButtons();

        try {
            const session = await startSession();
            state.sessionId = session.sessionId || session.room_session_id;
            await uploadImage(file, session.uploadUrl || session.upload_url);
            const confirm = await confirmRoom(state.sessionId);
            state.originalRoomImageUrl = confirm.roomImageUrl || confirm.room_image_url;
            state.uploadComplete = true;
        } catch (err) {
            console.error('[See It] Upload error:', err);
            showError('Upload failed: ' + err.message);
            state.sessionId = null;
        } finally {
            state.isUploading = false;
            if (uploadIndicator) uploadIndicator.classList.add('hidden');
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
        if (!url) return showError('Please upload an image first');

        if (state.isUploading) {
            // Wait for upload
            const check = setInterval(() => {
                if (!state.isUploading && state.uploadComplete) {
                    clearInterval(check);
                    showScreen('position');
                }
            }, 100);
            return;
        }
        showScreen('position');
    });

    // --- Remove Button ---
    btnRemove?.addEventListener('click', async () => {
        if (btnRemove.disabled || justFinishedDrawing || !state.sessionId || strokes.length === 0) return;

        state.isCleaningUp = true;
        if (cleanupLoading) cleanupLoading.classList.remove('hidden');
        btnRemove.disabled = true;
        btnUndo && (btnUndo.disabled = true);
        btnClear && (btnClear.disabled = true);

        const strokesBackup = JSON.parse(JSON.stringify(strokes));

        try {
            const mask = generateMask();
            if (!mask) throw new Error('Failed to generate mask');

            const result = await cleanupWithMask(mask);
            state.cleanedRoomImageUrl = result.cleaned_room_image_url || result.cleanedRoomImageUrl;

            if (roomPreview) {
                roomPreview.src = state.cleanedRoomImageUrl;
                roomPreview.onload = initCanvas;
            }
            if (roomImage) roomImage.src = state.cleanedRoomImageUrl;

            strokes = [];
            ctx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        } catch (err) {
            console.error('[See It] Cleanup error:', err);
            strokes = strokesBackup;
            redrawStrokes();
            showError('Remove failed: ' + err.message);
        } finally {
            state.isCleaningUp = false;
            if (cleanupLoading) cleanupLoading.classList.add('hidden');
            updatePaintButtons();
        }
    });

    // --- Generate Render ---
    btnGenerate?.addEventListener('click', async () => {
        if (!state.sessionId || !state.productId) return showError('Missing session or product');
        if (!roomImage || !productImage) return showError('Images not loaded');

        // Save room if toggle is on
        if (saveRoomToggle?.checked && state.shopperToken && state.sessionId) {
            try {
                await saveRoom(state.sessionId);
            } catch (err) {
                console.error('[See It] Failed to save room:', err);
                // Continue anyway
            }
        }

        showScreen('result');
        resetError();
        if (statusText) statusText.textContent = 'Generating...';
        if (statusTextContainer) statusTextContainer.classList.remove('hidden');
        if (resultImage) resultImage.src = '';
        btnShare?.parentElement?.classList.add('hidden');

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
                if (statusTextContainer) statusTextContainer.classList.add('hidden');
                btnShare?.parentElement?.classList.remove('hidden');
                return;
            }
            if (data.job_id) pollStatus(data.job_id);
            else throw new Error('No job ID');
        })
        .catch(err => {
            showError('Error: ' + err.message);
            if (statusTextContainer) statusTextContainer.classList.add('hidden');
            btnShare?.parentElement?.classList.remove('hidden');
        });
    });

    const pollStatus = (jobId) => {
        let attempts = 0;
        const interval = setInterval(() => {
            if (++attempts > 30) {
                clearInterval(interval);
                showError('Timeout - please try again');
                if (statusTextContainer) statusTextContainer.classList.add('hidden');
                btnShare?.parentElement?.classList.remove('hidden');
                return;
            }

            fetch(`/apps/see-it/render/${jobId}`)
            .then(r => r.json())
            .then(data => {
                if (data.status === 'completed') {
                    clearInterval(interval);
                    if (statusText) statusText.textContent = 'Done!';
                    if (statusTextContainer) statusTextContainer.classList.add('hidden');
                    if (resultImage && data.imageUrl) resultImage.src = data.imageUrl;
                    btnShare?.parentElement?.classList.remove('hidden');
                } else if (data.status === 'failed') {
                    clearInterval(interval);
                    showError(data.errorMessage || 'Failed');
                    if (statusTextContainer) statusTextContainer.classList.add('hidden');
                    btnShare?.parentElement?.classList.remove('hidden');
                }
            })
            .catch(() => {
                clearInterval(interval);
                showError('Network error');
                if (statusTextContainer) statusTextContainer.classList.add('hidden');
                btnShare?.parentElement?.classList.remove('hidden');
            });
        }, 2000);
    };

    // --- Result Actions ---
    btnAdjust?.addEventListener('click', () => showScreen('position'));
    btnNewRoom?.addEventListener('click', () => {
        state.sessionId = null;
        state.originalRoomImageUrl = null;
        state.cleanedRoomImageUrl = null;
        state.localImageDataUrl = null;
        state.uploadComplete = false;
        showScreen('entry');
    });

    // --- Share Functionality ---
    btnShare?.addEventListener('click', async () => {
        if (!resultImage || !resultImage.src) return;

        if (navigator.share) {
            try {
                const response = await fetch(resultImage.src);
                const blob = await response.blob();
                const file = new File([blob], 'see-it-result.jpg', { type: 'image/jpeg' });
                await navigator.share({ files: [file], title: 'See It Result' });
            } catch (err) {
                if (err.name !== 'AbortError') {
                    // Fallback to download
                    downloadImage(resultImage.src);
                }
            }
        } else {
            downloadImage(resultImage.src);
        }
    });

    const downloadImage = (url) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'see-it-result.jpg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // --- Saved Rooms ---
    btnSaved?.addEventListener('click', async () => {
        if (state.shopperToken) {
            // Show saved rooms list
            await showSavedRoomsList();
        } else {
            // Show email capture
            emailModal?.classList.remove('hidden');
        }
    });

    const showSavedRoomsList = async () => {
        const rooms = await getSavedRooms();
        if (!savedRoomsList) return;

        savedRoomsList.innerHTML = '';
        if (rooms.length === 0) {
            savedRoomsList.innerHTML = '<p style="text-align: center; color: #737373; padding: 2rem;">No saved rooms yet</p>';
        } else {
            rooms.forEach(room => {
                const item = document.createElement('div');
                item.className = 'see-it-saved-room-item';
                item.innerHTML = `
                    <img src="${room.preview_url}" alt="${room.title || 'Room'}" />
                    <div class="see-it-saved-room-item-info">
                        <p class="see-it-saved-room-item-title">${room.title || 'Untitled Room'}</p>
                        <p class="see-it-saved-room-item-date">${new Date(room.created_at).toLocaleDateString()}</p>
                    </div>
                `;
                item.addEventListener('click', () => {
                    // Load this room (would need backend endpoint to convert saved room to session)
                    // For now, just close
                    savedRoomsModal?.classList.add('hidden');
                });
                savedRoomsList.appendChild(item);
            });
        }
        savedRoomsModal?.classList.remove('hidden');
    };

    btnSavedRoomsClose?.addEventListener('click', () => {
        savedRoomsModal?.classList.add('hidden');
    });

    // --- Email Capture ---
    btnEmailSubmit?.addEventListener('click', async () => {
        const email = emailInput?.value?.trim();
        if (!email || !email.includes('@')) {
            showError('Please enter a valid email');
            return;
        }

        try {
            const result = await identifyShopper(email);
            state.shopperToken = result.shopper_token;
            localStorage.setItem('see_it_shopper_token', state.shopperToken);
            emailModal?.classList.add('hidden');
            // Now show saved rooms
            await showSavedRoomsList();
        } catch (err) {
            showError('Failed to save email: ' + err.message);
        }
    });

    btnEmailCancel?.addEventListener('click', () => {
        emailModal?.classList.add('hidden');
    });
});
