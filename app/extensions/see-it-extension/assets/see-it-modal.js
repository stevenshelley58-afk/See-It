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
    const roomPreview = $('see-it-room-preview');
    const btnCleanup = $('see-it-tool-cleanup');
    const maskInput = $('see-it-mask-upload');
    const btnConfirmRoom = $('see-it-confirm-room');
    const btnBackToWelcome = $('see-it-back-to-welcome');

    // Place Inputs
    const roomImage = $('see-it-room-image');
    const productContainer = $('see-it-product-container');
    const productImage = $('see-it-product-image');
    const canvasContainer = $('see-it-canvas-container');
    const scaleSlider = $('see-it-scale-slider');
    const scaleValue = $('see-it-scale-value');
    const btnGenerate = $('see-it-generate');
    const btnSaveRoom = $('see-it-save-room');
    const savedRoomsList = $('see-it-saved-rooms-list');

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
        originalRoomImageUrl: null, // The confirmed URL from server
        currentRoomImageUrl: null,  // The blob/data URL for display
        productImageUrl: trigger ? trigger.dataset.productImage : '',
        productId: trigger ? trigger.dataset.productId : '',
        scale: 1.0,
        x: 0,
        y: 0,
        isUploading: false
    };

    // --- Helpers ---
    const showStep = (step) => {
        [stepWelcome, stepEdit, stepPlace, stepResult].forEach(s => s && s.classList.add('hidden'));
        if (step) step.classList.remove('hidden');
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

    // --- API Calls ---
    const startSession = async () => {
        const res = await fetch('/apps/see-it/room/start', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to start session');
        return await res.json();
    };

    const uploadImage = async (file, uploadUrl) => {
        const res = await fetch(uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type }
        });
        if (!res.ok) throw new Error('Failed to upload image to storage');
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

    // --- Flow Handlers ---

    // 1. Initialize
    if (trigger) {
        trigger.addEventListener('click', () => {
            modal.classList.remove('hidden');
            showStep(stepWelcome);
            // Reset state if needed, or keep previous session? Let's reset for now.
            state.currentRoomImageUrl = null;
            state.originalRoomImageUrl = null;
            state.sessionId = null;
            if (productImage) productImage.src = state.productImageUrl;
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    }

    // 2. Upload / Capture
    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Show preview immediately
        const reader = new FileReader();
        reader.onload = (e) => {
            state.currentRoomImageUrl = e.target.result;
            if (roomPreview) roomPreview.src = state.currentRoomImageUrl;
            if (roomImage) roomImage.src = state.currentRoomImageUrl;
            showStep(stepEdit);
        };
        reader.readAsDataURL(file);

        // Start Upload Process in Background (or block 'Continue' until done)
        try {
            state.isUploading = true;
            if (btnConfirmRoom) {
                btnConfirmRoom.textContent = 'Uploading...';
                btnConfirmRoom.disabled = true;
            }

            // A. Start Session
            const sessionData = await startSession();
            state.sessionId = sessionData.sessionId;
            const uploadUrl = sessionData.uploadUrl;

            // B. Upload File
            await uploadImage(file, uploadUrl);

            // C. Confirm
            const confirmData = await confirmRoom(state.sessionId);
            state.originalRoomImageUrl = confirmData.roomImageUrl; // The real URL

            console.log('Upload complete:', state.originalRoomImageUrl);

        } catch (err) {
            showError('Upload failed: ' + err.message);
        } finally {
            state.isUploading = false;
            if (btnConfirmRoom) {
                btnConfirmRoom.textContent = 'Continue';
                btnConfirmRoom.disabled = false;
            }
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
            if (state.isUploading) return; // Should be disabled anyway
            showStep(stepPlace);
            // Reset placement
            state.x = 0;
            state.y = 0;
            state.scale = 1.0;
            updateTransform();
        });
    }

    // Cleanup (Remove Object) - Just a stub/hook for now
    if (btnCleanup) btnCleanup.addEventListener('click', () => maskInput.click());
    if (maskInput) maskInput.addEventListener('change', async (e) => {
        // Reuse existing cleanup logic if available, or stub
        alert('Object removal logic would trigger here. (Backend integration pending)');
    });

    // 4. Place Product (Interactions)

    const updateTransform = () => {
        if (productContainer) {
            productContainer.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        }
        if (scaleValue) scaleValue.textContent = state.scale.toFixed(1);
        if (scaleSlider) scaleSlider.value = state.scale;
    };

    // Drag Logic
    let isDragging = false;
    let startX, startY, initialX, initialY;

    if (productContainer) {
        productContainer.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle')) return; // Ignore handles
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
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            state.x = initialX + dx;
            state.y = initialY + dy;
            updateTransform();
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            if (productContainer) productContainer.classList.remove('is-dragging');
        });

        // Touch Events for Drag
        productContainer.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) return; // Pinch handled elsewhere
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
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            state.x = initialX + dx;
            state.y = initialY + dy;
            updateTransform();
        }, { passive: false });

        window.addEventListener('touchend', () => {
            isDragging = false;
            if (productContainer) productContainer.classList.remove('is-dragging');
        });
    }

    // Resize Logic (Handles)
    // Simplified: Dragging a handle changes scale based on distance from center
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
            const currentDist = getDist(clientX, clientY);

            const newScale = startScale * (currentDist / startDist);
            state.scale = Math.max(0.2, Math.min(5.0, newScale)); // Clamp
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

    // Slider Logic
    if (scaleSlider) {
        scaleSlider.addEventListener('input', (e) => {
            state.scale = parseFloat(e.target.value);
            updateTransform();
        });
    }

    // 5. Generate
    if (btnGenerate) {
        btnGenerate.addEventListener('click', () => {
            showStep(stepResult);
            resetError();
            statusText.textContent = 'Generating...';
            resultDiv.innerHTML = '';
            actionsDiv.classList.add('hidden');

            // Calculate relative coordinates
            // Note: We need to map the visual placement back to 0-1 coordinates relative to the ROOM image
            const roomRect = roomImage.getBoundingClientRect();
            const productRect = productImage.getBoundingClientRect(); // Visual rect

            // Center of product relative to room top-left
            const productCX = productRect.left + productRect.width / 2 - roomRect.left;
            const productCY = productRect.top + productRect.height / 2 - roomRect.top;

            const relativeX = productCX / roomRect.width;
            const relativeY = productCY / roomRect.height;

            // Scale is tricky because it depends on the intrinsic size relation.
            // For MVP, we pass the raw slider scale or a normalized visual scale.
            // Let's pass the raw state.scale and let backend/image-service interpret or adjust.
            // Better: Pass the ratio of product width to room width?
            // The current backend expects `scale` as a multiplier of the "prepared product size".
            // Let's stick to state.scale for now.

            const payload = {
                room_session_id: state.sessionId,
                product_id: state.productId,
                placement: {
                    x: relativeX,
                    y: relativeY,
                    scale: state.scale
                },
                config: {
                    style_preset: 'neutral', // Default
                    quality: 'standard'
                }
            };

            fetch('/apps/see-it/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(res => res.json())
                .then(data => {
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
        const interval = setInterval(() => {
            fetch(`/apps/see-it/render/${jobId}`)
                .then(res => res.json())
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
                })
                .catch(err => {
                    clearInterval(interval);
                    showError('Polling error');
                });
        }, 2000);
    };

    if (btnAdjust) btnAdjust.addEventListener('click', () => showStep(stepPlace));
    if (btnStartOver) btnStartOver.addEventListener('click', () => showStep(stepWelcome));

});
