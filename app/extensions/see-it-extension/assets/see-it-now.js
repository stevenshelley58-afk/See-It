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

// =============================================================================
// API Response Types - Keep in sync with backend
// Source: app/routes/app-proxy.*.ts
// =============================================================================

/**
 * Response from POST /apps/see-it/room/upload
 * @typedef {Object} RoomUploadResponse
 * @property {string} room_session_id - Unique session ID for this room upload
 * @property {string} upload_url - Signed URL for uploading the room image
 * @property {string} content_type - Expected content type for the upload
 */

/**
 * Response from POST /apps/see-it/room/confirm
 * @typedef {Object} RoomConfirmResponse
 * @property {boolean} success - Whether confirmation succeeded
 * @property {string} [message] - Optional status message
 */

/**
 * Individual variant result from the render endpoint
 * @typedef {Object} RenderVariant
 * @property {string} id - Variant ID (V01-V08)
 * @property {'success'|'failed'|'timeout'} status - Render status
 * @property {string|null} image_url - Signed URL to the rendered image (null if failed)
 * @property {number} latency_ms - Time taken to render this variant
 */

/**
 * Response from POST /apps/see-it/see-it-now/render
 * @typedef {Object} RenderResponse
 * @property {string} run_id - Unique ID for this render run
 * @property {RenderVariant[]} variants - Array of variant results
 * @property {number} duration_ms - Total render duration
 * @property {string} [request_id] - Request ID for debugging
 */

/**
 * SSE event for run started
 * @typedef {Object} RunStartedEvent
 * @property {string} run_id - Unique ID for this render run
 * @property {string} request_id - Request ID for debugging
 */

/**
 * SSE event for progress updates
 * @typedef {Object} ProgressEvent
 * @property {number} succeeded - Number of variants completed successfully
 * @property {number} failed - Number of variants that failed
 * @property {number} pending - Number of variants still processing
 */

/**
 * SSE event for individual variant completion
 * @typedef {Object} VariantEvent
 * @property {string} id - Variant ID (V01-V08)
 * @property {'success'|'failed'|'timeout'} status - Render status
 * @property {string|null} image_url - Signed URL to the rendered image
 * @property {number} latency_ms - Time taken to render this variant
 */

/**
 * Response from POST /apps/see-it/see-it-now/select
 * @typedef {Object} SelectResponse
 * @property {boolean} success - Whether selection was recorded
 * @property {string} [final_image_url] - URL to final/upscaled image if requested
 */

// =============================================================================

