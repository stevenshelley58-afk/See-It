document.addEventListener('DOMContentLoaded', function () {
    // --- DOM Elements ---
    const $ = id => document.getElementById(id);
    const trigger = $('see-it-trigger');
    const modal = $('see-it-modal');
    const closeBtn = document.querySelector('.see-it-close');

    // Early exit if essential elements not found (e.g., product has no featured image)
    if (!trigger || !modal) {
        console.log('[See It] Button not rendered - product may not have a featured image');
        return;
    }

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
    const uploadIndicator = $('see-it-upload-indicator');

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
        localImageDataUrl: null,  // Client-side preview (instant)
        productImageUrl: trigger ? trigger.dataset.productImage : '',
        preparedProductImageUrl: null,
        productId: trigger ? trigger.dataset.productId : '',
        scale: 1.0,
        x: 0,
        y: 0,
        isUploading: false,
        isCleaningUp: false,
        isPrepared: false,
        uploadComplete: false  // Track when cloud upload is done
    };

    // Canvas drawing state
    let ctx = null;
    let isDrawing = false;
    let drawHistory = []; // For undo
    const BRUSH_SIZE = 40; // Larger brush for easier selection
    const BRUSH_COLOR = 'rgba(138, 43, 226, 0.6)'; // Semi-transparent purple

    const getActiveRoomUrl = () => state.cleanedRoomImageUrl || state.originalRoomImageUrl || state.localImageDataUrl;

    // --- Helpers ---
    const showStep = (step) => {
        [stepWelcome, stepEdit, stepPlace, stepResult].forEach(s => s && s.classList.add('hidden'));
        if (step) step.classList.remove('hidden');
        
        // Initialize canvas when entering edit step
        if (step === stepEdit) {
            setTimeout(initCanvas, 100);
        }
    };

    // Keep canvas aligned if the modal resizes (e.g., viewport change)
    window.addEventListener('resize', () => {
        if (stepEdit && !stepEdit.classList.contains('hidden')) {
            initCanvas();
        }
    });

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
        if (btnUndo) btnUndo.disabled = !hasDrawing;
        if (btnClear) btnClear.disabled = !hasDrawing;
        // Remove button needs: drawing exists, not cleaning up, upload finished
        if (btnRemove) {
            const canRemove = hasDrawing && !state.isCleaningUp && state.uploadComplete;
            btnRemove.disabled = !canRemove;
            // Show waiting state if drawing but upload not done
            if (hasDrawing && !state.uploadComplete && !state.isCleaningUp) {
                btnRemove.textContent = 'Uploading...';
            } else {
                btnRemove.textContent = 'Remove';
            }
        }
    };

    const updateUploadIndicator = () => {
        if (uploadIndicator) {
            if (state.isUploading) {
                uploadIndicator.classList.remove('hidden');
            } else {
                uploadIndicator.classList.add('hidden');
            }
        }
    };

    // --- Canvas Drawing ---
    const initCanvas = () => {
        if (!maskCanvas || !roomPreview || !canvasWrapper) return;

        // Wait for image to load
        if (!roomPreview.complete || !roomPreview.naturalWidth) {
            roomPreview.onload = () => requestAnimationFrame(initCanvas);
            return;
        }

        // Use requestAnimationFrame to ensure layout is complete
        requestAnimationFrame(() => {
            // Get the actual rendered size and position of the image
            const imgRect = roomPreview.getBoundingClientRect();
            const wrapperRect = canvasWrapper.getBoundingClientRect();

            // Calculate offset from wrapper to image (image is centered)
            const offsetLeft = imgRect.left - wrapperRect.left;
            const offsetTop = imgRect.top - wrapperRect.top;

            // Set canvas to exactly match image dimensions (use device pixel ratio for sharpness)
            const dpr = window.devicePixelRatio || 1;
            const width = imgRect.width;
            const height = imgRect.height;

            // Canvas internal size (for drawing resolution)
            maskCanvas.width = Math.round(width * dpr);
            maskCanvas.height = Math.round(height * dpr);

            // Canvas display size (CSS)
            maskCanvas.style.width = width + 'px';
            maskCanvas.style.height = height + 'px';
            maskCanvas.style.left = offsetLeft + 'px';
            maskCanvas.style.top = offsetTop + 'px';
            maskCanvas.style.position = 'absolute';

            ctx = maskCanvas.getContext('2d');
            ctx.scale(dpr, dpr); // Scale context for high-DPI displays
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = BRUSH_SIZE;
            ctx.strokeStyle = BRUSH_COLOR;

            // Clear and reset
            ctx.clearRect(0, 0, width, height);
            drawHistory = [];
            updateEraserButtons();

            console.log('[See It] Canvas initialized:', { width, height, offsetLeft, offsetTop, dpr });
        });
    };
    
    const getEventPos = (e) => {
        const rect = maskCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        // Return position in CSS pixels (context is scaled for DPR)
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };

    const saveState = () => {
        if (!ctx) return;
        // Save the full canvas buffer (at device pixel ratio resolution)
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
                const dpr = window.devicePixelRatio || 1;
                drawHistory.pop(); // Remove current state
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for putImageData
                if (drawHistory.length > 0) {
                    ctx.putImageData(drawHistory[drawHistory.length - 1], 0, 0);
                } else {
                    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                }
                ctx.restore();
                ctx.scale(dpr, dpr); // Reapply scale
                updateEraserButtons();
            }
        });
    }

    // Clear button
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            if (ctx) {
                const dpr = window.devicePixelRatio || 1;
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                ctx.restore();
                ctx.scale(dpr, dpr);
                drawHistory = [];
                updateEraserButtons();
            }
        });
    }

    // Generate mask image from canvas (outputs at display resolution, not DPR-scaled)
    const generateMaskImage = () => {
        if (!ctx || !maskCanvas) return null;

        const dpr = window.devicePixelRatio || 1;
        const displayWidth = Math.round(maskCanvas.width / dpr);
        const displayHeight = Math.round(maskCanvas.height / dpr);

        // Create a new canvas for the mask (white on black) at display resolution
        const maskCtx = document.createElement('canvas').getContext('2d');
        maskCtx.canvas.width = displayWidth;
        maskCtx.canvas.height = displayHeight;

        // Fill with black
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, displayWidth, displayHeight);

        // Draw the scaled-down version of the drawing canvas
        maskCtx.drawImage(maskCanvas, 0, 0, displayWidth, displayHeight);

        // Get the pixel data and convert to binary mask
        const imageData = maskCtx.getImageData(0, 0, displayWidth, displayHeight);
        const pixels = imageData.data;

        // Convert: any pixel with alpha > 0 becomes white, else black
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] > 10) { // If alpha > threshold (some anti-aliasing)
                pixels[i] = 255;     // R
                pixels[i + 1] = 255; // G
                pixels[i + 2] = 255; // B
                pixels[i + 3] = 255; // A
            } else {
                pixels[i] = 0;
                pixels[i + 1] = 0;
                pixels[i + 2] = 0;
                pixels[i + 3] = 255;
            }
        }

        maskCtx.putImageData(imageData, 0, 0);
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

        // Reset state for new image
        state.cleanedRoomImageUrl = null;
        state.originalRoomImageUrl = null;
        state.sessionId = null;
        state.uploadComplete = false;
        state.localImageDataUrl = null;

        // INSTANT: Show preview immediately using FileReader
        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            state.localImageDataUrl = loadEvent.target.result;
            state.currentRoomImageUrl = loadEvent.target.result;
            if (roomPreview) {
                roomPreview.src = state.localImageDataUrl;
                // Trigger canvas init once image loads
                roomPreview.onload = () => requestAnimationFrame(initCanvas);
            }
            if (roomImage) roomImage.src = state.localImageDataUrl;
            showStep(stepEdit);
        };
        reader.readAsDataURL(file);

        // BACKGROUND: Upload to cloud while user can start drawing
        state.isUploading = true;
        updateUploadIndicator();
        updateEraserButtons();

        try {
            const sessionData = await startSession();
            state.sessionId = sessionData.sessionId;
            const uploadUrl = sessionData.uploadUrl;

            await uploadImage(file, uploadUrl);

            const confirmData = await confirmRoom(state.sessionId);
            state.originalRoomImageUrl = confirmData.roomImageUrl;
            state.uploadComplete = true;

            console.log('[See It] Upload complete:', state.originalRoomImageUrl);

        } catch (err) {
            console.error('[See It] Upload error:', err);
            showError('Upload failed: ' + err.message);
            // Reset state on error
            state.sessionId = null;
            state.uploadComplete = false;
        } finally {
            state.isUploading = false;
            updateUploadIndicator();
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
            if (state.isCleaningUp) return;

            // Need at least a local image to continue
            const roomUrl = getActiveRoomUrl();
            if (!roomUrl) {
                showError('Please upload an image first');
                return;
            }

            // If still uploading, wait for it (but this should be rare - upload is fast)
            if (state.isUploading) {
                btnConfirmRoom.textContent = 'Finishing upload...';
                btnConfirmRoom.disabled = true;
                const checkUpload = setInterval(() => {
                    if (!state.isUploading) {
                        clearInterval(checkUpload);
                        btnConfirmRoom.textContent = 'Continue →';
                        btnConfirmRoom.disabled = false;
                        if (state.uploadComplete) {
                            // Now continue
                            if (roomImage) roomImage.src = getActiveRoomUrl();
                            showStep(stepPlace);
                            state.x = 0;
                            state.y = 0;
                            state.scale = 1.0;
                            updateTransform();
                        }
                    }
                }, 100);
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
    
    // Remove button - process the mask (Magic Eraser)
    if (btnRemove) {
        btnRemove.addEventListener('click', async () => {
            // Must have session, drawing, not cleaning up, and upload must be complete
            if (state.isCleaningUp || !state.sessionId || drawHistory.length === 0 || !state.uploadComplete) {
                console.log('[See It] Remove blocked:', {
                    isCleaningUp: state.isCleaningUp,
                    sessionId: state.sessionId,
                    hasDrawing: drawHistory.length > 0,
                    uploadComplete: state.uploadComplete
                });
                return;
            }

            state.isCleaningUp = true;
            if (cleanupLoading) cleanupLoading.classList.remove('hidden');
            if (btnRemove) {
                btnRemove.disabled = true;
                btnRemove.textContent = 'Removing...';
            }
            if (btnUndo) btnUndo.disabled = true;
            if (btnClear) btnClear.disabled = true;
            if (btnConfirmRoom) btnConfirmRoom.disabled = true;

            try {
                const maskDataUrl = generateMaskImage();
                console.log('[See It] Sending mask for cleanup...');

                const result = await cleanupWithMask(maskDataUrl);

                state.cleanedRoomImageUrl = result.cleaned_room_image_url;

                // Show the cleaned image
                if (roomPreview) {
                    roomPreview.src = result.cleaned_room_image_url;
                    roomPreview.onload = () => {
                        // Re-init canvas for the new image after it loads
                        requestAnimationFrame(initCanvas);
                    };
                }
                if (roomImage) roomImage.src = result.cleaned_room_image_url;

                // Clear canvas for next edit
                if (ctx) {
                    const dpr = window.devicePixelRatio || 1;
                    ctx.save();
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                    ctx.restore();
                    ctx.scale(dpr, dpr);
                    drawHistory = [];
                }

                console.log('[See It] Cleanup complete:', result.cleaned_room_image_url);

            } catch (err) {
                console.error('[See It] Cleanup error:', err);
                showError('Failed to remove: ' + err.message);
            } finally {
                state.isCleaningUp = false;
                if (cleanupLoading) cleanupLoading.classList.add('hidden');
                if (btnRemove) btnRemove.textContent = 'Remove';
                if (btnConfirmRoom) btnConfirmRoom.disabled = false;
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
