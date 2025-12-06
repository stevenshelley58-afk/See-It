document.addEventListener('DOMContentLoaded', function () {
    // --- DOM Elements ---
    const $ = id => document.getElementById(id);
    const trigger = $('see-it-trigger');
    const modal = $('see-it-modal');
    const closeBtn = document.querySelector('.see-it-close');

    // Steps
    const stepWelcome = $('see-it-step-welcome');
    const stepEdit = $('see-it-step-edit-room');
    const stepPlace = $('see-it-step-place');
    const stepResult = $('see-it-step-result');

    // Welcome Inputs
    const uploadBtn = $('see-it-btn-upload');
    const cameraBtn = $('see-it-btn-camera');
    const uploadInput = $('see-it-upload');
    const cameraInput = $('see-it-camera-input');

    // Edit Inputs
    const canvasWrapper = $('see-it-canvas-wrapper');
    const roomPreview = $('see-it-room-preview');
    const maskCanvas = $('see-it-mask-canvas');
    const btnConfirmRoom = $('see-it-confirm-room');
    const btnBackToWelcome = $('see-it-back-to-welcome');
    const cleanupLoading = $('see-it-cleanup-loading');
    
    // Eraser Controls
    const btnUndo = $('see-it-undo-btn');
    const btnClear = $('see-it-clear-btn');
    const btnRemove = $('see-it-remove-btn');

    // Place Inputs
    const roomImage = $('see-it-room-image');
    const productContainer = $('see-it-product-container');
    const productImage = $('see-it-product-image');
    const scaleSlider = $('see-it-scale-slider');
    const scaleValue = $('see-it-scale-value');
    const btnGenerate = $('see-it-generate');

    // Result Inputs
    const resultDiv = $('see-it-result');
    const statusText = $('see-it-status');
    const errorDiv = $('see-it-error');
    const actionsDiv = $('see-it-actions');
    const btnAdjust = $('see-it-adjust-placement');
    const btnRetry = $('see-it-retry');
    const btnStartOver = $('see-it-start-over');

    // --- State ---
    let state = {
        sessionId: null,
        originalRoomImageUrl: null,
        cleanedRoomImageUrl: null,
        currentRoomImageUrl: null,
        productImageUrl: trigger ? trigger.dataset.productImage : '',  // Fallback to original
        preparedProductImageUrl: null,  // Transparent background version
        productId: trigger ? trigger.dataset.productId : '',
        scale: 1.0,
        x: 0,
        y: 0,
        isUploading: false,
        isCleaningUp: false,
        isPrepared: false  // Track if product has background removed
    };
    
    // Canvas drawing state
    let ctx = null;
    let isDrawing = false;
    let drawHistory = []; // For undo
    const BRUSH_SIZE = 30;
    const BRUSH_COLOR = 'rgba(138, 43, 226, 0.5)'; // Semi-transparent purple
    
    const getActiveRoomUrl = () => state.cleanedRoomImageUrl || state.originalRoomImageUrl;

    // --- Helpers ---
    const showStep = (step) => {
        [stepWelcome, stepEdit, stepPlace, stepResult].forEach(s => s && s.classList.add('hidden'));
        if (step) step.classList.remove('hidden');
        
        // Initialize canvas when entering edit step
        if (step === stepEdit) {
            setTimeout(initCanvas, 100);
        }
    };

    const showError = (msg) => {
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.classList.remove('hidden');
        }
        console.error(msg);
    };

    const resetError = () => {
        if (errorDiv) errorDiv.classList.add('hidden');
    };
    
    const updateEraserButtons = () => {
        const hasDrawing = drawHistory.length > 0;
        const uploadComplete = !state.isUploading && state.originalRoomImageUrl;
        if (btnUndo) btnUndo.disabled = !hasDrawing;
        if (btnClear) btnClear.disabled = !hasDrawing;
        // Remove button needs: drawing exists, not cleaning up, upload finished
        if (btnRemove) btnRemove.disabled = !hasDrawing || state.isCleaningUp || !uploadComplete;
    };

    // --- Canvas Drawing ---
    const initCanvas = () => {
        if (!maskCanvas || !roomPreview) return;
        
        // Wait for image to load
        if (!roomPreview.complete) {
            roomPreview.onload = initCanvas;
            return;
        }
        
        // Size canvas to match image display size
        const rect = roomPreview.getBoundingClientRect();
        maskCanvas.width = rect.width;
        maskCanvas.height = rect.height;
        maskCanvas.style.width = rect.width + 'px';
        maskCanvas.style.height = rect.height + 'px';
        
        ctx = maskCanvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = BRUSH_SIZE;
        ctx.strokeStyle = BRUSH_COLOR;
        
        // Clear and reset
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        drawHistory = [];
        updateEraserButtons();
    };
    
    const getEventPos = (e) => {
        const rect = maskCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };
    
    const saveState = () => {
        if (!ctx) return;
        drawHistory.push(ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
        // Limit history size
        if (drawHistory.length > 20) drawHistory.shift();
        updateEraserButtons();
    };
    
    const startDraw = (e) => {
        if (!ctx) return;
        e.preventDefault();
        isDrawing = true;
        saveState();
        const pos = getEventPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        // Draw a dot for single taps
        ctx.lineTo(pos.x + 0.1, pos.y + 0.1);
        ctx.stroke();
    };
    
    const draw = (e) => {
        if (!isDrawing || !ctx) return;
        e.preventDefault();
        const pos = getEventPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };
    
    const stopDraw = () => {
        if (!ctx) return;
        isDrawing = false;
        ctx.beginPath();
        updateEraserButtons();
    };
    
    // Canvas event listeners
    if (maskCanvas) {
        // Mouse events
        maskCanvas.addEventListener('mousedown', startDraw);
        maskCanvas.addEventListener('mousemove', draw);
        maskCanvas.addEventListener('mouseup', stopDraw);
        maskCanvas.addEventListener('mouseleave', stopDraw);
        
        // Touch events
        maskCanvas.addEventListener('touchstart', startDraw, { passive: false });
        maskCanvas.addEventListener('touchmove', draw, { passive: false });
        maskCanvas.addEventListener('touchend', stopDraw);
        maskCanvas.addEventListener('touchcancel', stopDraw);
    }
    
    // Undo button
    if (btnUndo) {
        btnUndo.addEventListener('click', () => {
            if (drawHistory.length > 0 && ctx) {
                drawHistory.pop(); // Remove current state
                if (drawHistory.length > 0) {
                    ctx.putImageData(drawHistory[drawHistory.length - 1], 0, 0);
                } else {
                    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                }
                updateEraserButtons();
            }
        });
    }
    
    // Clear button
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            if (ctx) {
                ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                drawHistory = [];
                updateEraserButtons();
            }
        });
    }
    
    // Generate mask image from canvas
    const generateMaskImage = () => {
        if (!ctx || !maskCanvas) return null;
        
        // Create a new canvas for the mask (white on black)
        const maskCtx = document.createElement('canvas').getContext('2d');
        maskCtx.canvas.width = maskCanvas.width;
        maskCtx.canvas.height = maskCanvas.height;
        
        // Fill with black
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, maskCtx.canvas.width, maskCtx.canvas.height);
        
        // Get the drawing data
        const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const maskData = maskCtx.getImageData(0, 0, maskCtx.canvas.width, maskCtx.canvas.height);
        
        // Convert: any pixel with alpha > 0 becomes white
        for (let i = 0; i < imageData.data.length; i += 4) {
            if (imageData.data[i + 3] > 0) { // If alpha > 0
                maskData.data[i] = 255;     // R
                maskData.data[i + 1] = 255; // G
                maskData.data[i + 2] = 255; // B
                maskData.data[i + 3] = 255; // A
            }
        }
        
        maskCtx.putImageData(maskData, 0, 0);
        return maskCtx.canvas.toDataURL('image/png');
    };

    // --- API Calls ---
    
    // Fetch prepared product image (with transparent background) from our API
    const fetchPreparedProductImage = async (productId) => {
        try {
            const res = await fetch(`/apps/see-it/product/prepared?product_id=${encodeURIComponent(productId)}`);
            if (!res.ok) {
                console.log('No prepared image found, using original');
                return null;
            }
            const data = await res.json();
            if (data.prepared_image_url) {
                console.log('Found prepared image:', data.prepared_image_url);
                return data.prepared_image_url;
            }
            return null;
        } catch (err) {
            console.warn('Failed to fetch prepared image:', err);
            return null;
        }
    };
    
    const startSession = async () => {
        const res = await fetch('/apps/see-it/room/start', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to start session');
        return await res.json();
    };

    const uploadImage = async (file, uploadUrl) => {
        console.log('[See It] Uploading to GCS:', uploadUrl.substring(0, 100) + '...');
        try {
            const res = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type },
                mode: 'cors'
            });
            if (!res.ok) {
                const errorText = await res.text().catch(() => res.statusText);
                console.error('[See It] GCS upload failed:', res.status, errorText);
                throw new Error(`Upload failed (${res.status}): ${errorText || 'CORS or network error'}`);
            }
            console.log('[See It] Upload successful');
        } catch (err) {
            console.error('[See It] Upload error:', err);
            // Check if it's a CORS error
            if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                throw new Error('Upload blocked - GCS CORS not configured. Contact support.');
            }
            throw err;
        }
    };

    const confirmRoom = async (sessionId) => {
        const res = await fetch('/apps/see-it/room/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_session_id: sessionId })
        });
        if (!res.ok) throw new Error('Failed to confirm room');
        return await res.json();
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
            const error = await res.json().catch(() => ({}));
            throw new Error(error.message || 'Cleanup failed');
        }
        return await res.json();
    };

    // --- Flow Handlers ---

    // 1. Initialize
    if (trigger) {
        trigger.addEventListener('click', async () => {
            modal.classList.remove('hidden');
            
            state.productId = trigger.dataset.productId || state.productId;
            const originalImageUrl = trigger.dataset.productImage || state.productImageUrl;
            
            // Fetch the prepared (background-removed) image if available
            const preparedUrl = await fetchPreparedProductImage(state.productId);
            
            if (preparedUrl) {
                // Use the prepared image (transparent background)
                state.preparedProductImageUrl = preparedUrl;
                state.productImageUrl = preparedUrl;
                state.isPrepared = true;
            } else {
                // Fall back to original Shopify image
                state.preparedProductImageUrl = null;
                state.productImageUrl = originalImageUrl;
                state.isPrepared = false;
            }
            
            if (productImage) productImage.src = state.productImageUrl;
            
            if (state.sessionId && (state.originalRoomImageUrl || state.cleanedRoomImageUrl)) {
                const roomUrl = getActiveRoomUrl();
                if (roomPreview) roomPreview.src = roomUrl;
                if (roomImage) roomImage.src = roomUrl;
                showStep(stepEdit);
            } else {
                state.currentRoomImageUrl = null;
                state.originalRoomImageUrl = null;
                state.cleanedRoomImageUrl = null;
                state.sessionId = null;
                showStep(stepWelcome);
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    }

    // 2. Upload / Capture
    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        state.cleanedRoomImageUrl = null;
        state.originalRoomImageUrl = null;
        state.sessionId = null;

        const reader = new FileReader();
        reader.onload = (e) => {
            state.currentRoomImageUrl = e.target.result;
            if (roomPreview) roomPreview.src = state.currentRoomImageUrl;
            if (roomImage) roomImage.src = state.currentRoomImageUrl;
            showStep(stepEdit);
        };
        reader.readAsDataURL(file);

        try {
            state.isUploading = true;
            if (btnConfirmRoom) {
                btnConfirmRoom.textContent = 'Uploading...';
                btnConfirmRoom.disabled = true;
            }
            if (btnRemove) btnRemove.disabled = true;

            const sessionData = await startSession();
            state.sessionId = sessionData.sessionId;
            const uploadUrl = sessionData.uploadUrl;

            await uploadImage(file, uploadUrl);

            const confirmData = await confirmRoom(state.sessionId);
            state.originalRoomImageUrl = confirmData.roomImageUrl;

            console.log('Upload complete:', state.originalRoomImageUrl);

        } catch (err) {
            showError('Upload failed: ' + err.message);
        } finally {
            state.isUploading = false;
            if (btnConfirmRoom) {
                btnConfirmRoom.textContent = 'Continue →';
                btnConfirmRoom.disabled = false;
            }
            updateEraserButtons();
        }
    };

    if (uploadBtn) uploadBtn.addEventListener('click', () => uploadInput.click());
    if (cameraBtn) cameraBtn.addEventListener('click', () => cameraInput.click());
    if (uploadInput) uploadInput.addEventListener('change', handleFileSelect);
    if (cameraInput) cameraInput.addEventListener('change', handleFileSelect);

    // 3. Edit Room
    if (btnBackToWelcome) btnBackToWelcome.addEventListener('click', () => showStep(stepWelcome));

    if (btnConfirmRoom) {
        btnConfirmRoom.addEventListener('click', () => {
            if (state.isUploading || state.isCleaningUp) return;
            
            // Need at least a local image to continue
            const roomUrl = getActiveRoomUrl() || state.currentRoomImageUrl;
            if (!roomUrl) {
                showError('Please upload an image first');
                return;
            }
            if (roomImage) roomImage.src = roomUrl;
            
            showStep(stepPlace);
            state.x = 0;
            state.y = 0;
            state.scale = 1.0;
            updateTransform();
        });
    }
    
    // Remove button - process the mask
    if (btnRemove) {
        btnRemove.addEventListener('click', async () => {
            // Must have session, drawing, not cleaning up, and upload must be complete
            if (state.isCleaningUp || !state.sessionId || drawHistory.length === 0 || state.isUploading || !state.originalRoomImageUrl) {
                console.log('Remove blocked:', { isCleaningUp: state.isCleaningUp, sessionId: state.sessionId, hasDrawing: drawHistory.length > 0, isUploading: state.isUploading, hasOriginalUrl: !!state.originalRoomImageUrl });
                return;
            }
            
            state.isCleaningUp = true;
            if (cleanupLoading) cleanupLoading.classList.remove('hidden');
            if (btnRemove) btnRemove.disabled = true;
            if (btnUndo) btnUndo.disabled = true;
            if (btnClear) btnClear.disabled = true;
            
            try {
                const maskDataUrl = generateMaskImage();
                console.log('Sending mask for cleanup...');
                
                const result = await cleanupWithMask(maskDataUrl);
                
                state.cleanedRoomImageUrl = result.cleaned_room_image_url;
                
                if (roomPreview) roomPreview.src = result.cleaned_room_image_url;
                if (roomImage) roomImage.src = result.cleaned_room_image_url;
                
                // Clear canvas for next edit
                if (ctx) {
                    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                    drawHistory = [];
                }
                
                // Re-init canvas for the new image
                setTimeout(initCanvas, 100);
                
                console.log('Cleanup complete:', result.cleaned_room_image_url);
                
            } catch (err) {
                console.error('Cleanup error:', err);
                showError('Failed to remove: ' + err.message);
            } finally {
                state.isCleaningUp = false;
                if (cleanupLoading) cleanupLoading.classList.add('hidden');
                updateEraserButtons();
            }
        });
    }

    // 4. Place Product (Interactions)
    const updateTransform = () => {
        if (productContainer) {
            productContainer.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        }
        if (scaleValue) scaleValue.textContent = state.scale.toFixed(1);
        if (scaleSlider) scaleSlider.value = state.scale;
    };

    let isDragging = false;
    let startX, startY, initialX, initialY;

    if (productContainer) {
        productContainer.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle')) return;
            e.preventDefault();
            isDragging = true;
            productContainer.classList.add('is-dragging');
            startX = e.clientX;
            startY = e.clientY;
            initialX = state.x;
            initialY = state.y;
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            state.x = initialX + (e.clientX - startX);
            state.y = initialY + (e.clientY - startY);
            updateTransform();
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            if (productContainer) productContainer.classList.remove('is-dragging');
        });

        productContainer.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) return;
            if (e.target.classList.contains('resize-handle')) return;
            isDragging = true;
            productContainer.classList.add('is-dragging');
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            initialX = state.x;
            initialY = state.y;
        });

        window.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            state.x = initialX + (e.touches[0].clientX - startX);
            state.y = initialY + (e.touches[0].clientY - startY);
            updateTransform();
        }, { passive: false });

        window.addEventListener('touchend', () => {
            isDragging = false;
            if (productContainer) productContainer.classList.remove('is-dragging');
        });
    }

    const handles = document.querySelectorAll('.resize-handle');
    handles.forEach(handle => {
        let isResizing = false;
        let startDist = 0;
        let startScale = 1;

        const getDist = (x, y) => {
            const rect = productContainer.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            return Math.hypot(x - cx, y - cy);
        };

        const onDown = (e) => {
            e.stopPropagation();
            e.preventDefault();
            isResizing = true;
            const clientX = e.clientX || e.touches[0].clientX;
            const clientY = e.clientY || e.touches[0].clientY;
            startDist = getDist(clientX, clientY);
            startScale = state.scale;
        };

        const onMove = (e) => {
            if (!isResizing) return;
            e.preventDefault();
            const clientX = e.clientX || e.touches[0].clientX;
            const clientY = e.clientY || e.touches[0].clientY;
            const newScale = startScale * (getDist(clientX, clientY) / startDist);
            state.scale = Math.max(0.2, Math.min(5.0, newScale));
            updateTransform();
        };

        const onUp = () => { isResizing = false; };

        handle.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        handle.addEventListener('touchstart', onDown);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
    });

    if (scaleSlider) {
        scaleSlider.addEventListener('input', (e) => {
            state.scale = parseFloat(e.target.value);
            updateTransform();
        });
    }

    // 5. Generate
    if (btnGenerate) {
        btnGenerate.addEventListener('click', () => {
            // Validate required state
            if (!state.sessionId || !state.productId) {
                showError('Missing session or product ID');
                return;
            }

            if (!roomImage || !productImage) {
                showError('Room or product image not loaded');
                return;
            }

            showStep(stepResult);
            resetError();
            statusText.textContent = 'Generating...';
            resultDiv.innerHTML = '';
            actionsDiv.classList.add('hidden');

            const roomRect = roomImage.getBoundingClientRect();
            const productRect = productImage.getBoundingClientRect();

            if (!roomRect.width || !roomRect.height) {
                showError('Room image dimensions invalid');
                return;
            }

            const productCX = productRect.left + productRect.width / 2 - roomRect.left;
            const productCY = productRect.top + productRect.height / 2 - roomRect.top;

            // Calculate normalized coordinates (0-1 range)
            // Use calculated position, or fallback to state.x/y if calculation fails
            let normalizedX = Number.isFinite(productCX / roomRect.width) 
                ? productCX / roomRect.width 
                : (state.x / roomRect.width) || 0.5;
            let normalizedY = Number.isFinite(productCY / roomRect.height)
                ? productCY / roomRect.height
                : (state.y / roomRect.height) || 0.5;

            // Clamp to valid range (0-1)
            normalizedX = Math.max(0, Math.min(1, normalizedX));
            normalizedY = Math.max(0, Math.min(1, normalizedY));

            console.log('[See It] Placement calculation:', {
                productCX, productCY,
                roomWidth: roomRect.width, roomHeight: roomRect.height,
                normalizedX, normalizedY,
                stateX: state.x, stateY: state.y
            });

            const payload = {
                room_session_id: state.sessionId,
                product_id: state.productId,
                placement: {
                    x: normalizedX,
                    y: normalizedY,
                    scale: state.scale || 1.0
                },
                config: {
                    style_preset: 'neutral',
                    quality: 'standard',
                    product_image_url: state.productImageUrl  // Fallback image URL
                }
            };

            console.log('[See It] Render payload:', payload);

            fetch('/apps/see-it/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(res => res.json())
                .then(data => {
                    // Handle immediate failure
                    if (data.status === 'failed') {
                        const errorMsg = data.error === 'room_not_found' 
                            ? 'Room session expired. Please upload your room image again.'
                            : data.error === 'no_product_image'
                            ? 'Product image not available. Please try again.'
                            : 'Render failed. Please try again.';
                        showError(errorMsg);
                        statusText.textContent = '';
                        actionsDiv.classList.remove('hidden');
                        btnRetry.classList.remove('hidden');
                        return;
                    }
                    
                    if (data.job_id) {
                        pollStatus(data.job_id);
                    } else {
                        throw new Error('No job ID returned');
                    }
                })
                .catch(err => {
                    showError('Error starting render: ' + err.message);
                    statusText.textContent = '';
                    actionsDiv.classList.remove('hidden');
                    btnRetry.classList.remove('hidden');
                });
        });
    }

    const pollStatus = (jobId) => {
        const POLL_INTERVAL_MS = 2000;
        const MAX_POLL_DURATION_MS = 60000; // 60 seconds
        const maxAttempts = Math.ceil(MAX_POLL_DURATION_MS / POLL_INTERVAL_MS);
        let attemptCount = 0;

        const interval = setInterval(() => {
            attemptCount++;

            // Check if we've exceeded the maximum number of attempts
            if (attemptCount > maxAttempts) {
                clearInterval(interval);
                showError('Request timed out. The image is taking longer than expected to generate. Please try again.');
                statusText.textContent = '';
                actionsDiv.classList.remove('hidden');
                btnRetry.classList.remove('hidden');
                return;
            }

            fetch(`/apps/see-it/render/${jobId}`)
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`Server error: ${res.status}`);
                    }
                    return res.json();
                })
                .then(data => {
                    if (data.status === 'completed') {
                        clearInterval(interval);
                        statusText.textContent = 'Done!';
                        const img = document.createElement('img');
                        img.src = data.imageUrl;
                        resultDiv.appendChild(img);
                        actionsDiv.classList.remove('hidden');
                        btnRetry.classList.add('hidden');
                    } else if (data.status === 'failed') {
                        clearInterval(interval);
                        showError(data.errorMessage || 'Render failed');
                        statusText.textContent = '';
                        actionsDiv.classList.remove('hidden');
                        btnRetry.classList.remove('hidden');
                    }
                    // If status is 'pending' or 'processing', continue polling (next interval tick)
                })
                .catch(err => {
                    clearInterval(interval);
                    console.error('Polling error:', err);
                    showError('Network error while checking status. Please check your connection and try again.');
                    statusText.textContent = '';
                    actionsDiv.classList.remove('hidden');
                    btnRetry.classList.remove('hidden');
                });
        }, POLL_INTERVAL_MS);
    };

    if (btnAdjust) btnAdjust.addEventListener('click', () => showStep(stepPlace));
    if (btnStartOver) btnStartOver.addEventListener('click', () => showStep(stepWelcome));

});