document.addEventListener('DOMContentLoaded', function () {
  const VERSION = '1.0.0';
  console.log('[See It Now] === LOADED ===', { VERSION, timestamp: Date.now() });

  // ============================================================================
  // ANALYTICS INITIALIZATION
  // ============================================================================

  function initAnalytics() {
    // Get monitor URL from the trigger button's data attribute
    const trigger = document.getElementById('see-it-now-trigger');
    const monitorUrl = trigger?.dataset.monitorUrl || window.SEE_IT_NOW_MONITOR_URL || '';
    const shopDomain = trigger?.dataset.shopPermanentDomain || trigger?.dataset.shopDomain || '';

    if (window.SeeItNowAnalytics) {
      window.SeeItNowAnalytics.init({
        monitorUrl,
        shopDomain,
        debug: window.location.hostname === 'localhost',
      });
      console.log('[See It Now] Analytics initialized:', { monitorUrl: monitorUrl ? 'configured' : 'not configured' });
    }
  }

  // Initialize analytics when the script loads
  initAnalytics();

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

  const TOTAL_VARIANTS = 8;

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
    variants: [],
    images: [], // derived urls for carousel
    currentIndex: 0,
    productId: '',
    productTitle: '',
    productImageUrl: '',
    isGenerating: false,
    __generationToken: 0,
    __abortController: null,
    __renderStream: null,
    __activeRequestId: null,
    __activeRunId: null,
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
    let errorMeta = $('see-it-now-error-meta');
    const errorRetryBtn = $('see-it-now-error-retry');
    const errorCloseBtn = $('see-it-now-error-close');
    const closeErrorBtn = $('see-it-now-close-error');

    const globalError = $('see-it-now-global-error');
    let a11yStatus = $('see-it-now-a11y-status');
    let thinkingProgress = $('see-it-now-thinking-progress');
    let resultStatus = $('see-it-now-result-status');

    function ensureA11yElements() {
      // Modal semantics (Liquid may not include these)
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      if (!modal.getAttribute('aria-label')) modal.setAttribute('aria-label', 'See It Now');
      if (!modal.getAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
      if (!modal.getAttribute('aria-hidden')) modal.setAttribute('aria-hidden', modal.classList.contains('hidden') ? 'true' : 'false');

      const modalContent = modal.querySelector('.see-it-now-modal-content');

      // Live status region for screen readers
      if (!a11yStatus && modalContent) {
        a11yStatus = document.createElement('div');
        a11yStatus.id = 'see-it-now-a11y-status';
        a11yStatus.className = 'see-it-now-sr-only';
        a11yStatus.setAttribute('aria-live', 'polite');
        a11yStatus.setAttribute('aria-atomic', 'true');

        const anchor = globalError && globalError.parentElement === modalContent ? globalError.nextSibling : modalContent.firstChild;
        modalContent.insertBefore(a11yStatus, anchor);
      }

      // Thinking progress text (N of 8 ready)
      if (!thinkingProgress && screenThinking) {
        const thinkingContent = screenThinking.querySelector('.see-it-now-thinking-content');
        const spinner = thinkingContent && thinkingContent.querySelector('.see-it-now-thinking-spinner');
        if (thinkingContent) {
          thinkingProgress = document.createElement('p');
          thinkingProgress.id = 'see-it-now-thinking-progress';
          thinkingProgress.className = 'see-it-now-thinking-subtitle';
          thinkingProgress.textContent = `0 of ${TOTAL_VARIANTS} ready`;
          if (spinner && spinner.nextSibling) thinkingContent.insertBefore(thinkingProgress, spinner.nextSibling);
          else thinkingContent.appendChild(thinkingProgress);
        }
      }

      // Result header status (shows N of 8 ready, non-verbose for SR since we already have aria-live)
      if (!resultStatus && screenResult) {
        const header = screenResult.querySelector('.see-it-now-header');
        if (header) {
          resultStatus = document.createElement('div');
          resultStatus.id = 'see-it-now-result-status';
          resultStatus.className = 'see-it-now-header-status';
          resultStatus.setAttribute('aria-hidden', 'true');

          if (closeResultBtn && closeResultBtn.parentElement === header) {
            header.insertBefore(resultStatus, closeResultBtn);
          } else {
            header.appendChild(resultStatus);
          }
        }
      }

      // Error meta (requestId/runId for support)
      if (!errorMeta && errorMessage && errorMessage.parentElement) {
        errorMeta = document.createElement('p');
        errorMeta.id = 'see-it-now-error-meta';
        errorMeta.className = 'see-it-now-error-meta';
        errorMeta.textContent = '';
        errorMessage.parentElement.insertBefore(errorMeta, errorMessage.nextSibling);
      }
    }

    // ============================================================================
    // PLATFORM DETECTION
    // ============================================================================

    function isMobile() {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
    }

    // Ensure dynamic a11y/UX nodes exist even if Liquid omits them.
    ensureA11yElements();

    function updateButtonIcon() {
      // Cube icon is always visible, no need to toggle based on device
      triggers.forEach(t => {
        const cubeIcon = t.querySelector('.see-it-now-icon-cube');
        if (cubeIcon) cubeIcon.style.display = 'block';
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

    let lastFocusedElement = null;

    function cancelActiveRun() {
      state.__generationToken += 1; // invalidate any in-flight async work
      if (state.__abortController) {
        try { state.__abortController.abort(); } catch (e) { }
      }
      state.__abortController = null;
      if (state.__renderStream) {
        try { state.__renderStream.close(); } catch (e) { }
        state.__renderStream = null;
      }
      state.isGenerating = false;
      state.__activeRequestId = null;
      state.__activeRunId = null;
      setStatus('');
    }

    function openModal() {
      ensureModalPortaled();
      lastFocusedElement = document.activeElement;
      lockScroll();
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');

      // Move focus into the dialog for keyboard users
      setTimeout(() => {
        if (modal.classList.contains('hidden')) return;
        const first = modal.querySelector('button:not([disabled])');
        try { (first || modal).focus(); } catch (e) { }
      }, 0);
    }

    function closeModal() {
      // End analytics session if active
      if (window.SeeItNowAnalytics && window.SeeItNowAnalytics.isActive()) {
        const status = state.images.length > 0 ? 'completed' : 'abandoned';
        window.SeeItNowAnalytics.endSession(status, {
          variantsViewed: state.images.length,
          lastViewedIndex: state.currentIndex,
        });
      }

      cancelActiveRun();
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      unlockScroll();
      stopTipRotation();
      resetState();

      // Re-enable the PDP trigger (spam prevention)
      if (activeTrigger) {
        activeTrigger.disabled = false;
        activeTrigger.removeAttribute('aria-disabled');
      }

      // Restore focus to the element that opened the modal
      const el = lastFocusedElement || activeTrigger;
      if (el && typeof el.focus === 'function') {
        try { el.focus(); } catch (e) { }
      }
    }

    function resetState() {
      state.sessionId = null;
      state.roomSessionId = null;
      state.variants = [];
      state.images = [];
      state.currentIndex = 0;
      state.isGenerating = false;
      state.swiping = false;
      setErrorMeta(null);
      setStatus('');
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

    function setStatus(text) {
      const t = text || '';
      if (thinkingProgress) thinkingProgress.textContent = t;
      if (resultStatus) resultStatus.textContent = t;
      if (a11yStatus) a11yStatus.textContent = t;
    }

    function setErrorMeta(meta) {
      if (!errorMeta) return;
      const requestId = meta?.requestId || '';
      const runId = meta?.runId || '';
      if (!requestId && !runId) {
        errorMeta.textContent = '';
        return;
      }
      const parts = [];
      if (requestId) parts.push(`requestId: ${requestId}`);
      if (runId) parts.push(`runId: ${runId}`);
      errorMeta.textContent = parts.join(' · ');
    }

    function extractMetaFromPayload(payload) {
      if (!payload || typeof payload !== 'object') return null;
      const requestId = payload.requestId || payload.request_id || null;
      const runId = payload.runId || payload.run_id || null;
      if (!requestId && !runId) return null;
      return { requestId, runId };
    }

    function showError(msg, meta) {
      console.error('[See It Now] ERROR:', msg, meta || {});
      if (errorMessage) {
        errorMessage.textContent = msg || 'We couldn\'t create your visualization';
      }
      setErrorMeta(meta);
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
        throw new Error(buildHttpErrorMessage({ name: 'Start session', res, payload: data }));
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

    async function recordFinalSelection({ variantId, imageUrl, upscale }) {
      if (!state.sessionId || !state.roomSessionId) return null;
      if (!variantId || !imageUrl) return null;

      try {
        const res = await fetch('/apps/see-it/see-it-now/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.sessionId,
            room_session_id: state.roomSessionId,
            selected_variant_id: variantId,
            selected_image_url: imageUrl,
            upscale: !!upscale,
            product_id: state.productId || undefined,
          }),
        });

        const { data } = await readJsonOrText(res);
        if (!res.ok) {
          console.warn('[See It Now] Selection endpoint failed:', data);
          return null;
        }
        return data;
      } catch (err) {
        console.warn('[See It Now] Selection endpoint error:', err);
        return null;
      }
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
      if (modal.classList.contains('hidden')) return;

      // ESC closes modal
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }

      // Basic focus trap (Tab cycles within modal)
      if (e.key === 'Tab') {
        const focusables = Array.from(
          modal.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el && el.getClientRects && el.getClientRects().length > 0);

        if (focusables.length > 0) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement;

          if (e.shiftKey) {
            if (active === first || !modal.contains(active)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (active === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      }

      // Arrow navigation (result screen only)
      if (screenResult.classList.contains('active')) {
        if (e.key === 'ArrowLeft') navigateBy(-1);
        if (e.key === 'ArrowRight') navigateBy(1);
      }
    });

    // ============================================================================
    // SHARE (with proper canShare check and CORS fallback)
    // ============================================================================

    async function handleShare() {
      const currentVariant = state.variants[state.currentIndex];
      const currentUrl = currentVariant?.image_url || state.images[state.currentIndex];
      if (!currentUrl) return;

      // Track share action (this implies the user "selected" this variant as their favorite)
      if (window.SeeItNowAnalytics) {
        window.SeeItNowAnalytics.trackEvent('variant_selected', {
          sessionId: state.sessionId,
          selectedVariantIndex: state.currentIndex,
          action: 'share',
        });
      }

      try {
        // Best-effort: record the user's selection (and optionally upscale for a "final" image)
        // If it succeeds, swap the image URL to the returned final_image_url for sharing.
        if (currentVariant?.id) {
          const selection = await recordFinalSelection({
            variantId: currentVariant.id,
            imageUrl: currentUrl,
            upscale: true,
          });

          const finalUrl = selection?.final_image_url;
          if (finalUrl && typeof finalUrl === 'string') {
            // Update state so the carousel also uses the final URL
            state.variants[state.currentIndex] = { ...currentVariant, image_url: finalUrl };
            state.images[state.currentIndex] = finalUrl;
          }
        }

        const shareUrl = state.images[state.currentIndex] || currentUrl;

        // Try native share with file (mobile)
        if (navigator.share && navigator.canShare) {
          const response = await fetch(shareUrl);
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
            url: shareUrl
          });
          return;
        }
        
        // Fallback: direct download via link
        downloadImage(shareUrl);
        
      } catch (err) {
        if (err.name === 'AbortError') return; // User cancelled
        console.warn('[See It Now] Share failed, falling back to download:', err);
        downloadImage(state.images[state.currentIndex] || currentUrl);
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
      const shopDomain = activeTrigger?.dataset.shopPermanentDomain || activeTrigger?.dataset.shopDomain || '';

      // Start analytics session
      if (window.SeeItNowAnalytics) {
        window.SeeItNowAnalytics.startSession(state.productId, state.productTitle, shopDomain);
      }

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
      cancelActiveRun();
      state.isGenerating = true;
      setErrorMeta(null);
      setStatus(`0 of ${TOTAL_VARIANTS} ready`);
      state.__abortController = new AbortController();
      const runToken = state.__generationToken;
      const signal = state.__abortController.signal;

      const assertActive = () => {
        if (runToken !== state.__generationToken) {
          throw new DOMException('Aborted', 'AbortError');
        }
      };

      try {
        // Normalize image
        const normalized = await normalizeRoomImage(file);
        assertActive();
        const normalizedFile = new File([normalized.blob], 'room.jpg', { type: 'image/jpeg' });

        // Start session (handle both camelCase and snake_case responses)
        const session = await startSession(normalizedFile.type, signal);
        assertActive();
        state.roomSessionId = session.sessionId || session.room_session_id;
        const uploadUrl = session.uploadUrl || session.upload_url;
        console.log('[See It Now] Session:', state.roomSessionId);

        // Upload
        await uploadImage(normalizedFile, uploadUrl, signal);
        assertActive();
        console.log('[See It Now] Uploaded');

        // Track room upload
        if (window.SeeItNowAnalytics) {
          window.SeeItNowAnalytics.trackEvent('room_uploaded', {
            roomSessionId: state.roomSessionId,
            imageSize: `${normalized.width}x${normalized.height}`,
          });
        }

        // Confirm
        await confirmRoom(state.roomSessionId, signal);
        assertActive();
        console.log('[See It Now] Confirmed');

        // Generate (prefer streaming so we can show images as they complete)
        let streamHandle = null;
        const streamedVariantIds = [];
        let firstImageAnnounced = false;

        try {
          streamHandle = startRenderStream(state.roomSessionId, state.productId, runToken, {
            onRunStarted: (data) => {
              state.__activeRunId = data.run_id || null;
            },
            onProgress: (data) => {
              const succeeded = typeof data?.succeeded === 'number' ? data.succeeded : 0;
              const n = Math.max(0, Math.min(TOTAL_VARIANTS, succeeded));
              setStatus(`${n} of ${TOTAL_VARIANTS} ready`);
            },
            onFirstImage: () => {
              if (firstImageAnnounced) return;
              firstImageAnnounced = true;
              if (a11yStatus) a11yStatus.textContent = 'First image ready';
            },
            onVariant: (data) => {
              if (!data || data.status !== 'success' || !data.image_url) return;
              streamedVariantIds.push(data.id);
              state.variants.push({ id: data.id, image_url: data.image_url });
              appendCarouselImage(data.image_url);

              if (state.images.length === 1) {
                showScreen('result');
              }
              setStatus(`${state.images.length} of ${TOTAL_VARIANTS} ready`);
            },
          });

          state.__renderStream = streamHandle.es;
          const complete = await streamHandle.done; // { run_id, status, duration_ms, success_variant_ids }
          assertActive();

          if (!state.images || state.images.length === 0) {
            throw new Error('No images generated');
          }

          if (window.SeeItNowAnalytics) {
            window.SeeItNowAnalytics.trackEvent('variants_generated', {
              sessionId: complete.run_id || state.__activeRunId,
              roomSessionId: state.roomSessionId,
              variantCount: state.images.length,
              variantIds: (complete.success_variant_ids || streamedVariantIds || []),
              durationMs: complete.duration_ms,
              transport: 'sse',
            });
          }
        } catch (streamErr) {
          // If server emitted a structured error, show it and stop (no POST retry).
          if (streamErr && streamErr.name === 'SeeItNowStreamError') {
            const meta = extractMetaFromPayload(streamErr.payload);
            showError(streamErr.message || 'Something went wrong', meta);
            state.isGenerating = false;
            return;
          }

          console.warn('[See It Now] Stream failed, falling back to POST render:', streamErr);
          try { streamHandle?.es?.close(); } catch (e) { }
          state.__renderStream = null;

          const result = await generateImages(state.roomSessionId, state.productId, signal);
          assertActive();
          state.__activeRunId = result.run_id || result.runId || null;

          state.variants = Array.isArray(result.variants) ? result.variants : [];
          const imageUrls = state.variants.map(v => v.image_url);
          const variantIds = state.variants.map(v => v.id);

          if (imageUrls.length === 0) {
            throw new Error('No images generated');
          }

          if (window.SeeItNowAnalytics) {
            window.SeeItNowAnalytics.trackEvent('variants_generated', {
              sessionId: state.__activeRunId,
              roomSessionId: state.roomSessionId,
              variantCount: imageUrls.length,
              variantIds,
              durationMs: result.duration_ms,
              transport: 'post',
            });
          }

          populateCarousel(imageUrls);
          showScreen('result');
          setStatus(`${imageUrls.length} of ${TOTAL_VARIANTS} ready`);
        }

        state.isGenerating = false;

      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error('[See It Now] Error:', err);
        state.isGenerating = false;
        const meta = extractMetaFromPayload(err?.payload);

        // Track error
        if (window.SeeItNowAnalytics) {
          window.SeeItNowAnalytics.trackError(
            'generation_failed',
            err.message || 'Something went wrong',
            { roomSessionId: state.roomSessionId }
          );
        }

        showError(err.message || 'Something went wrong', meta);
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
      cancelActiveRun();
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
