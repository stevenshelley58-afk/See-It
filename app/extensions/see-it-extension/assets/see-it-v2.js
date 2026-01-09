/**
 * See It V2 - Hero Shot Flow
 * Version: 2.0.0
 *
 * Flow: Upload photo → AI generates 4 placements → User picks favorite → Done
 * Falls back to v1 detailed flow if user wants more control.
 */

document.addEventListener('DOMContentLoaded', function () {
  const VERSION = '2.0.0';
  console.log('[See It V2] === SEE IT V2 MODAL LOADED ===', { VERSION, timestamp: Date.now() });

  // ============================================================================
  // ASPECT RATIO NORMALIZATION (Gemini-compatible)
  // ============================================================================
  const GEMINI_SUPPORTED_RATIOS = [
    { label: '1:1', value: 1.0 },
    { label: '4:5', value: 0.8 },
    { label: '5:4', value: 1.25 },
    { label: '3:4', value: 0.75 },
    { label: '4:3', value: 4 / 3 },
    { label: '2:3', value: 2 / 3 },
    { label: '3:2', value: 1.5 },
    { label: '9:16', value: 9 / 16 },
    { label: '16:9', value: 16 / 9 },
    { label: '21:9', value: 21 / 9 },
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
          console.log('[See It V2] Room normalized:', {
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

  // ============================================================================
  // DOM Elements + Robust Init (themes may inject sections after DOMContentLoaded)
  // ============================================================================
  const $ = id => document.getElementById(id);

  function initSeeItV2() {
    // Guard: avoid double-binding if init is retried or sections re-render.
    if (typeof window !== 'undefined' && window.__SEE_IT_V2_INITIALIZED__) return true;

    // Some themes may render the same section twice (e.g. mobile/desktop),
    // which would produce multiple buttons with the same id. Bind all.
    const triggers = Array.from(document.querySelectorAll('#see-it-v2-trigger'));
    const modal = $('see-it-v2-modal');

    if (!triggers.length || !modal) return false;

    // Keep a stable reference for default dataset reads, but always use the clicked trigger when opening.
    const trigger = triggers[0];
    let activeTriggerWidget = null;
    let activeTrigger = trigger;

    if (typeof window !== 'undefined') window.__SEE_IT_V2_INITIALIZED__ = true;

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
      document.documentElement.classList.add('see-it-v2-modal-open');
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    };

    const unlockScroll = () => {
      document.documentElement.classList.remove('see-it-v2-modal-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScrollY);
    };

    // Screens
    const screenEntry = $('see-it-v2-screen-entry');
    const screenGenerating = $('see-it-v2-screen-generating');
    const screenSelect = $('see-it-v2-screen-select');
    const screenResult = $('see-it-v2-screen-result');

    // Entry screen elements
    const btnCloseEntry = $('see-it-v2-close-entry');
    const btnTakePhoto = $('see-it-v2-btn-take-photo');
    const btnUpload = $('see-it-v2-btn-upload');
    const uploadInput = $('see-it-v2-upload-input');
    const cameraInput = $('see-it-v2-camera-input');

    // Generating screen elements
    const btnBackGenerating = $('see-it-v2-back-generating');
    const generatingTip = $('see-it-v2-generating-tip');

    // Select screen elements
    const btnBackSelect = $('see-it-v2-back-select');
    const selectCells = document.querySelectorAll('.see-it-v2-select-cell');
    const btnFallbackV1 = $('see-it-v2-fallback-v1');

    // Result screen elements
    const btnCloseResult = $('see-it-v2-close-result');
    const btnBackResult = $('see-it-v2-back-result');
    const resultImage = $('see-it-v2-result-image');
    const btnShare = $('see-it-v2-share');
    const btnTryAgain = $('see-it-v2-try-again');
    const btnTryAnother = $('see-it-v2-try-another');
    const errorDiv = $('see-it-v2-global-error');

    // ============================================================================
    // State
    // ============================================================================
    let state = {
    sessionId: null,
    roomSessionId: null,
    originalRoomImageUrl: null,
    localImageDataUrl: null,
    productImageUrl: trigger?.dataset.productImage || '',
    productId: trigger?.dataset.productId || '',
    productTitle: trigger?.dataset.productTitle || '',
    productPrice: trigger?.dataset.productPrice || '',
    currentScreen: 'entry',
    normalizedWidth: 0,
    normalizedHeight: 0,
    variants: [], // Array of { id, image_url, hint }
    selectedVariantId: null,
    lastResultUrl: null,
    uploadComplete: false,
    uploadPromise: null,
    uploadError: null,
    isGenerating: false,
  };

    // Rotating tips for the generating screen
    const GENERATING_TIPS = [
    'Tip: Good lighting makes the best visualizations',
    'Tip: Clear floor space helps with placement',
    'AI is analyzing your room layout...',
    'Finding the perfect spots for your furniture...',
    'Almost there...',
  ];
    let tipIndex = 0;
    let tipInterval = null;

    // ============================================================================
    // Screen Navigation
    // ============================================================================
    const showScreen = (screenName) => {
    const screens = {
      entry: screenEntry,
      generating: screenGenerating,
      select: screenSelect,
      result: screenResult,
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

    // Start/stop tip rotation
    if (screenName === 'generating') {
      startTipRotation();
    } else {
      stopTipRotation();
    }

    console.log('[See It V2] Screen:', screenName);
  };

  const startTipRotation = () => {
    tipIndex = 0;
    if (generatingTip) {
      generatingTip.textContent = GENERATING_TIPS[0];
    }
    tipInterval = setInterval(() => {
      tipIndex = (tipIndex + 1) % GENERATING_TIPS.length;
      if (generatingTip) {
        generatingTip.textContent = GENERATING_TIPS[tipIndex];
      }
    }, 3000);
  };

  const stopTipRotation = () => {
    if (tipInterval) {
      clearInterval(tipInterval);
      tipInterval = null;
    }
  };

  // ============================================================================
  // Error Handling
  // ============================================================================
  const showError = (msg) => {
    console.error('[See It V2] ERROR:', msg);
    if (errorDiv) {
      errorDiv.textContent = msg;
      errorDiv.classList.remove('see-it-v2-hidden');
      // Auto-hide after 5 seconds
      setTimeout(() => {
        errorDiv.classList.add('see-it-v2-hidden');
      }, 5000);
    }
  };

  const resetError = () => {
    if (errorDiv) {
      errorDiv.classList.add('see-it-v2-hidden');
    }
  };

  // ============================================================================
  // API Calls
  // ============================================================================
  const startSession = async (contentType = 'image/jpeg') => {
    const res = await fetch('/apps/see-it/room/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: contentType }),
    });

    // Always read the body so we can surface real error messages to the user.
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { message: raw };
    }

    if (!res.ok) {
      const msg =
        data.message ||
        data.error ||
        `Failed to start session (HTTP ${res.status})`;
      throw new Error(msg);
    }

    return data;
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

  /**
   * Call the V2 render API to generate 4 placement variants
   */
  const generateVariants = async (roomSessionId, productId) => {
    console.log('[See It V2] Calling render-v2 API...', { roomSessionId, productId });

    const res = await fetch('/apps/see-it/render-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_session_id: roomSessionId,
        product_id: productId,
      })
    });

    const data = await res.json();
    console.log('[See It V2] render-v2 response:', data);

    if (!res.ok) {
      // Check for v2 not enabled error
      if (data.error === 'v2_not_enabled') {
        throw new Error('V2 is not enabled for this store. Please use the standard flow.');
      }
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }

    if (!data.variants || data.variants.length === 0) {
      throw new Error('No variants returned from API');
    }

    return data;
  };

  /**
   * Call the V2 select API when user picks a variant
   */
  const selectVariant = async (sessionId, variantId, roomSessionId) => {
    console.log('[See It V2] Calling select-v2 API...', { sessionId, variantId, roomSessionId });

    const res = await fetch('/apps/see-it/select-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        selected_variant_id: variantId,
        room_session_id: roomSessionId,
      })
    });

    const data = await res.json();
    console.log('[See It V2] select-v2 response:', data);

    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }

    return data;
  };

  // ============================================================================
  // Modal Open/Close
  // ============================================================================
  const openFromTrigger = (sourceTrigger) => {
    console.log('[See It V2] Modal opened');
    activeTrigger = sourceTrigger || activeTrigger;
    ensureModalPortaled();
    lockScroll();
    modal.classList.remove('hidden');
    activeTriggerWidget = activeTrigger?.closest('.see-it-v2-widget-hook') || null;
    if (activeTriggerWidget) activeTriggerWidget.style.display = 'none';
    resetError();

    state.productId = activeTrigger?.dataset.productId || state.productId;
    state.productTitle = activeTrigger?.dataset.productTitle || state.productTitle;
    state.productPrice = activeTrigger?.dataset.productPrice || state.productPrice;
    state.productImageUrl = activeTrigger?.dataset.productImage || state.productImageUrl;

    // Reset state
    state.sessionId = null;
    state.roomSessionId = null;
    state.variants = [];
    state.selectedVariantId = null;
    state.uploadComplete = false;
    state.uploadPromise = null;
    state.uploadError = null;
    state.isGenerating = false;

    showScreen('entry');
  };

  triggers.forEach(t => t.addEventListener('click', () => openFromTrigger(t)));

  const closeModal = () => {
    modal.classList.add('hidden');
    unlockScroll();
    if (activeTriggerWidget) activeTriggerWidget.style.display = '';
    showScreen('entry');
    stopTipRotation();
    state.isGenerating = false;
  };

  btnCloseEntry?.addEventListener('click', closeModal);
  btnCloseResult?.addEventListener('click', closeModal);

  // ============================================================================
  // File Upload Handler
  // ============================================================================
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    console.log('[See It V2] File selected:', file.name, file.size);
    resetError();

    // Reset state
    state.originalRoomImageUrl = null;
    state.roomSessionId = null;
    state.uploadComplete = false;
    state.uploadPromise = null;
    state.uploadError = null;
    state.variants = [];
    state.selectedVariantId = null;

    try {
      // Normalize image locally (instant)
      const normalized = await normalizeRoomImage(file);
      state.normalizedWidth = normalized.width;
      state.normalizedHeight = normalized.height;

      // Store local preview
      const dataUrl = URL.createObjectURL(normalized.blob);
      state.localImageDataUrl = dataUrl;

      // Show generating screen immediately
      showScreen('generating');

      // Upload and generate in parallel
      const normalizedFile = new File([normalized.blob], 'room.jpg', { type: 'image/jpeg' });

      // Start upload
      const session = await startSession(normalizedFile.type || 'image/jpeg');
      state.roomSessionId = session.sessionId || session.room_session_id;
      console.log('[See It V2] Session created:', state.roomSessionId);

      await uploadImage(normalizedFile, session.uploadUrl || session.upload_url);
      console.log('[See It V2] Image uploaded');

      const confirm = await confirmRoom(state.roomSessionId);
      state.originalRoomImageUrl = confirm.roomImageUrl || confirm.room_image_url;
      state.uploadComplete = true;
      console.log('[See It V2] Room confirmed:', state.originalRoomImageUrl);

      // Now generate variants
      state.isGenerating = true;
      const result = await generateVariants(state.roomSessionId, state.productId);
      state.isGenerating = false;

      state.sessionId = result.session_id;
      state.variants = result.variants;

      console.log('[See It V2] Got variants:', state.variants.length, 'in', result.duration_ms, 'ms');

      // Update the select grid with images
      updateSelectGrid();

      // Show select screen
      showScreen('select');

    } catch (err) {
      console.error('[See It V2] Error:', err);
      state.isGenerating = false;
      showError(err.message || 'Failed to process image');
      showScreen('entry');
    }
  };

  // ============================================================================
  // Select Grid
  // ============================================================================
  const updateSelectGrid = () => {
    const variantMap = {};
    state.variants.forEach(v => {
      variantMap[v.id] = v;
    });

    ['open', 'wall', 'light', 'corner'].forEach(id => {
      const img = $(`see-it-v2-variant-${id}`);
      if (img && variantMap[id]) {
        img.src = variantMap[id].image_url;
        img.alt = variantMap[id].hint || id;
      }
    });
  };

  // Handle variant selection
  selectCells.forEach(cell => {
    cell.addEventListener('click', async () => {
      const variantId = cell.dataset.variant;
      if (!variantId) return;

      console.log('[See It V2] Variant selected:', variantId);
      resetError();

      // Visual selection
      selectCells.forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      state.selectedVariantId = variantId;

      // Find the variant
      const variant = state.variants.find(v => v.id === variantId);
      if (!variant) {
        showError('Selected variant not found');
        return;
      }

      try {
        // Call select API (optional upscaling)
        const result = await selectVariant(
          state.sessionId,
          variantId,
          state.roomSessionId
        );

        // Use upscaled URL if available, otherwise use the variant URL
        state.lastResultUrl = result.image_url || variant.image_url;

        // Show result
        if (resultImage) {
          resultImage.src = state.lastResultUrl;
        }
        showScreen('result');

      } catch (err) {
        console.error('[See It V2] Select error:', err);
        // Still show result with original variant URL
        state.lastResultUrl = variant.image_url;
        if (resultImage) {
          resultImage.src = state.lastResultUrl;
        }
        showScreen('result');
      }
    });
  });

  // ============================================================================
  // Navigation Buttons
  // ============================================================================
  btnBackGenerating?.addEventListener('click', () => {
    if (state.isGenerating) {
      console.log('[See It V2] Generation in progress, cannot go back');
      return;
    }
    showScreen('entry');
  });

  btnBackSelect?.addEventListener('click', () => {
    showScreen('entry');
  });

  btnBackResult?.addEventListener('click', () => {
    showScreen('select');
    // Reset selection
    selectCells.forEach(c => c.classList.remove('selected'));
    state.selectedVariantId = null;
  });

  // ============================================================================
  // Fallback to V1
  // ============================================================================
  btnFallbackV1?.addEventListener('click', () => {
    console.log('[See It V2] Falling back to V1 detailed mode');
    closeModal();

    // Try to trigger the V1 widget if it exists
    const v1Trigger = document.getElementById('see-it-trigger');
    if (v1Trigger) {
      v1Trigger.click();
    } else {
      showError('Detailed mode not available. Please use a different product page.');
    }
  });

  // ============================================================================
  // Result Actions
  // ============================================================================
  const resetToEntry = () => {
    state.sessionId = null;
    state.roomSessionId = null;
    state.originalRoomImageUrl = null;
    state.localImageDataUrl = null;
    state.uploadComplete = false;
    state.variants = [];
    state.selectedVariantId = null;
    showScreen('entry');
  };

  btnTryAgain?.addEventListener('click', resetToEntry);
  btnTryAnother?.addEventListener('click', resetToEntry);

  // Share button
  btnShare?.addEventListener('click', async () => {
    if (!state.lastResultUrl) return;

    try {
      if (navigator.share) {
        const response = await fetch(state.lastResultUrl);
        const blob = await response.blob();
        const file = new File([blob], 'see-it-room.jpg', { type: 'image/jpeg' });
        await navigator.share({ files: [file], title: state.productTitle || 'My room' });
      } else {
        // Fallback: download
        const a = document.createElement('a');
        a.href = state.lastResultUrl;
        a.download = 'see-it-room.jpg';
        a.click();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        const a = document.createElement('a');
        a.href = state.lastResultUrl;
        a.download = 'see-it-room.jpg';
        a.click();
      }
    }
  });

  // ============================================================================
  // File Input Handlers
  // ============================================================================
  btnTakePhoto?.addEventListener('click', () => cameraInput?.click());
  btnUpload?.addEventListener('click', () => uploadInput?.click());
  uploadInput?.addEventListener('change', handleFile);
  cameraInput?.addEventListener('change', handleFile);

    console.log('[See It V2] Initialization complete');
    return true;
  }

  // First attempt (normal themes)
  if (initSeeItV2()) return;

  // Retry for themes that inject / re-render sections after DOMContentLoaded
  let retries = 0;
  const retryTimer = setInterval(() => {
    retries += 1;
    if (initSeeItV2()) {
      clearInterval(retryTimer);
    } else if (retries >= 40) { // ~10s max
      clearInterval(retryTimer);
      console.log('[See It V2] Button not found after retries - product may not have a featured image or section is not on page');
    }
  }, 250);

  // Shopify theme editor / dynamic section reloads
  document.addEventListener('shopify:section:load', () => {
    initSeeItV2();
  });
});
