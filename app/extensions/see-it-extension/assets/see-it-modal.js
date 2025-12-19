document.addEventListener('DOMContentLoaded', function () {
    const VERSION = '1.0.33';
    console.log('[See It] Modal loaded', VERSION);

    // --- DOM ---
    const $ = id => document.getElementById(id);
    const trigger = $('see-it-trigger');
    const modal = $('see-it-modal');
    const closeBtn = document.querySelector('.see-it-close');

    if (!trigger || !modal) return;

    const stepWelcome = $('see-it-step-welcome');
    const stepEdit = $('see-it-step-edit-room');
    const stepPlace = $('see-it-step-place');
    const stepResult = $('see-it-step-result');

    const uploadBtn = $('see-it-btn-upload');
    const cameraBtn = $('see-it-btn-camera');
    const uploadInput = $('see-it-upload');
    const cameraInput = $('see-it-camera-input');

    const roomPreview = $('see-it-room-preview');
    const maskCanvas = $('see-it-mask-canvas');
    const btnRemove = $('see-it-remove-btn');
    const btnUndo = $('see-it-undo-btn');
    const btnClear = $('see-it-clear-btn');
    const btnBackToWelcome = $('see-it-back-to-welcome');
    const btnConfirmRoom = $('see-it-confirm-room');
    const cleanupLoading = $('see-it-cleanup-loading');
    const uploadIndicator = $('see-it-upload-indicator');

    const roomImage = $('see-it-room-image');
    const productContainer = $('see-it-product-container');
    const productImage = $('see-it-product-image');
    const scaleSlider = $('see-it-scale-slider');
    const scaleValue = $('see-it-scale-value');
    const btnGenerate = $('see-it-generate');

    const resultDiv = $('see-it-result');
    const statusText = $('see-it-status');
    const errorDiv = $('see-it-global-error') || $('see-it-error');
    const actionsDiv = $('see-it-actions');
    const btnAdjust = $('see-it-adjust-placement');
    const btnRetry = $('see-it-retry');
    const btnStartOver = $('see-it-start-over');

    // --- State ---
    const state = {
        sessionId: null,
        roomImageUrl: null,
        localImageDataUrl: null,
        productImageUrl: trigger?.dataset.productImage || '',
        productId: trigger?.dataset.productId || '',
        scale: 1.0,
        x: 0,
        y: 0,
        isUploading: false,
        uploadComplete: false
    };

    // Drawing state - completely separate
    let ctx = null;
    let strokes = [];
    let currentStroke = [];
    let isDrawing = false;

    const getActiveRoomUrl = () => state.roomImageUrl || state.localImageDataUrl;

    // --- Helpers ---
    const showStep = (step) => {
        [stepWelcome, stepEdit, stepPlace, stepResult].forEach(s => s?.classList.add('hidden'));
        step?.classList.remove('hidden');
    };

    const showError = (msg) => {
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.classList.remove('hidden');
        }
    };

    const resetError = () => errorDiv?.classList.add('hidden');

    const updateButtons = () => {
        const hasStrokes = strokes.length > 0;
        if (btnUndo) btnUndo.disabled = !hasStrokes;
        if (btnClear) btnClear.disabled = !hasStrokes;
        if (btnRemove) btnRemove.disabled = !hasStrokes;
    };

    // --- API ---
    // Direct upload - sends file to our server which uploads to GCS (bypasses CORS issues)
    const uploadImageDirect = async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        
        const res = await fetch('/apps/see-it/room/upload-direct', {
            method: 'POST',
            body: formData
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || 'Upload failed');
        }
        return res.json();
    };

    // Legacy functions kept for compatibility
    const startSession = async (contentType = 'image/jpeg') => {
        const res = await fetch('/apps/see-it/room/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content_type: contentType })
        });
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

    const fetchPreparedProduct = async (productId) => {
        try {
            const res = await fetch(`/apps/see-it/product/prepared?product_id=${encodeURIComponent(productId)}`);
            if (!res.ok) return null;
            return (await res.json()).prepared_image_url || null;
        } catch { return null; }
    };

    // --- Canvas Setup ---
    const initCanvas = () => {
        if (!maskCanvas || !roomPreview) return;

        const rect = roomPreview.getBoundingClientRect();
        maskCanvas.width = rect.width;
        maskCanvas.height = rect.height;

        ctx = maskCanvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 30;
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';

        strokes = [];
        currentStroke = [];
        updateButtons();
    };

    const getPos = (e) => {
        const rect = maskCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };

    const redrawStrokes = () => {
        if (!ctx) return;
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

        for (const stroke of strokes) {
            if (stroke.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            for (let i = 1; i < stroke.length; i++) {
                ctx.lineTo(stroke[i].x, stroke[i].y);
            }
            ctx.stroke();
        }
    };

    // --- Drawing Events (Mouse) ---
    const onMouseDown = (e) => {
        if (e.button !== 0) return; // Left click only
        e.preventDefault();
        isDrawing = true;
        currentStroke = [getPos(e)];
    };

    const onMouseMove = (e) => {
        if (!isDrawing || !ctx) return;
        const pos = getPos(e);
        currentStroke.push(pos);

        // Draw current stroke
        if (currentStroke.length >= 2) {
            const prev = currentStroke[currentStroke.length - 2];
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }
    };

    const onMouseUp = () => {
        if (!isDrawing) return;
        isDrawing = false;

        if (currentStroke.length > 1) {
            strokes.push([...currentStroke]);
            updateButtons();
        }
        currentStroke = [];
    };

    // --- Drawing Events (Touch) ---
    const onTouchStart = (e) => {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        isDrawing = true;
        currentStroke = [getPos(e)];
    };

    const onTouchMove = (e) => {
        if (!isDrawing || !ctx || e.touches.length !== 1) return;
        e.preventDefault();
        const pos = getPos(e);
        currentStroke.push(pos);

        if (currentStroke.length >= 2) {
            const prev = currentStroke[currentStroke.length - 2];
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }
    };

    const onTouchEnd = () => {
        if (!isDrawing) return;
        isDrawing = false;

        if (currentStroke.length > 1) {
            strokes.push([...currentStroke]);
            updateButtons();
        }
        currentStroke = [];
    };

    // Attach canvas events
    if (maskCanvas) {
        maskCanvas.addEventListener('mousedown', onMouseDown);
        maskCanvas.addEventListener('mousemove', onMouseMove);
        maskCanvas.addEventListener('mouseup', onMouseUp);
        maskCanvas.addEventListener('mouseleave', onMouseUp);

        maskCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
        maskCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
        maskCanvas.addEventListener('touchend', onTouchEnd);
        maskCanvas.addEventListener('touchcancel', onTouchEnd);
    }

    // --- Remove Button ---
    if (btnRemove) {
        btnRemove.addEventListener('click', () => doRemove());
    }

    const doRemove = async () => {
        if (strokes.length === 0) return;
        if (!state.sessionId) {
            showError('Please wait for upload to complete');
            return;
        }

        if (cleanupLoading) cleanupLoading.classList.remove('hidden');
        if (btnRemove) btnRemove.disabled = true;

        try {
            const maskDataUrl = generateMask();
            const result = await cleanupWithMask(state.sessionId, maskDataUrl);

            if (result.cleanedRoomImageUrl || result.cleaned_room_image_url) {
                const cleanedUrl = result.cleanedRoomImageUrl || result.cleaned_room_image_url;
                state.roomImageUrl = cleanedUrl;
                if (roomPreview) roomPreview.src = cleanedUrl;
                strokes = [];
                redrawStrokes();
                updateButtons();
            }
        } catch (err) {
            showError('Removal failed: ' + err.message);
        } finally {
            if (cleanupLoading) cleanupLoading.classList.add('hidden');
            updateButtons();
        }
    };

    const generateMask = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = maskCanvas.width;
        tempCanvas.height = maskCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        tempCtx.fillStyle = 'black';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        tempCtx.strokeStyle = 'white';
        tempCtx.lineCap = 'round';
        tempCtx.lineJoin = 'round';
        tempCtx.lineWidth = 30;

        for (const stroke of strokes) {
            if (stroke.length < 2) continue;
            tempCtx.beginPath();
            tempCtx.moveTo(stroke[0].x, stroke[0].y);
            for (let i = 1; i < stroke.length; i++) {
                tempCtx.lineTo(stroke[i].x, stroke[i].y);
            }
            tempCtx.stroke();
        }

        return tempCanvas.toDataURL('image/png');
    };

    const cleanupWithMask = async (sessionId, maskDataUrl) => {
        const res = await fetch('/apps/see-it/room/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room_session_id: sessionId,
                mask_data_url: maskDataUrl
            })
        });
        if (!res.ok) throw new Error('Cleanup request failed');
        return res.json();
    };

    // --- Undo/Clear ---
    if (btnUndo) {
        btnUndo.addEventListener('click', () => {
            if (strokes.length > 0) {
                strokes.pop();
                redrawStrokes();
                updateButtons();
            }
        });
    }

    if (btnClear) {
        btnClear.addEventListener('click', () => {
            strokes = [];
            redrawStrokes();
            updateButtons();
        });
    }

    // --- Flow ---
    trigger?.addEventListener('click', async () => {
        modal.classList.remove('hidden');
        resetError();
        state.productId = trigger.dataset.productId || state.productId;

        const preparedUrl = await fetchPreparedProduct(state.productId);
        state.productImageUrl = preparedUrl || trigger.dataset.productImage;
        if (productImage) productImage.src = state.productImageUrl;

        if (state.sessionId && getActiveRoomUrl()) {
            if (roomImage) roomImage.src = getActiveRoomUrl();
            showStep(stepPlace);
        } else {
            state.roomImageUrl = null;
            state.sessionId = null;
            state.uploadComplete = false;
            showStep(stepWelcome);
        }
    });

    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

    const handleFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        state.roomImageUrl = null;
        state.sessionId = null;
        state.uploadComplete = false;

        // Show image immediately in edit step
        const reader = new FileReader();
        reader.onload = (ev) => {
            state.localImageDataUrl = ev.target.result;
            if (roomPreview) roomPreview.src = state.localImageDataUrl;
            showStep(stepEdit);

            // Init canvas after image loads
            if (roomPreview) {
                roomPreview.onload = () => initCanvas();
            }
        };
        reader.readAsDataURL(file);

        // Upload in background using direct upload (bypasses GCS CORS issues)
        state.isUploading = true;
        if (uploadIndicator) uploadIndicator.classList.remove('hidden');

        try {
            const result = await uploadImageDirect(file);
            state.sessionId = result.sessionId;
            state.roomImageUrl = result.roomImageUrl;
            state.uploadComplete = true;
        } catch (err) {
            showError('Upload failed: ' + err.message);
            state.sessionId = null;
        } finally {
            state.isUploading = false;
            if (uploadIndicator) uploadIndicator.classList.add('hidden');
        }
    };

    uploadBtn?.addEventListener('click', () => uploadInput?.click());
    cameraBtn?.addEventListener('click', () => cameraInput?.click());
    uploadInput?.addEventListener('change', handleFile);
    cameraInput?.addEventListener('change', handleFile);

    // Edit room navigation
    btnBackToWelcome?.addEventListener('click', () => showStep(stepWelcome));

    btnConfirmRoom?.addEventListener('click', () => {
        if (roomImage) roomImage.src = getActiveRoomUrl();
        showStep(stepPlace);
        state.x = 0;
        state.y = 0;
        state.scale = 1.0;
        updateTransform();
    });

    // --- Place Product ---
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

    scaleSlider?.addEventListener('input', (e) => {
        state.scale = parseFloat(e.target.value);
        updateTransform();
    });

    // --- Generate ---
    btnGenerate?.addEventListener('click', () => {
        if (!state.sessionId || !state.productId) return showError('Please wait for upload to complete');
        if (!roomImage || !productImage) return showError('Images not loaded');

        // Calculate placement BEFORE switching steps (elements must be visible)
        const roomRect = roomImage.getBoundingClientRect();
        const prodRect = productImage.getBoundingClientRect();
        
        // Calculate center of product relative to room image
        let placementX = 0.5; // Default to center
        let placementY = 0.5;
        
        if (roomRect.width > 0 && roomRect.height > 0) {
            const cx = prodRect.left + prodRect.width/2 - roomRect.left;
            const cy = prodRect.top + prodRect.height/2 - roomRect.top;
            placementX = Math.max(0, Math.min(1, cx / roomRect.width));
            placementY = Math.max(0, Math.min(1, cy / roomRect.height));
        }
        
        // Ensure valid numbers (not NaN)
        if (!Number.isFinite(placementX)) placementX = 0.5;
        if (!Number.isFinite(placementY)) placementY = 0.5;

        showStep(stepResult);
        resetError();
        statusText.textContent = 'Generating...';
        resultDiv.innerHTML = '';
        actionsDiv.classList.add('hidden');

        fetch('/apps/see-it/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room_session_id: state.sessionId,
                product_id: state.productId,
                placement: {
                    x: placementX,
                    y: placementY,
                    scale: state.scale || 1
                },
                config: {
                    style_preset: 'neutral',
                    quality: 'standard',
                    product_image_url: state.productImageUrl
                }
            })
        })
        .then(r => r.json())
        .then(data => {
            // Check for any error response first
            if (data.error) {
                let errorMsg = 'Render failed';
                if (data.error === 'room_not_found') errorMsg = 'Session expired, please re-upload';
                else if (data.error === 'rate_limit_exceeded') errorMsg = 'Please wait a moment before trying again';
                else if (data.error === 'quota_exceeded') errorMsg = 'Daily limit reached';
                else if (data.message) errorMsg = data.message;
                showError(errorMsg);
                actionsDiv.classList.remove('hidden');
                btnRetry?.classList.remove('hidden');
                return;
            }
            if (data.status === 'failed') {
                showError('Render failed');
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
