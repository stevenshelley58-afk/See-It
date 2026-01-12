/**
 * See It Now - Instant AR Visualization
 * Version: 1.0.0
 *
 * Flow:
 *   Mobile: Button → Entry screen → Take Photo → Camera → Thinking → Swipe Results
 *   Desktop: Button → File picker → Thinking → Swipe Results
 *
 * This is the simplified instant visualization flow:
 *   - No select grid, just swipe through results
 *   - Mobile shows brief entry screen before camera (can't overlay UI on native camera)
 *   - Consumes whatever number of variants the API returns (not hardcoded to 5)
 */

document.addEventListener('DOMContentLoaded', function () {
  const VERSION = '1.0.0';
  console.log('[See It Now] === LOADED ===', { VERSION, timestamp: Date.now() });

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const TIPS = [
    'Tip: Good lighting makes the best visualizations',
    'Tip: Clear floor space helps with placement',
    'AI is analyzing your room layout...',
    'Finding the perfect spots for your furniture...',
    'Almost there...',
  ];

  const SWIPE_THRESHOLD = 0.25;
  const SWIPE_VELOCITY_THRESHOLD = 0.3;

  // Gemini-compatible aspect ratios (including 21:9)
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

  // ============================================================================
  // STATE
  // ============================================================================

  let state = {
    sessionId: null,
    roomSessionId: null,
    images: [],
    currentIndex: 0,
    productId: '',
    productTitle: '',
    productImageUrl: '',
    isGenerating: false,
    // Swipe state
    swipeStartX: 0,
    swipeStartTime: 0,
    swipeCurrentX: 0,
    swiping: false,
  };

  let tipInterval = null;
  let tipIndex = 0;

  // ============================================================================
  // DOM REFERENCES
  // ============================================================================

  const $ = (id) => document.getElementById(id);

  function initSeeItNow() {
    if (typeof window !== 'undefined' && window.__SEE_IT_NOW_INITIALIZED__) return true;

    const triggers = Array.from(document.querySelectorAll('#see-it-now-trigger'));
    const modal = $('see-it-now-modal');

    if (!triggers.length || !modal) return false;

    if (typeof window !== 'undefined') window.__SEE_IT_NOW_INITIALIZED__ = true;

    const trigger = triggers[0];
    let activeTrigger = trigger;

    // Elements
    const cameraInput = $('see-it-now-camera-input');
    const uploadInput = $('see-it-now-upload-input');

    const screenEntry = $('see-it-now-screen-entry');
    const screenThinking = $('see-it-now-screen-thinking');
    const screenResult = $('see-it-now-screen-result');
    const screenError = $('see-it-now-screen-error');

    const btnCloseEntry = $('see-it-now-close-entry');
    const btnCamera = $('see-it-now-btn-camera');
    const btnUploadFallback = $('see-it-now-btn-upload-fallback');
    const entryProductImg = $('see-it-now-entry-product-img');

    const thinkingProductImg = $('see-it-now-thinking-product-img');
    const thinkingTip = $('see-it-now-thinking-tip');

    const swipeContainer = $('see-it-now-swipe-container');
    const swipeTrack = $('see-it-now-swipe-track');
    const dotsContainer = $('see-it-now-dots');
    const navLeft = $('see-it-now-nav-left');
    const navRight = $('see-it-now-nav-right');

    const shareBtn = $('see-it-now-share');
    const tryAgainBtn = $('see-it-now-try-again');
    const tryAnotherBtn = $('see-it-now-try-another');
    const backResultBtn = $('see-it-now-back-result');
    const closeResultBtn = $('see-it-now-close-result');

    const errorMessage = $('see-it-now-error-message');
    const errorRetryBtn = $('see-it-now-error-retry');
    const errorCloseBtn = $('see-it-now-error-close');
    const closeErrorBtn = $('see-it-now-close-error');

    const globalError = $('see-it-now-global-error');

    // ============================================================================
    // PLATFORM DETECTION
    // ============================================================================

    function isMobile() {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
    }

    function updateButtonIcon() {
      const mobile = isMobile();
      triggers.forEach(t => {
        const cameraIcon = t.querySelector('.see-it-now-icon-camera');
        const uploadIcon = t.querySelector('.see-it-now-icon-upload');
        if (cameraIcon) cameraIcon.style.display = mobile ? 'block' : 'none';
        if (uploadIcon) uploadIcon.style.display = mobile ? 'none' : 'block';
      });
    }
    updateButtonIcon();
    window.addEventListener('resize', updateButtonIcon);

    // ============================================================================
    // SCROLL LOCK
    // ============================================================================

    let savedScrollY = 0;

    function lockScroll() {
      savedScrollY = window.scrollY;
      document.documentElement.classList.add('see-it-now-modal-open');
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    }

    function unlockScroll() {
      document.documentElement.classList.remove('see-it-now-modal-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScrollY);
    }

    // ============================================================================
    // MODAL MANAGEMENT
    // ============================================================================

    function ensureModalPortaled() {
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.zIndex = '999999';
    }

    function openModal() {
      ensureModalPortaled();
      lockScroll();
      modal.classList.remove('hidden');
    }

    function closeModal() {
      modal.classList.add('hidden');
      unlockScroll();
      stopTipRotation();
      resetState();
    }

    function resetState() {
      state.sessionId = null;
      state.roomSessionId = null;
      state.images = [];
      state.currentIndex = 0;
      state.isGenerating = false;
      state.swiping = false;
      if (swipeTrack) swipeTrack.innerHTML = '';
      if (dotsContainer) dotsContainer.innerHTML = '';
    }

    // ============================================================================
    // SCREEN NAVIGATION
    // ============================================================================

    function showScreen(screenName) {
      const screens = {
        entry: screenEntry,
        thinking: screenThinking,
        result: screenResult,
        error: screenError,
      };

      Object.values(screens).forEach(s => {
        if (s) s.classList.remove('active');
      });

      const target = screens[screenName];
      if (target) {
        target.classList.add('active');
      }

      if (screenName === 'thinking') {
        startTipRotation();
      } else {
        stopTipRotation();
      }

      console.log('[See It Now] Screen:', screenName);
    }

    // ============================================================================
    // ERROR HANDLING
    // ============================================================================

    function showError(msg) {
      console.error('[See It Now] ERROR:', msg);
      if (errorMessage) {
        errorMessage.textContent = msg || 'We couldn\'t create your visualization';
      }
      showScreen('error');
    }

    // ============================================================================
    // TIP ROTATION
    // ============================================================================

    function startTipRotation() {
      tipIndex = 0;
      if (thinkingTip) thinkingTip.textContent = TIPS[0];
      tipInterval = setInterval(() => {
        tipIndex = (tipIndex + 1) % TIPS.length;
        if (thinkingTip) thinkingTip.textContent = TIPS[tipIndex];
      }, 3000);
    }

    function stopTipRotation() {
      if (tipInterval) {
        clearInterval(tipInterval);
        tipInterval = null;
      }
    }

    // ============================================================================
    // IMAGE NORMALIZATION
    // ============================================================================

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
            console.log('[See It Now] Image normalized:', {
              original: `${w}×${h}`,
              normalized: `${outW}×${outH}`,
              ratio: closest.label,
            });
            resolve({ blob, width: outW, height: outH });
          }, 'image/jpeg', 0.92);
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = URL.createObjectURL(file);
      });
    }

    // ============================================================================
    // API CALLS
    // ============================================================================

    async function readJsonOrText(res) {
      const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      const raw = await res.text();

      // Try JSON first if it looks like JSON
      const looksJson = contentType.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[');
      if (looksJson) {
        try {
          return { data: raw ? JSON.parse(raw) : {}, raw };
        } catch (e) {
          // fall through to return raw text
        }
      }

      // Return as text payload
      return { data: { message: raw }, raw };
    }

    function buildHttpErrorMessage({ name, res, payload }) {
      const status = res?.status;
      const statusText = res?.statusText;
      const err = (payload && (payload.error || payload.message)) || `HTTP ${status}`;

      // Special-case: route missing / HTML response (common in Remix 404 pages)
      const raw = payload?.message || '';
      const looksLikeHtml = typeof raw === 'string' && raw.trim().startsWith('<!DOCTYPE');
      if (status === 404 || looksLikeHtml) {
        return [
          `${name} failed (HTTP ${status || 404}).`,
          `This usually means the backend route is not deployed yet.`,
          `Expected app-proxy route: /app-proxy/see-it-now/render`,
          `Fix: rebuild + redeploy the backend (the old build won't have this route).`,
        ].join(' ');
      }

      return `${name} failed (${status}${statusText ? ` ${statusText}` : ''}): ${err}`;
    }

    async function startSession(contentType = 'image/jpeg') {
      const res = await fetch('/apps/see-it/room/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: contentType }),
      });

      const { data } = await readJsonOrText(res);

      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }

      return data;
    }

    async function uploadImage(file, url) {
      // Use the file's actual type to match signed URL requirements
      const res = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
        mode: 'cors'
      });
      if (!res.ok) throw new Error('Upload failed');
    }

    async function confirmRoom(sessionId) {
      const res = await fetch('/apps/see-it/room/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_session_id: sessionId })
      });
      const { data } = await readJsonOrText(res);
      if (!res.ok) throw new Error(buildHttpErrorMessage({ name: 'Confirm room', res, payload: data }));
      return data;
    }

    async function generateImages(roomSessionId, productId) {
      console.log('[See It Now] Generating images...', { roomSessionId, productId });

      const res = await fetch('/apps/see-it/see-it-now/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_session_id: roomSessionId,
          product_id: productId,
        })
      });

      const { data } = await readJsonOrText(res);
      console.log('[See It Now] Generation response:', data);

      if (!res.ok) {
        throw new Error(buildHttpErrorMessage({ name: 'Generate images', res, payload: data }));
      }

      if (!data.variants || data.variants.length === 0) {
        throw new Error('No images generated');
      }

      return data;
    }

    // ============================================================================
    // SWIPE CAROUSEL
    // ============================================================================

    function populateCarousel(images) {
      state.images = images;
      state.currentIndex = 0;

      swipeTrack.innerHTML = '';
      dotsContainer.innerHTML = '';

      const count = images.length;

      images.forEach((url, i) => {
        const slide = document.createElement('div');
        slide.className = 'see-it-now-slide';
        slide.style.width = `${100 / count}%`;
        const img = document.createElement('img');
        img.src = url;
        img.alt = `Visualization ${i + 1}`;
        img.draggable = false;
        slide.appendChild(img);
        swipeTrack.appendChild(slide);
      });

      images.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'see-it-now-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `View image ${i + 1}`);
        dot.addEventListener('click', () => navigateTo(i));
        dotsContainer.appendChild(dot);
      });

      swipeTrack.style.width = `${count * 100}%`;
      updateTrackPosition(false);
    }

    function updateTrackPosition(animate = true) {
      const count = state.images.length;
      if (count === 0) return;
      const offset = -state.currentIndex * (100 / count);
      swipeTrack.style.transition = animate ? 'transform 0.3s ease-out' : 'none';
      swipeTrack.style.transform = `translateX(${offset}%)`;
    }

    function updateDots() {
      const dots = dotsContainer.querySelectorAll('.see-it-now-dot');
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === state.currentIndex);
      });
    }

    function navigateTo(index) {
      const max = state.images.length - 1;
      state.currentIndex = Math.max(0, Math.min(max, index));
      updateTrackPosition(true);
      updateDots();
    }

    function navigateBy(delta) {
      navigateTo(state.currentIndex + delta);
    }

    function handleSwipeStart(clientX) {
      state.swipeStartX = clientX;
      state.swipeCurrentX = clientX;
      state.swipeStartTime = Date.now();
      state.swiping = true;
      swipeTrack.style.transition = 'none';
    }

    function handleSwipeMove(clientX) {
      if (!state.swiping) return;
      state.swipeCurrentX = clientX;

      const containerWidth = swipeContainer.offsetWidth;
      const deltaX = state.swipeCurrentX - state.swipeStartX;
      const count = state.images.length;
      const baseOffset = -state.currentIndex * (100 / count);
      const dragOffset = (deltaX / containerWidth) * (100 / count);

      let finalOffset = baseOffset + dragOffset;
      if (state.currentIndex === 0 && deltaX > 0) {
        finalOffset = baseOffset + dragOffset * 0.3;
      } else if (state.currentIndex === count - 1 && deltaX < 0) {
        finalOffset = baseOffset + dragOffset * 0.3;
      }

      swipeTrack.style.transform = `translateX(${finalOffset}%)`;
    }

    function handleSwipeEnd() {
      if (!state.swiping) return;
      state.swiping = false;

      const containerWidth = swipeContainer.offsetWidth;
      const deltaX = state.swipeCurrentX - state.swipeStartX;
      const deltaTime = Date.now() - state.swipeStartTime;
      const velocity = Math.abs(deltaX) / deltaTime;

      const threshold = containerWidth * SWIPE_THRESHOLD;
      const isQuickFlick = velocity > SWIPE_VELOCITY_THRESHOLD;

      if (deltaX < -threshold || (deltaX < 0 && isQuickFlick)) {
        navigateBy(1);
      } else if (deltaX > threshold || (deltaX > 0 && isQuickFlick)) {
        navigateBy(-1);
      } else {
        updateTrackPosition(true);
      }
    }

    if (swipeContainer) {
      swipeContainer.addEventListener('touchstart', (e) => {
        handleSwipeStart(e.touches[0].clientX);
      }, { passive: true });

      swipeContainer.addEventListener('touchmove', (e) => {
        handleSwipeMove(e.touches[0].clientX);
      }, { passive: true });

      swipeContainer.addEventListener('touchend', handleSwipeEnd);

      swipeContainer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handleSwipeStart(e.clientX);
      });

      window.addEventListener('mousemove', (e) => {
        if (state.swiping) handleSwipeMove(e.clientX);
      });

      window.addEventListener('mouseup', handleSwipeEnd);
    }

    if (navLeft) navLeft.addEventListener('click', () => navigateBy(-1));
    if (navRight) navRight.addEventListener('click', () => navigateBy(1));

    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('hidden') && screenResult.classList.contains('active')) {
        if (e.key === 'ArrowLeft') navigateBy(-1);
        if (e.key === 'ArrowRight') navigateBy(1);
      }
    });

    // ============================================================================
    // SHARE (with proper canShare check and CORS fallback)
    // ============================================================================

    async function handleShare() {
      const currentUrl = state.images[state.currentIndex];
      if (!currentUrl) return;

      try {
        // Try native share with file (mobile)
        if (navigator.share && navigator.canShare) {
          const response = await fetch(currentUrl);
          if (!response.ok) throw new Error('Fetch failed');
          const blob = await response.blob();
          const file = new File([blob], 'see-it-now.jpg', { type: 'image/jpeg' });
          
          // Check if we can share files
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: state.productTitle || 'See It Now'
            });
            return;
          }
        }
        
        // Try native share without file (URL only)
        if (navigator.share) {
          await navigator.share({
            title: state.productTitle || 'See It Now',
            url: currentUrl
          });
          return;
        }
        
        // Fallback: direct download via link
        downloadImage(currentUrl);
        
      } catch (err) {
        if (err.name === 'AbortError') return; // User cancelled
        console.warn('[See It Now] Share failed, falling back to download:', err);
        downloadImage(currentUrl);
      }
    }

    function downloadImage(url) {
      // Open in new tab as fallback (works even without CORS)
      const a = document.createElement('a');
      a.href = url;
      a.download = 'see-it-now.jpg';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    if (shareBtn) shareBtn.addEventListener('click', handleShare);

    // ============================================================================
    // MAIN FLOW
    // ============================================================================

    function handleTriggerClick(sourceTrigger) {
      console.log('[See It Now] Trigger clicked');
      activeTrigger = sourceTrigger || activeTrigger;

      // Read product data from button
      state.productId = activeTrigger?.dataset.productId || '';
      state.productTitle = activeTrigger?.dataset.productTitle || '';
      state.productImageUrl = activeTrigger?.dataset.productImage || '';

      // Update product images
      if (entryProductImg && state.productImageUrl) {
        entryProductImg.src = state.productImageUrl;
      }
      if (thinkingProductImg && state.productImageUrl) {
        thinkingProductImg.src = state.productImageUrl;
      }

      openModal();

      if (isMobile()) {
        // Mobile: Show entry screen first (can't overlay UI on native camera)
        showScreen('entry');
      } else {
        // Desktop: Go straight to file picker
        uploadInput?.click();
      }
    }

    async function handleFileSelected(file) {
      if (!file) return;

      console.log('[See It Now] File selected:', file.name, file.size);

      showScreen('thinking');
      state.isGenerating = true;

      try {
        // Normalize image
        const normalized = await normalizeRoomImage(file);
        const normalizedFile = new File([normalized.blob], 'room.jpg', { type: 'image/jpeg' });

        // Start session (handle both camelCase and snake_case responses)
        const session = await startSession(normalizedFile.type);
        state.roomSessionId = session.sessionId || session.room_session_id;
        const uploadUrl = session.uploadUrl || session.upload_url;
        console.log('[See It Now] Session:', state.roomSessionId);

        // Upload
        await uploadImage(normalizedFile, uploadUrl);
        console.log('[See It Now] Uploaded');

        // Confirm
        await confirmRoom(state.roomSessionId);
        console.log('[See It Now] Confirmed');

        // Generate (API returns whatever number of variants it produces)
        const result = await generateImages(state.roomSessionId, state.productId);
        state.sessionId = result.session_id;

        // Extract image URLs from variants
        const imageUrls = result.variants.map(v => v.image_url);
        console.log('[See It Now] Got', imageUrls.length, 'images');

        if (imageUrls.length === 0) {
          throw new Error('No images generated');
        }

        // Populate carousel
        populateCarousel(imageUrls);

        state.isGenerating = false;
        showScreen('result');

      } catch (err) {
        console.error('[See It Now] Error:', err);
        state.isGenerating = false;
        showError(err.message || 'Something went wrong');
      }
    }

    // File input listeners
    cameraInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelected(file);
      e.target.value = '';
    });

    uploadInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        // If modal isn't open yet (desktop direct), open it
        if (modal.classList.contains('hidden')) {
          openModal();
        }
        handleFileSelected(file);
      }
      e.target.value = '';
    });

    // ============================================================================
    // ENTRY SCREEN BUTTONS (Mobile)
    // ============================================================================

    btnCamera?.addEventListener('click', () => {
      cameraInput?.click();
    });

    btnUploadFallback?.addEventListener('click', () => {
      uploadInput?.click();
    });

    btnCloseEntry?.addEventListener('click', closeModal);

    // ============================================================================
    // RESULT/ERROR NAVIGATION
    // ============================================================================

    function handleTryAgain() {
      resetState();
      if (isMobile()) {
        showScreen('entry');
      } else {
        uploadInput?.click();
      }
    }

    function handleTryAnother() {
      closeModal();
    }

    if (tryAgainBtn) tryAgainBtn.addEventListener('click', handleTryAgain);
    if (tryAnotherBtn) tryAnotherBtn.addEventListener('click', handleTryAnother);
    if (backResultBtn) backResultBtn.addEventListener('click', handleTryAgain);
    if (closeResultBtn) closeResultBtn.addEventListener('click', closeModal);
    if (errorRetryBtn) errorRetryBtn.addEventListener('click', handleTryAgain);
    if (errorCloseBtn) errorCloseBtn.addEventListener('click', closeModal);
    if (closeErrorBtn) closeErrorBtn.addEventListener('click', closeModal);

    // ============================================================================
    // TRIGGER LISTENERS
    // ============================================================================

    triggers.forEach(t => {
      t.addEventListener('click', () => handleTriggerClick(t));
    });

    console.log('[See It Now] Initialized');
    return true;
  }

  // ============================================================================
  // INITIALIZATION WITH RETRY
  // ============================================================================

  if (initSeeItNow()) return;

  let retries = 0;
  const retryTimer = setInterval(() => {
    retries += 1;
    if (initSeeItNow()) {
      clearInterval(retryTimer);
    } else if (retries >= 40) {
      clearInterval(retryTimer);
      console.log('[See It Now] Button not found after retries');
    }
  }, 250);

  document.addEventListener('shopify:section:load', () => {
    window.__SEE_IT_NOW_INITIALIZED__ = false;
    initSeeItNow();
  });
});
