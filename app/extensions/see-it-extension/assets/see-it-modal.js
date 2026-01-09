// Document-level event delegation (ALWAYS active, runs immediately when script loads)
// This is the most reliable method - works regardless of when script loads or elements appear
// MUST be outside IIFE to ensure it always runs
(function() {
    'use strict';
    document.addEventListener('click', function(e) {
        const target = e.target;
        const trigger = target && (target.id === 'see-it-trigger' || target.closest('#see-it-trigger'));
        
        if (trigger) {
            console.log('[See It] 🔵 DOCUMENT DELEGATION CLICK FIRED');
            e.preventDefault();
            e.stopPropagation();
            
            const modal = document.getElementById('see-it-modal');
            if (modal) {
                // Ensure modal is portaled to body
                if (modal.parentElement !== document.body) {
                    document.body.appendChild(modal);
                }
                
                modal.classList.remove('hidden');
                modal.style.display = 'block';
                modal.style.position = 'fixed';
                modal.style.top = '0';
                modal.style.left = '0';
                modal.style.right = '0';
                modal.style.bottom = '0';
                modal.style.width = '100%';
                modal.style.height = '100%';
                modal.style.zIndex = '999999';
                modal.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
                
                // Lock scroll
                const scrollY = window.scrollY;
                document.body.style.position = 'fixed';
                document.body.style.width = '100%';
                document.body.style.top = `-${scrollY}px`;
                
                console.log('[See It] Document delegation: Modal opened');
            } else {
                console.error('[See It] Document delegation: Modal not found');
            }
        }
    }, true);
})();

(function() {
    const VERSION = '1.0.29'; // Gemini Files API pre-upload for faster renders
    
    // Function to initialize - runs when DOM is ready
    function initSeeIt() {
        console.log('[See It] === SEE IT MODAL LOADED ===', { VERSION, timestamp: Date.now(), readyState: document.readyState });

        // --- DOM Elements ---
        const $ = id => document.getElementById(id);

    // Helper: check if element is visible (has non-zero dimensions)
    const isVisible = (el) => el && el.offsetWidth > 0 && el.offsetHeight > 0;

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
    
    // Helper to wait for elements (Shopify theme extensions may inject after DOMContentLoaded)
    function waitForElements(callback, maxRetries = 20) {
        const $ = id => document.getElementById(id);
        let retries = 0;
        const check = () => {
            const trigger = $('see-it-trigger');
            const modal = $('see-it-modal');
            
            if (trigger && modal) {
                console.log('[See It] Elements found' + (retries > 0 ? ` after ${retries} retries` : ' immediately'));
                callback(trigger, modal);
            } else if (retries < maxRetries) {
                retries++;
                setTimeout(check, 100);
            } else {
                console.log('[See It] ⚠️ Button not rendered after', retries, 'retries');
                console.log('[See It] Debug - trigger:', trigger, 'modal:', modal);
                console.log('[See It] All see-it elements:', Array.from(document.querySelectorAll('[id*="see-it"]')).map(el => ({
                    id: el.id,
                    tagName: el.tagName,
                    visible: el.offsetWidth > 0 && el.offsetHeight > 0
                })));
            }
        };
        check();
    }
    
    // Global fallback: also try to attach listener after a delay (in case elements appear very late)
    setTimeout(() => {
        const fallbackTrigger = document.getElementById('see-it-trigger');
        const fallbackModal = document.getElementById('see-it-modal');
        console.log('[See It] 🔄 Fallback check (3s):', {
            trigger: !!fallbackTrigger,
            modal: !!fallbackModal,
            triggerVisible: fallbackTrigger ? (fallbackTrigger.offsetWidth > 0 && fallbackTrigger.offsetHeight > 0) : false
        });
        
        if (fallbackTrigger && !fallbackTrigger.dataset.listenerAttached) {
            console.log('[See It] 🔄 Fallback: Found trigger button late, attaching listener');
            fallbackTrigger.dataset.listenerAttached = 'true';
            
            const fallbackHandler = function(e) {
                console.log('[See It] 🔵 FALLBACK CLICK HANDLER FIRED');
                e.preventDefault();
                e.stopPropagation();
                // Try to find modal and open it
                const modal = document.getElementById('see-it-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    modal.style.display = 'block';
                    modal.style.position = 'fixed';
                    modal.style.zIndex = '999999';
                    console.log('[See It] Fallback: Modal opened');
                } else {
                    console.error('[See It] Fallback: Modal not found');
                }
            };
            
            fallbackTrigger.addEventListener('click', fallbackHandler);
            fallbackTrigger.onclick = fallbackHandler;
        }
    }, 3000);
    
    // Initialize when elements are ready
    waitForElements((trigger, modal) => {
        console.log('[See It] ✅ Initializing modal with elements:', {
            triggerId: trigger.id,
            modalId: modal.id,
            triggerVisible: trigger.offsetWidth > 0 && trigger.offsetHeight > 0
        });
        
        const triggerWidget = trigger?.closest('.see-it-widget-hook');

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
    const screenLoading = $('see-it-screen-loading');

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
    const brushSlider = $('see-it-brush-slider');

    // Position screen elements
    const btnBackPosition = $('see-it-back-position');
    const roomImage = $('see-it-room-image');
    const btnGenerate = $('see-it-generate');
    const positionContainer = $('see-it-position-container');
    const productOverlay = $('see-it-product-overlay');
    const productImage = $('see-it-product-image');
    const positionHint = $('see-it-position-hint');

    // Result screen elements
    const btnCloseResult = $('see-it-close-result');
    const btnBackResult = $('see-it-back-result');
    const resultImage = $('see-it-result-image');
    const btnShare = $('see-it-share');
    const btnTryAgain = $('see-it-try-again');
    const btnTryAnother = $('see-it-try-another');
    const errorDiv = $('see-it-global-error');

    // Email capture elements
    const emailForm = $('see-it-email-form');
    const emailInput = $('see-it-email-input');
    const emailSubmit = $('see-it-email-submit');
    const emailFormWrap = $('see-it-email-form-wrap');
    const emailSuccess = $('see-it-email-success');

    // Swiper elements
    const swiper = $('see-it-swiper');
    const swiperClose = $('see-it-swiper-close');
    const swiperCard = $('see-it-swiper-card');
    const swiperImg = $('see-it-swiper-img');
    const swiperName = $('see-it-swiper-name');
    const swiperCollection = $('see-it-swiper-collection');
    const swiperPrev = $('see-it-swiper-prev');
    const swiperNext = $('see-it-swiper-next');
    const swiperSkipLeft = $('see-it-swiper-skip-left');
    const swiperSkipRight = $('see-it-swiper-skip-right');
    const swiperSelect = $('see-it-swiper-select');

    // DEBUG: Log which critical elements exist
    console.log('[See It] Element check:', {
        btnRemove: !!btnRemove,
        maskCanvas: !!maskCanvas,
        roomPreview: !!roomPreview,
        errorDiv: !!errorDiv
    });

    // --- Analytics Integration ---
    let analytics = null;
    const shopDomain = window.Shopify?.shop || window.location.hostname || 'unknown';
    const analyticsEndpoint = 'https://see-it-monitor.vercel.app/api/analytics/events';
    
    // Simple analytics wrapper (fail silently - never break the app)
    const initAnalytics = () => {
        try {
            // Try to use the full SDK if available (from app/app/utils/analytics.ts)
            // NOTE: This file is shipped directly to browsers as plain JS (no TS transpile),
            // so we must not use TypeScript-only casting syntax.
            const SeeItAnalyticsCtor = (typeof window !== 'undefined') ? window['SeeItAnalytics'] : null;
            if (SeeItAnalyticsCtor) {
                analytics = new SeeItAnalyticsCtor({
                    shopDomain,
                    endpoint: analyticsEndpoint,
                    debug: false,
                });
            } else {
                // Fallback: simple event tracker
                analytics = {
                    startSession: (productId, productTitle, productPrice) => {
                        try {
                            const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
                            fetch(analyticsEndpoint, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    events: [{
                                        type: 'session_started',
                                        sessionId,
                                        shopDomain,
                                        data: { productId, productTitle, productPrice },
                                        timestamp: new Date().toISOString(),
                                    }],
                                }),
                                keepalive: true,
                            }).catch(() => {}); // Fail silently
                            return sessionId;
                        } catch (err) {
                            return `sess_${Date.now()}`;
                        }
                    },
                    trackStep: (step, status, metadata) => {
                        try {
                            fetch(analyticsEndpoint, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    events: [{
                                        type: 'step_update',
                                        sessionId: state.sessionId,
                                        shopDomain,
                                        data: { step, status, ...metadata },
                                        timestamp: new Date().toISOString(),
                                    }],
                                }),
                                keepalive: true,
                            }).catch(() => {});
                        } catch (err) {}
                    },
                    endSession: (status, metadata) => {
                        try {
                            fetch(analyticsEndpoint, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    events: [{
                                        type: 'session_ended',
                                        sessionId: state.sessionId,
                                        shopDomain,
                                        data: { status, ...metadata },
                                        timestamp: new Date().toISOString(),
                                    }],
                                }),
                                keepalive: true,
                            }).catch(() => {});
                        } catch (err) {}
                    },
                    trackError: (errorCode, errorMessage, severity) => {
                        try {
                            fetch(analyticsEndpoint, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    events: [{
                                        type: 'error',
                                        sessionId: state.sessionId,
                                        shopDomain,
                                        data: { errorCode, errorMessage, severity },
                                        timestamp: new Date().toISOString(),
                                    }],
                                }),
                                keepalive: true,
                            }).catch(() => {});
                        } catch (err) {}
                    },
                    trackARButtonClick: () => {
                        try {
                            fetch(analyticsEndpoint, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    events: [{
                                        type: 'ar_button_click',
                                        shopDomain,
                                        data: {
                                            productId: state.productId,
                                            productTitle: state.productTitle,
                                            productPrice: state.productPrice,
                                        },
                                        timestamp: new Date().toISOString(),
                                    }],
                                }),
                                keepalive: true,
                            }).catch(() => {});
                        } catch (err) {}
                    },
                };
            }
        } catch (err) {
            console.warn('[See It] Analytics initialization failed:', err);
            analytics = null; // Fail gracefully
        }
    };
    
    initAnalytics();

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
        x: 0.5, // Normalized position (0-1, center of product)
        y: 0.5,
        productWidth: 150, // Pixels
        productHeight: 150,
        productNaturalWidth: 0,
        productNaturalHeight: 0,
        isUploading: false,
        isCleaningUp: false,
        uploadComplete: false,
        uploadPromise: null,  // Background upload promise
        uploadError: null,    // Error from background upload
        shopperToken: localStorage.getItem('see_it_shopper_token'),
        currentScreen: 'entry',
        normalizedWidth: 0,
        normalizedHeight: 0,
        lastRenderJobId: null,
        lastResultUrl: null,
        collectionProducts: [],
        collectionInfo: null,
        swiperIndex: 0,
        // Preloaded prepared product image
        preparedProductImageUrl: null,
        preparedProductImagePreloaded: null  // Image object for instant display
    };

    // Canvas state - DUAL CANVAS ARCHITECTURE (like cleanup-ai reference)
    // Visual canvas (maskCanvas) shows cyan highlights at UI scale
    // Hidden mask canvas (hiddenMaskCanvas) draws pure white at NATIVE resolution
    let ctx = null;           // Visual canvas context
    let maskCtx = null;       // Hidden mask canvas context (native resolution)
    let hiddenMaskCanvas = null; // Hidden canvas element for API mask
    let isDrawing = false;
    let strokes = [];         // Array of {points: [], brushSize: number}
    let currentStroke = [];
    let brushSize = 50;       // Current brush size in UI pixels
    let hasErased = false;
    let canvasListenersAttached = false; // PREVENT DUPLICATE LISTENERS
    const BRUSH_COLOR = 'rgba(6, 182, 212, 0.6)'; // Cyan highlighter (matches cleanup-ai)

    // Loading screen messages - rotate during generation
    const LOADING_MESSAGES = [
        "I make things look pretty",
        "I don't always get size correct",
        "Doing very technical things...",
        "Where did I put the tape measure...",
        "Almost there...",
        "Humans are still useful for checking dimensions"
    ];

    const getActiveRoomUrl = () => state.cleanedRoomImageUrl || state.originalRoomImageUrl || state.localImageDataUrl;

    // --- Screen Navigation ---
    const showScreen = (screenName) => {
        const screens = {
            entry: screenEntry,
            prepare: screenPrepare,
            position: screenPosition,
            loading: screenLoading,
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

    // --- Canvas Drawing (DUAL CANVAS ARCHITECTURE) ---
    // Visual canvas: sized to fit container, shows cyan highlights
    // Hidden mask canvas: native resolution, draws pure white for API
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

        // Use stored normalized dimensions (native resolution)
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

        // Calculate UI dimensions (fit within container)
        const container = maskCanvas.parentElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const maxWidth = containerRect.width;
        const maxHeight = containerRect.height;

        // Calculate scale to fit
        let scale = maxWidth / natW;
        if (natH * scale > maxHeight) {
            scale = maxHeight / natH;
        }

        const uiW = Math.floor(natW * scale);
        const uiH = Math.floor(natH * scale);

        // VISUAL CANVAS: sized for smooth UI display
        maskCanvas.width = uiW;
        maskCanvas.height = uiH;

        // Position canvas CSS to center in container
        const offsetX = (maxWidth - uiW) / 2;
        const offsetY = (maxHeight - uiH) / 2;
        maskCanvas.style.position = 'absolute';
        maskCanvas.style.left = offsetX + 'px';
        maskCanvas.style.top = offsetY + 'px';
        maskCanvas.style.width = uiW + 'px';
        maskCanvas.style.height = uiH + 'px';

        // HIDDEN MASK CANVAS: native resolution for API
        if (!hiddenMaskCanvas) {
            hiddenMaskCanvas = document.createElement('canvas');
            hiddenMaskCanvas.style.display = 'none';
        }
        hiddenMaskCanvas.width = natW;
        hiddenMaskCanvas.height = natH;

        // Get contexts
        ctx = maskCanvas.getContext('2d');
        maskCtx = hiddenMaskCanvas.getContext('2d');

        if (!ctx || !maskCtx) {
            console.error('[See It] initCanvas: failed to get 2d context!');
            return;
        }

        // Initialize visual canvas context (cyan highlighter)
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = BRUSH_COLOR;
        ctx.lineWidth = brushSize;

        // Initialize hidden mask canvas context (pure white on black)
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, natW, natH);
        maskCtx.strokeStyle = 'white';
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';

        // Calculate scale factor for brush on mask canvas
        const maskScale = natW / uiW;
        maskCtx.lineWidth = brushSize * maskScale;

        // Clear visual canvas (keep it transparent - roomPreview img shows through)
        ctx.clearRect(0, 0, uiW, uiH);

        console.log('[See It] Dual canvas initialized:', {
            uiCanvas: `${uiW}x${uiH}`,
            maskCanvas: `${natW}x${natH}`,
            scale: maskScale.toFixed(3),
            brushSize: brushSize
        });
    };

    // Position canvas CSS to match where image renders within container
    const positionCanvasToMatchImage = () => {
        if (!maskCanvas || !roomPreview) return;

        const container = maskCanvas.parentElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const imgNatW = roomPreview.naturalWidth || state.normalizedWidth;
        const imgNatH = roomPreview.naturalHeight || state.normalizedHeight;

        if (!imgNatW || !imgNatH || !containerRect.width || !containerRect.height) return;

        // Calculate where image renders (object-fit: contain)
        const containerAspect = containerRect.width / containerRect.height;
        const imageAspect = imgNatW / imgNatH;

        let imgRenderW, imgRenderH, imgOffsetX, imgOffsetY;

        if (imageAspect > containerAspect) {
            // Image wider than container - letterboxed top/bottom
            imgRenderW = containerRect.width;
            imgRenderH = containerRect.width / imageAspect;
            imgOffsetX = 0;
            imgOffsetY = (containerRect.height - imgRenderH) / 2;
        } else {
            // Image taller than container - pillarboxed left/right
            imgRenderH = containerRect.height;
            imgRenderW = containerRect.height * imageAspect;
            imgOffsetX = (containerRect.width - imgRenderW) / 2;
            imgOffsetY = 0;
        }

        // Position canvas to match image render area
        maskCanvas.style.position = 'absolute';
        maskCanvas.style.left = imgOffsetX + 'px';
        maskCanvas.style.top = imgOffsetY + 'px';
        maskCanvas.style.width = imgRenderW + 'px';
        maskCanvas.style.height = imgRenderH + 'px';
        maskCanvas.style.inset = 'auto'; // Remove inset: 0

        console.log('[See It] Canvas positioned:', {
            offset: `${imgOffsetX}px, ${imgOffsetY}px`,
            size: `${imgRenderW}x${imgRenderH}`
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

        // Position relative to canvas element (now positioned to match image)
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
        if (!ctx || !maskCtx) {
            console.warn('[See It] startDraw: contexts not initialized, attempting init...');
            initCanvas();
            if (!ctx || !maskCtx) {
                console.error('[See It] startDraw: contexts still null after init!');
                showError('Canvas not ready. Please try again.');
                return;
            }
        }

        e.preventDefault();
        e.stopPropagation();

        isDrawing = true;
        currentStroke = [];

        const pos = getCanvasPos(e);
        if (!pos.valid) {
            isDrawing = false;
            return;
        }

        currentStroke.push(pos);

        // Draw on visual canvas (cyan highlight)
        ctx.lineWidth = brushSize;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + 0.1, pos.y + 0.1);
        ctx.stroke();

        // Draw on hidden mask canvas (white at native resolution)
        const scale = state.normalizedWidth / maskCanvas.width;
        maskCtx.lineWidth = brushSize * scale;
        maskCtx.beginPath();
        maskCtx.moveTo(pos.x * scale, pos.y * scale);
        maskCtx.lineTo(pos.x * scale + 0.1, pos.y * scale + 0.1);
        maskCtx.stroke();
    };

    const draw = (e) => {
        if (!isDrawing || !ctx || !maskCtx) return;
        e.preventDefault();
        e.stopPropagation();

        const pos = getCanvasPos(e);
        if (!pos.valid) return;

        currentStroke.push(pos);

        // Draw on visual canvas
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);

        // Draw on hidden mask canvas
        const scale = state.normalizedWidth / maskCanvas.width;
        maskCtx.lineTo(pos.x * scale, pos.y * scale);
        maskCtx.stroke();
        maskCtx.beginPath();
        maskCtx.moveTo(pos.x * scale, pos.y * scale);
    };

    const stopDraw = (e) => {
        if (!isDrawing) return;
        isDrawing = false;

        if (currentStroke.length > 0) {
            // Store stroke with its brush size (for undo/redraw)
            strokes.push({ points: [...currentStroke], brushSize: brushSize });
            console.log('[See It] Stroke recorded:', {
                points: currentStroke.length,
                totalStrokes: strokes.length,
                brushSize: brushSize
            });
        }
        currentStroke = [];
        ctx?.beginPath();
        maskCtx?.beginPath();
        updatePaintButtons();
    };

    // Redraw all strokes on both canvases (for undo)
    const redrawStrokes = () => {
        if (!ctx || !maskCanvas || !maskCtx || !hiddenMaskCanvas) return;

        const uiW = maskCanvas.width;
        const uiH = maskCanvas.height;
        const natW = hiddenMaskCanvas.width;
        const natH = hiddenMaskCanvas.height;
        const scale = natW / uiW;

        // Clear visual canvas (keep transparent - roomPreview img shows through)
        ctx.clearRect(0, 0, uiW, uiH);

        // Clear and reset hidden mask canvas
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, natW, natH);
        maskCtx.strokeStyle = 'white';
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';

        // Redraw each stroke with its original brush size
        strokes.forEach(stroke => {
            if (!stroke.points || stroke.points.length === 0) return;

            const strokeBrushSize = stroke.brushSize || brushSize;

            // Visual canvas (cyan highlight)
            ctx.strokeStyle = BRUSH_COLOR;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = strokeBrushSize;
            ctx.beginPath();
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            stroke.points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();

            // Hidden mask canvas (white at native resolution)
            maskCtx.lineWidth = strokeBrushSize * scale;
            maskCtx.beginPath();
            maskCtx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
            stroke.points.forEach(p => maskCtx.lineTo(p.x * scale, p.y * scale));
            maskCtx.stroke();
        });
    };

    const updatePaintButtons = () => {
        const hasStrokes = strokes.length > 0;
        // Enable erase if has strokes and not currently cleaning (upload happens silently)
        const canErase = hasStrokes && !state.isCleaningUp;

        if (btnUndo) {
            btnUndo.disabled = !hasStrokes;
            btnUndo.style.opacity = hasStrokes ? '1' : '0.5';
        }

        if (btnRemove) {
            btnRemove.disabled = !canErase;
            btnRemove.style.opacity = canErase ? '1' : '0.5';

            // Clean button text - no upload status shown to user
            if (state.isCleaningUp) {
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

    // Brush size slider
    if (brushSlider) {
        brushSlider.addEventListener('input', (e) => {
            brushSize = parseInt(e.target.value);
            if (ctx) ctx.lineWidth = brushSize;
            if (maskCtx && state.normalizedWidth && maskCanvas) {
                const scale = state.normalizedWidth / maskCanvas.width;
                maskCtx.lineWidth = brushSize * scale;
            }
        });
    }

    // Generate mask from hidden mask canvas (already at native resolution)
    const generateMask = () => {
        if (!hiddenMaskCanvas) {
            console.error('[See It] generateMask: no hidden mask canvas');
            return null;
        }

        const w = hiddenMaskCanvas.width;
        const h = hiddenMaskCanvas.height;

        if (w === 0 || h === 0) {
            console.error('[See It] generateMask: canvas has zero dimensions');
            return null;
        }

        if (strokes.length === 0) {
            console.error('[See It] generateMask: no strokes');
            return null;
        }

        // The hidden mask canvas already has the mask drawn in real-time
        // Black background with white strokes at native resolution
        const dataUrl = hiddenMaskCanvas.toDataURL('image/png');

        console.log('[See It] Mask generated from hidden canvas:', {
            dimensions: `${w}x${h}`,
            normalizedDimensions: `${state.normalizedWidth}x${state.normalizedHeight}`,
            strokes: strokes.length,
            dataUrlLength: dataUrl.length,
            match: w === state.normalizedWidth && h === state.normalizedHeight
        });

        return dataUrl;
    };

    // --- Product Positioning ---
    let positionListenersAttached = false;
    let isDragging = false;
    let isResizing = false;
    let resizeHandle = null;
    let dragStart = { x: 0, y: 0 };
    let productStart = { x: 0, y: 0, width: 0, height: 0 };
    let pinchStartDistance = 0;
    let pinchStartScale = 1;

    // Fetch prepared product image (background removed)
    const fetchPreparedProductImage = async (productId) => {
        try {
            const res = await fetch(`/apps/see-it/product/prepared?product_id=${productId}`);
            if (!res.ok) return null;
            const data = await res.json();
            if (data.prepared_image_url) {
                console.log('[See It] Got prepared image:', data.prepared_image_url.substring(0, 80));
                return data.prepared_image_url;
            }
            return null;
        } catch (e) {
            console.error('[See It] Failed to fetch prepared image:', e);
            return null;
        }
    };

    const initPosition = async () => {
        console.log('[See It] initPosition called');

        const url = getActiveRoomUrl();
        if (roomImage) roomImage.src = url;

        // Use preloaded prepared image if available, otherwise fetch (or fallback to raw)
        let imageToUse = state.productImageUrl;
        let usingPreloaded = false;

        if (state.preparedProductImagePreloaded) {
            // Use the preloaded image - instant display, no placeholder!
            imageToUse = state.preparedProductImageUrl;
            usingPreloaded = true;
            console.log('[See It] Using PRELOADED prepared product image');
        } else if (state.preparedProductImageUrl) {
            // URL is ready but image not yet loaded - still faster than fetching
            imageToUse = state.preparedProductImageUrl;
            console.log('[See It] Using prepared URL (not yet preloaded)');
        } else {
            // Fallback: fetch now (this was the old slow path)
            console.log('[See It] No preloaded image, fetching prepared product image...');
            const preparedUrl = await fetchPreparedProductImage(state.productId);
            if (preparedUrl) {
                imageToUse = preparedUrl;
                state.preparedProductImageUrl = preparedUrl;
            }
        }

        // Set product image
        if (productImage) {
            productImage.src = imageToUse;
            console.log('[See It] Product image set:', usingPreloaded ? 'PRELOADED' : (state.preparedProductImageUrl ? 'PREPARED' : 'RAW'), imageToUse.substring(0, 80));

            // If preloaded, we can set dimensions immediately
            if (usingPreloaded && state.preparedProductImagePreloaded) {
                state.productNaturalWidth = state.preparedProductImagePreloaded.naturalWidth;
                state.productNaturalHeight = state.preparedProductImagePreloaded.naturalHeight;
                console.log('[See It] Product natural size (from preload):', state.productNaturalWidth, 'x', state.productNaturalHeight);
                setInitialProductSize();
            } else {
                // Wait for product image to load to get dimensions
                productImage.onload = () => {
                    state.productNaturalWidth = productImage.naturalWidth;
                    state.productNaturalHeight = productImage.naturalHeight;
                    console.log('[See It] Product natural size:', state.productNaturalWidth, 'x', state.productNaturalHeight);
                    setInitialProductSize();
                };
            }
        }

        // Reset position to center
        state.x = 0.5;
        state.y = 0.5;
        state.scale = 1.0;

        // Show the overlay
        if (productOverlay) {
            productOverlay.style.display = 'block';
        }

        // Attach interaction listeners (only once)
        setupPositionListeners();

        // Initial update
        updateProductOverlay();
    };

    // Helper to set initial product size - larger on mobile for easier interaction
    const setInitialProductSize = () => {
        if (!positionContainer) return;

        const containerRect = positionContainer.getBoundingClientRect();
        const isMobile = containerRect.width < 768;

        // Mobile: 40% of container width (easier to drag/pinch)
        // Desktop: 25% of container width
        const sizePercent = isMobile ? 0.40 : 0.25;
        const maxWidth = isMobile ? 280 : 200;

        const targetWidth = Math.min(containerRect.width * sizePercent, maxWidth);
        const aspectRatio = state.productNaturalHeight / state.productNaturalWidth;
        state.productWidth = targetWidth;
        state.productHeight = targetWidth * aspectRatio;
        state.scale = 1.0;

        updateProductOverlay();
        console.log('[See It] Initial product size set:', {
            isMobile,
            sizePercent: sizePercent * 100 + '%',
            width: state.productWidth,
            height: state.productHeight
        });
    };

    const updateProductOverlay = () => {
        if (!productOverlay || !positionContainer) return;

        const containerRect = positionContainer.getBoundingClientRect();
        const scaledWidth = state.productWidth * state.scale;
        const scaledHeight = state.productHeight * state.scale;

        // Calculate pixel position from normalized coordinates
        const pixelX = state.x * containerRect.width - (scaledWidth / 2);
        const pixelY = state.y * containerRect.height - (scaledHeight / 2);

        productOverlay.style.width = scaledWidth + 'px';
        productOverlay.style.height = scaledHeight + 'px';
        productOverlay.style.left = pixelX + 'px';
        productOverlay.style.top = pixelY + 'px';
        productOverlay.style.transform = 'none'; // Remove the CSS centering transform
    };

    const getEventPos = (e) => {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    };

    const getPinchDistance = (e) => {
        if (e.touches && e.touches.length >= 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }
        return 0;
    };

    const handleDragStart = (e) => {
        if (isResizing) return;

        // Check if clicking on a resize handle
        if (e.target.classList.contains('see-it-resize-handle')) {
            return handleResizeStart(e);
        }

        e.preventDefault();
        e.stopPropagation();

        // Hide the position hint on first interaction
        positionHint?.classList.add('see-it-hidden');

        isDragging = true;
        productOverlay?.classList.add('dragging');

        const pos = getEventPos(e);
        dragStart = { x: pos.x, y: pos.y };

        const containerRect = positionContainer?.getBoundingClientRect();
        if (containerRect) {
            productStart = {
                x: state.x * containerRect.width,
                y: state.y * containerRect.height
            };
        }

        // Check for pinch gesture start
        if (e.touches && e.touches.length >= 2) {
            pinchStartDistance = getPinchDistance(e);
            pinchStartScale = state.scale;
        }
    };

    const handleDragMove = (e) => {
        if (!isDragging && !isResizing) return;
        e.preventDefault();
        e.stopPropagation();

        // Handle pinch-to-zoom
        if (e.touches && e.touches.length >= 2 && isDragging) {
            const currentDistance = getPinchDistance(e);
            if (pinchStartDistance > 0) {
                const scaleFactor = currentDistance / pinchStartDistance;
                state.scale = Math.max(0.2, Math.min(3, pinchStartScale * scaleFactor));
                updateProductOverlay();
            }
            return;
        }

        if (isDragging) {
            const pos = getEventPos(e);
            const containerRect = positionContainer?.getBoundingClientRect();
            if (!containerRect) return;

            const deltaX = pos.x - dragStart.x;
            const deltaY = pos.y - dragStart.y;

            const newPixelX = productStart.x + deltaX;
            const newPixelY = productStart.y + deltaY;

            // Convert back to normalized coordinates
            state.x = Math.max(0, Math.min(1, newPixelX / containerRect.width));
            state.y = Math.max(0, Math.min(1, newPixelY / containerRect.height));

            updateProductOverlay();
        }

        if (isResizing) {
            handleResizeMove(e);
        }
    };

    const handleDragEnd = (e) => {
        if (isDragging) {
            isDragging = false;
            productOverlay?.classList.remove('dragging');
            pinchStartDistance = 0;
            console.log('[See It] Product position:', { x: state.x.toFixed(3), y: state.y.toFixed(3), scale: state.scale.toFixed(2) });
        }
        if (isResizing) {
            handleResizeEnd(e);
        }
    };

    const handleResizeStart = (e) => {
        e.preventDefault();
        e.stopPropagation();

        isResizing = true;
        resizeHandle = e.target.className;
        productOverlay?.classList.add('resizing');

        // Hide hint
        positionHint?.classList.add('see-it-hidden');

        const pos = getEventPos(e);
        dragStart = { x: pos.x, y: pos.y };
        productStart = {
            width: state.productWidth * state.scale,
            height: state.productHeight * state.scale,
            x: state.x,
            y: state.y
        };
    };

    const handleResizeMove = (e) => {
        if (!isResizing || !positionContainer) return;

        const pos = getEventPos(e);
        const containerRect = positionContainer.getBoundingClientRect();

        let deltaX = pos.x - dragStart.x;
        let deltaY = pos.y - dragStart.y;

        // Maintain aspect ratio
        const aspectRatio = state.productNaturalHeight / state.productNaturalWidth;

        let newWidth = productStart.width;
        let newHeight = productStart.height;

        if (resizeHandle.includes('se')) {
            // Bottom-right: grow with mouse
            newWidth = Math.max(50, productStart.width + deltaX);
            newHeight = newWidth * aspectRatio;
        } else if (resizeHandle.includes('sw')) {
            // Bottom-left: opposite x
            newWidth = Math.max(50, productStart.width - deltaX);
            newHeight = newWidth * aspectRatio;
        } else if (resizeHandle.includes('ne')) {
            // Top-right: grow with x, opposite y for position
            newWidth = Math.max(50, productStart.width + deltaX);
            newHeight = newWidth * aspectRatio;
        } else if (resizeHandle.includes('nw')) {
            // Top-left: opposite both
            newWidth = Math.max(50, productStart.width - deltaX);
            newHeight = newWidth * aspectRatio;
        }

        // Calculate new scale
        state.scale = newWidth / state.productWidth;
        state.scale = Math.max(0.2, Math.min(3, state.scale));

        updateProductOverlay();
    };

    const handleResizeEnd = (e) => {
        isResizing = false;
        resizeHandle = null;
        productOverlay?.classList.remove('resizing');
        console.log('[See It] Product resized, scale:', state.scale.toFixed(2));
    };

    const setupPositionListeners = () => {
        if (positionListenersAttached) return;
        if (!productOverlay) {
            console.error('[See It] productOverlay not found');
            return;
        }

        console.log('[See It] Attaching position listeners');

        // Drag listeners on the overlay
        productOverlay.addEventListener('pointerdown', handleDragStart);
        productOverlay.addEventListener('touchstart', handleDragStart, { passive: false });

        // Move and end listeners on document for smoother interaction
        document.addEventListener('pointermove', handleDragMove);
        document.addEventListener('touchmove', handleDragMove, { passive: false });
        document.addEventListener('pointerup', handleDragEnd);
        document.addEventListener('touchend', handleDragEnd);
        document.addEventListener('pointercancel', handleDragEnd);
        document.addEventListener('touchcancel', handleDragEnd);

        // Resize handle listeners
        const handles = productOverlay.querySelectorAll('.see-it-resize-handle');
        handles.forEach(handle => {
            handle.addEventListener('pointerdown', handleResizeStart);
            handle.addEventListener('touchstart', handleResizeStart, { passive: false });
        });

        positionListenersAttached = true;
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
        if (!jobId || jobId === null || jobId === undefined) {
            throw new Error('pollJobStatus: jobId is null or undefined');
        }

        // Ensure jobId is a string
        const jobIdStr = String(jobId);
        if (!jobIdStr || jobIdStr === 'null' || jobIdStr === 'undefined') {
            throw new Error(`pollJobStatus: Invalid jobId: ${jobId}`);
        }

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const res = await fetch(`/apps/see-it/render/${jobIdStr}`);
            if (!res.ok) throw new Error(`Failed to poll: ${res.status}`);
            const data = await res.json();
            const status = data.status || data.job_status;

            if (status === 'completed') return data;
            if (status === 'failed') {
                const errorMsg = data.error_message || data.message || data.error || 'Job failed';
                throw new Error(errorMsg);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error('Timeout waiting for job to complete');
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

        // Check for failed status first (backend now returns errors immediately)
        if (data.status === 'failed') {
            const errorMsg = data.message || data.error || 'Cleanup failed';
            console.error('[See It] Cleanup failed:', errorMsg);
            throw new Error(errorMsg);
        }

        if (data.status === 'completed') {
            return {
                cleanedRoomImageUrl: data.cleaned_room_image_url || data.cleanedRoomImageUrl
            };
        }

        const jobId = data.job_id || data.jobId;
        if (!jobId) {
            console.error('[See It] No job_id in response:', data);
            throw new Error('No job_id in response. Response: ' + JSON.stringify(data));
        }
        console.log('[See It] Polling cleanup job:', jobId);
        const result = await pollJobStatus(jobId);

        return {
            cleanedRoomImageUrl: result.image_url || result.imageUrl
        };
    };

    // --- Modal Open/Close ---
    if (!trigger) {
        console.error('[See It] Trigger button not found, cannot attach click listener');
        console.error('[See It] Available elements:', Array.from(document.querySelectorAll('[id*="see-it"]')).map(el => el.id));
        console.error('[See It] All buttons on page:', Array.from(document.querySelectorAll('button')).map(b => ({ id: b.id, classes: b.className })));
        return;
    }
    
    console.log('[See It] ✅ Trigger button found:', {
        id: trigger.id,
        tagName: trigger.tagName,
        visible: trigger.offsetWidth > 0 && trigger.offsetHeight > 0,
        disabled: trigger.disabled,
        parentElement: trigger.parentElement?.tagName
    });
    
    console.log('[See It] Attaching click listener to trigger button:', trigger.id);
    
    // Store the handler function
    const handleClick = async (e) => {
        console.log('[See It] 🔵 CLICK EVENT FIRED!', e.type);
        e.preventDefault();
        e.stopPropagation();
        console.log('[See It] Modal opened');
        
        // Track AR button click
        if (analytics) {
            try {
                analytics.trackARButtonClick();
            } catch (err) {
                console.warn('[See It] Analytics error:', err);
            }
        }
        
        ensureModalPortaled();
        lockScroll();
        modal.classList.remove('hidden');
        if (triggerWidget) triggerWidget.style.display = 'none';
        resetError();

        state.productId = trigger.dataset.productId || state.productId;
        state.productTitle = trigger.dataset.productTitle || state.productTitle;
        state.productPrice = trigger.dataset.productPrice || state.productPrice;
        state.productImageUrl = trigger.dataset.productImage || state.productImageUrl;
        
        // Start analytics session
        if (analytics && !state.sessionId) {
            try {
                state.sessionId = analytics.startSession(
                    state.productId,
                    state.productTitle,
                    state.productPrice ? parseFloat(state.productPrice) : undefined
                );
            } catch (err) {
                console.warn('[See It] Analytics error:', err);
            }
        }

        // Preload the prepared product image in background (don't await)
        // This ensures the image is ready by the time we reach the position screen
        if (state.productId && !state.preparedProductImageUrl) {
            console.log('[See It] Starting background preload of prepared product image');
            (async () => {
                try {
                    const preparedUrl = await fetchPreparedProductImage(state.productId);
                    if (preparedUrl) {
                        state.preparedProductImageUrl = preparedUrl;
                        // Preload the actual image so it displays instantly
                        const img = new Image();
                        img.onload = () => {
                            state.preparedProductImagePreloaded = img;
                            console.log('[See It] Prepared product image preloaded successfully');
                        };
                        img.onerror = () => {
                            console.warn('[See It] Failed to preload prepared product image');
                        };
                        img.src = preparedUrl;
                    }
                } catch (err) {
                    console.warn('[See It] Background preload error:', err);
                }
            })();
        }

        if (state.sessionId && getActiveRoomUrl()) {
            showScreen('prepare');
        } else {
            state.originalRoomImageUrl = null;
            state.cleanedRoomImageUrl = null;
            state.sessionId = null;
            state.uploadComplete = false;
            showScreen('entry');
        }
    };
    
    // Attach listener with multiple methods for maximum compatibility
    trigger.addEventListener('click', handleClick, { capture: true });
    trigger.addEventListener('click', handleClick, { capture: false });
    
    // Also set onclick as fallback (runs after addEventListener)
    const originalOnclick = trigger.onclick;
    trigger.onclick = function(e) {
        console.log('[See It] 🔵 ONCLICK FIRED (fallback)');
        if (originalOnclick) originalOnclick.call(this, e);
        handleClick(e);
    };
    
    console.log('[See It] ✅ Click listeners attached successfully');

    const closeModal = () => {
        // Track session end (abandoned)
        if (analytics && state.sessionId) {
            try {
                analytics.endSession('abandoned', {
                    abandonmentStep: state.currentScreen,
                });
            } catch (err) {
                console.warn('[See It] Analytics error:', err);
            }
        }
        
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
        state.uploadPromise = null;
        state.uploadError = null;
        hasErased = false;
        strokes = [];
        currentStroke = [];
        ctx = null;

        try {
            // Track room capture started
            if (analytics) {
                try {
                    if (!state.sessionId) {
                        state.sessionId = analytics.startSession(
                            state.productId,
                            state.productTitle,
                            state.productPrice ? parseFloat(state.productPrice) : undefined
                        );
                    }
                    analytics.trackStep('room_capture', 'started');
                } catch (err) {
                    console.warn('[See It] Analytics error:', err);
                }
            }
            
            // Normalize image locally (instant)
            const normalized = await normalizeRoomImage(file);
            state.normalizedWidth = normalized.width;
            state.normalizedHeight = normalized.height;

            // Set preview immediately (instant - local data)
            const dataUrl = URL.createObjectURL(normalized.blob);
            state.localImageDataUrl = dataUrl;

            if (roomPreview) roomPreview.src = dataUrl;
            if (roomImage) roomImage.src = dataUrl;

            // Show prepare screen immediately
            showScreen('prepare');

            // Wait for image element to render
            await new Promise(resolve => {
                if (roomPreview) {
                    roomPreview.onload = resolve;
                    setTimeout(resolve, 200);
                } else {
                    resolve();
                }
            });

            initCanvas();
            updatePaintButtons();

            // Start upload SILENTLY in background - user doesn't see this
            state.uploadPromise = (async () => {
                try {
                    const session = await startSession();
                    state.sessionId = session.sessionId || session.room_session_id;

                    const normalizedFile = new File([normalized.blob], 'room.jpg', { type: 'image/jpeg' });
                    await uploadImage(normalizedFile, session.uploadUrl || session.upload_url);

                    const confirm = await confirmRoom(state.sessionId);
                    state.originalRoomImageUrl = confirm.roomImageUrl || confirm.room_image_url;
                    state.uploadComplete = true;
                    console.log('[See It] Background upload complete');
                } catch (err) {
                    console.error('[See It] Background upload error:', err);
                    state.uploadError = err.message;
                }
            })();

        } catch (err) {
            console.error('[See It] File processing error:', err);
            showError('Failed to process image: ' + err.message);
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
        
        // Track room capture completed
        if (analytics) {
            try {
                analytics.trackStep('room_capture', 'completed', {
                    retakeCount: 0, // Could track this if needed
                });
            } catch (err) {
                console.warn('[See It] Analytics error:', err);
            }
        }

        // Trigger Gemini pre-upload in background (non-blocking)
        if (state.sessionId) {
            fetch('/apps/see-it/room/gemini-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_session_id: state.sessionId })
            }).then(res => res.json()).then(data => {
                console.log('[See It] Gemini pre-upload:', data.success ? 'success' : 'skipped');
            }).catch(err => {
                console.warn('[See It] Gemini pre-upload failed (will use fallback):', err);
            });
        }

        showScreen('position');
    });

    // --- ERASE BUTTON ---
    const handleRemove = async () => {
        console.log('[See It] ========== ERASE CLICKED ==========');

        // Validation
        if (state.isCleaningUp) return;
        if (strokes.length === 0) {
            showError('Draw over the object you want to remove first.');
            return;
        }

        resetError();
        state.isCleaningUp = true;
        updatePaintButtons();

        // Wait for background upload to complete if still in progress
        if (state.uploadPromise && !state.uploadComplete) {
            console.log('[See It] Waiting for background upload...');
            await state.uploadPromise;
        }

        // Check upload succeeded
        if (state.uploadError) {
            showError('Upload failed: ' + state.uploadError + '. Please try again.');
            state.isCleaningUp = false;
            updatePaintButtons();
            return;
        }
        if (!state.sessionId) {
            showError('Session expired. Please re-upload your image.');
            state.isCleaningUp = false;
            updatePaintButtons();
            return;
        }

        const strokesBackup = JSON.parse(JSON.stringify(strokes));

        try {
            const mask = generateMask();
            if (!mask) {
                throw new Error('Failed to generate mask');
            }

            if (!state.normalizedWidth || !state.normalizedHeight) {
                const error = 'Normalized dimensions not set. Please re-upload the image.';
                console.error('[See It]', error);
                throw new Error(error);
            }

            const maskW = hiddenMaskCanvas.width;
            const maskH = hiddenMaskCanvas.height;
            if (maskW !== state.normalizedWidth || maskH !== state.normalizedHeight) {
                const error = `Dimension mismatch! Mask: ${maskW}x${maskH}, Expected: ${state.normalizedWidth}x${state.normalizedHeight}. Please re-upload and try again.`;
                console.error('[See It]', error);
                throw new Error(error);
            }

            console.log('[See It] Sending cleanup request...', {
                maskDimensions: `${maskW}x${maskH}`,
                normalizedDimensions: `${state.normalizedWidth}x${state.normalizedHeight}`,
                strokes: strokes.length
            });
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

            // Keep strokes visible during loading - DON'T clear yet!
            hasErased = true;

            // Show loading state on the button
            if (btnRemove) {
                btnRemove.textContent = 'Loading...';
            }

            // CRITICAL FIX: GCS signed URLs don't work directly in <img> elements
            // We must fetch the image first, then create a blob URL
            console.log('[See It] Fetching cleaned image via blob URL method...');

            try {
                const imageResponse = await fetch(newUrl);
                if (!imageResponse.ok) {
                    throw new Error(`Failed to fetch cleaned image: ${imageResponse.status}`);
                }

                const blob = await imageResponse.blob();
                const blobUrl = URL.createObjectURL(blob);

                console.log('[See It] Created blob URL:', blobUrl);
                console.log('[See It] Blob size:', blob.size);

                // Preload the image before displaying
                const preloadImg = new Image();
                await new Promise((resolve, reject) => {
                    preloadImg.onload = resolve;
                    preloadImg.onerror = reject;
                    preloadImg.src = blobUrl;
                });

                console.log('[See It] Image preloaded, now clearing mask and updating display...');

                // NOW clear strokes and canvases (image is ready)
                strokes = [];
                redrawStrokes(); // This redraws room image and clears mask

                // Set the blob URL on the image elements (instant since preloaded)
                if (roomPreview) {
                    roomPreview.style.opacity = '0';
                    roomPreview.src = blobUrl;
                    // Fade in the new image
                    requestAnimationFrame(() => {
                        roomPreview.style.transition = 'opacity 0.3s ease';
                        roomPreview.style.opacity = '1';
                    });
                    console.log('[See It] ✅ roomPreview src set to blob URL');
                }
                if (roomImage) {
                    roomImage.src = blobUrl;
                    console.log('[See It] ✅ roomImage src set to blob URL');
                }

                // Verify the images loaded
                if (roomPreview) {
                    console.log('[See It] roomPreview dimensions:', {
                        naturalWidth: roomPreview.naturalWidth,
                        naturalHeight: roomPreview.naturalHeight,
                        complete: roomPreview.complete
                    });
                }

                console.log('[See It] ✅ Cleanup complete - image updated via blob URL!');
            } catch (fetchErr) {
                console.error('[See It] Failed to fetch cleaned image:', fetchErr);
                // Fallback: try setting the URL directly (might work in some browsers)
                strokes = [];
                redrawStrokes();
                if (roomPreview) roomPreview.src = newUrl;
                if (roomImage) roomImage.src = newUrl;
            }

        } catch (err) {
            console.error('[See It] Cleanup error:', err);
            console.error('[See It] Error details:', {
                message: err.message,
                stack: err.stack,
                state: {
                    sessionId: state.sessionId,
                    uploadComplete: state.uploadComplete,
                    normalizedWidth: state.normalizedWidth,
                    normalizedHeight: state.normalizedHeight,
                    maskCanvasWidth: maskCanvas?.width,
                    maskCanvasHeight: maskCanvas?.height
                }
            });
            strokes = strokesBackup;
            redrawStrokes();
            const errorMsg = 'Erase failed: ' + (err.message || 'Unknown error');
            showError(errorMsg);
            // Also show alert for critical errors
            if (err.message?.includes('dimension') || err.message?.includes('mismatch')) {
                alert('[See It Critical Error] ' + errorMsg + '\n\nCheck console for details.');
            }
        } finally {
            state.isCleaningUp = false;
            updatePaintButtons();
        }
    };

    // ERASE BUTTON EVENT LISTENER
    if (btnRemove) {
        console.log('[See It] Attaching Erase button listener to:', btnRemove);
        console.log('[See It] btnRemove.id:', btnRemove.id);
        console.log('[See It] btnRemove.disabled:', btnRemove.disabled);
        console.log('[See It] btnRemove visible:', isVisible(btnRemove));

        btnRemove.addEventListener('click', (e) => {
            console.log('[See It] ======================================');
            console.log('[See It] ERASE BUTTON CLICK EVENT FIRED!');
            console.log('[See It] Button disabled?:', btnRemove.disabled);
            console.log('[See It] Button text:', btnRemove.textContent);
            console.log('[See It] State snapshot:', JSON.stringify({
                isCleaningUp: state.isCleaningUp,
                sessionId: state.sessionId,
                uploadComplete: state.uploadComplete,
                strokeCount: strokes.length,
                normalizedWidth: state.normalizedWidth,
                normalizedHeight: state.normalizedHeight
            }, null, 2));
            console.log('[See It] ======================================');



            e.preventDefault();
            e.stopPropagation();
            handleRemove();
        });

        // Also add a direct onclick as backup
        btnRemove.onclick = function (e) {
            console.log('[See It] ONCLICK BACKUP FIRED!');
        };
    } else {
        console.error('[See It] CRITICAL: btnRemove element not found!');
        console.error('[See It] Searched for id: see-it-remove-btn');
        console.error('[See It] Available elements with IDs:',
            Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(id => id.includes('see-it')));
    }

    // --- Generate ---
    const handleGenerate = async () => {
        console.log('[See It] ========== handleGenerate START ==========');

        if (!state.sessionId || !state.productId) {
            const msg = `Missing session (${state.sessionId}) or product (${state.productId})`;
            console.error('[See It]', msg);
            showError(msg);
            return;
        }
        
        // Track inpaint started
        if (analytics) {
            try {
                analytics.trackStep('inpaint', 'started');
            } catch (err) {
                console.warn('[See It] Analytics error:', err);
            }
        }

        showScreen('loading');
        resetError();

        // Start cycling loading messages
        let messageIndex = 0;
        const loadingTextEl = document.getElementById('see-it-loading-text');
        const messageInterval = setInterval(() => {
            messageIndex = (messageIndex + 1) % LOADING_MESSAGES.length;
            if (loadingTextEl) {
                loadingTextEl.innerHTML = LOADING_MESSAGES[messageIndex] + '<span class="see-it-loading-dots"></span>';
            }
        }, 2500);

        try {
            const containerRect = positionContainer?.getBoundingClientRect();
            let productWidthFraction = undefined;

            if (containerRect && containerRect.width > 0) {
                // Calculate the visual width of the product as displayed
                // state.productWidth is CSS pixels, state.scale is user's resize multiplier
                const visualProductWidth = state.productWidth * (state.scale || 1);
                
                // Calculate fraction of container (which maps to room image)
                productWidthFraction = visualProductWidth / containerRect.width;
                
                // Log details for debugging
                console.log('[See It] Size calculation:', {
                    productNaturalWidth: state.productNaturalWidth,
                    productNaturalHeight: state.productNaturalHeight,
                    cssProductWidth: state.productWidth,
                    scale: state.scale,
                    visualProductWidth: visualProductWidth.toFixed(0),
                    containerWidth: containerRect.width.toFixed(0),
                    productWidthFraction: productWidthFraction.toFixed(3)
                });
            }

            const payload = {
                room_session_id: state.sessionId,
                product_id: state.productId,
                placement: {
                    x: state.x,
                    y: state.y,
                    scale: state.scale || 1,
                    product_width_fraction: productWidthFraction
                },
                config: {
                    style_preset: 'neutral',
                    quality: 'standard',
                    product_image_url: state.productImageUrl
                }
            };

            console.log('[See It] Generate payload:', JSON.stringify(payload, null, 2));

            const res = await fetch('/apps/see-it/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            console.log('[See It] Response status:', res.status);

            const data = await res.json();
            console.log('[See It] Response data:', JSON.stringify(data, null, 2));

            if (!res.ok) {
                throw new Error(data.error || data.message || `HTTP ${res.status}`);
            }

            if (data.status === 'failed') {
                throw new Error(data.error || data.message || 'Render failed');
            }

            let imageUrl = null;
            let jobId = null;

            if (data.status === 'completed' && data.imageUrl) {
                imageUrl = data.imageUrl;
                jobId = data.job_id;
            } else if (data.job_id) {
                const result = await pollJobStatus(data.job_id);
                imageUrl = result.imageUrl || result.image_url;
                jobId = data.job_id;
            }

            if (imageUrl) {
                // Save for email capture
                state.lastRenderJobId = jobId;
                state.lastResultUrl = imageUrl;

                // Reset email form
                if (emailFormWrap) emailFormWrap.classList.remove('see-it-hidden');
                if (emailSuccess) emailSuccess.classList.add('see-it-hidden');
                if (emailInput) emailInput.value = '';

                // Set image and show result
                if (resultImage) resultImage.src = imageUrl;
                clearInterval(messageInterval);
                showScreen('result');
                
                // Track inpaint completed and session completed
                if (analytics) {
                    try {
                        analytics.trackStep('inpaint', 'completed');
                        analytics.trackStep('placement', 'completed');
                        analytics.endSession('completed');
                    } catch (err) {
                        console.warn('[See It] Analytics error:', err);
                    }
                }

                // Prefetch collection products for swiper
                fetchCollectionProducts();
            }
        } catch (err) {
            console.error('[See It] Generate error:', err);
            console.error('[See It] Error stack:', err.stack);

            // Show error prominently for debugging
            const errorMsg = 'Generate failed: ' + (err.message || 'Unknown error');
            showError(errorMsg);
            alert('[See It Debug] ' + errorMsg);  // Temporary - remove after debugging
            
            // Track error
            if (analytics) {
                try {
                    analytics.trackError('GENERATE_FAILED', errorMsg, 'error');
                    analytics.trackStep('inpaint', 'failed');
                } catch (analyticsErr) {
                    console.warn('[See It] Analytics error:', analyticsErr);
                }
            }

            clearInterval(messageInterval);
            showScreen('position'); // Go back on error
        }
    };

    btnGenerate?.addEventListener('click', handleGenerate);

    // --- Email Capture ---
    const captureEmail = async (email) => {
        try {
            const res = await fetch('/apps/see-it/capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    product_id: state.productId,
                    product_title: state.productTitle,
                    render_job_id: state.lastRenderJobId,
                    image_url: state.lastResultUrl
                })
            });
            return res.ok;
        } catch (e) {
            console.error('[See It] Email capture failed:', e);
            return false;
        }
    };

    // --- Collection Products Fetcher ---
    const fetchCollectionProducts = async () => {
        try {
            const res = await fetch(`/apps/see-it/collection-products?product_id=${state.productId}&limit=10`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            state.collectionProducts = data.products || [];
            state.collectionInfo = data.collection || null;
            state.swiperIndex = 0;
            console.log('[See It] Collection products loaded:', state.collectionProducts.length);
        } catch (e) {
            console.error('[See It] Failed to load collection products:', e);
            state.collectionProducts = [];
        }
    };

    // --- Product Swiper ---
    const showSwiper = () => {
        if (state.collectionProducts.length === 0) {
            console.log('[See It] No products to show in swiper');
            showError('No other products available in this collection');
            return;
        }
        updateSwiperCard();
        swiper?.classList.add('see-it-active');
    };

    const hideSwiper = () => {
        swiper?.classList.remove('see-it-active');
    };

    const updateSwiperCard = () => {
        const product = state.collectionProducts[state.swiperIndex];
        if (!product) return;

        if (swiperImg) swiperImg.src = product.image || '';
        if (swiperName) swiperName.textContent = product.title;
        if (swiperCollection && state.collectionInfo) {
            swiperCollection.textContent = state.collectionInfo.title;
        }
    };

    const swipeCard = (direction) => {
        swiperCard?.classList.add(direction === 'left' ? 'swiping-left' : 'swiping-right');

        setTimeout(() => {
            swiperCard?.classList.remove('swiping-left', 'swiping-right');

            if (direction === 'right') {
                state.swiperIndex = (state.swiperIndex + 1) % state.collectionProducts.length;
            } else {
                state.swiperIndex = (state.swiperIndex - 1 + state.collectionProducts.length) % state.collectionProducts.length;
            }
            updateSwiperCard();
        }, 150);
    };

    const selectSwiperProduct = async () => {
        const product = state.collectionProducts[state.swiperIndex];
        if (!product) return;

        // Update state with new product
        state.productId = product.id;
        state.productTitle = product.title;

        // Fetch prepared image for new product
        const preparedUrl = await fetchPreparedProductImage(product.id);
        state.productImageUrl = preparedUrl || product.image;

        // Update product overlay image
        if (productImage) productImage.src = state.productImageUrl;

        hideSwiper();
        showScreen('position');
    };

    // Swiper touch support
    const setupSwiperTouch = () => {
        if (!swiperCard) return;

        let startX = 0;
        let currentX = 0;

        swiperCard.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
        });

        swiperCard.addEventListener('touchmove', (e) => {
            currentX = e.touches[0].clientX;
            const diff = currentX - startX;
            swiperCard.style.transform = `translateX(${diff}px) rotate(${diff * 0.05}deg)`;
        });

        swiperCard.addEventListener('touchend', () => {
            const diff = currentX - startX;
            swiperCard.style.transform = '';

            if (Math.abs(diff) > 80) {
                swipeCard(diff > 0 ? 'right' : 'left');
            }
            startX = 0;
            currentX = 0;
        });
    };

    // Initialize swiper touch
    setupSwiperTouch();

    // --- Result Actions ---
    const resetToEntry = () => {
        state.sessionId = null;
        state.originalRoomImageUrl = null;
        state.cleanedRoomImageUrl = null;
        state.localImageDataUrl = null;
        state.uploadComplete = false;
        hasErased = false;
        strokes = [];
        showScreen('entry');
    };

    btnBackResult?.addEventListener('click', resetToEntry);
    btnTryAgain?.addEventListener('click', resetToEntry);

    btnTryAnother?.addEventListener('click', () => {
        if (state.collectionProducts.length > 0) {
            showSwiper();
        } else {
            showError('No other products available');
        }
    });

    // Email form
    emailForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput?.value?.trim();
        if (!email) return;

        if (emailSubmit) {
            emailSubmit.disabled = true;
            emailSubmit.textContent = 'Sending...';
        }

        const success = await captureEmail(email);

        if (success) {
            if (emailFormWrap) emailFormWrap.classList.add('see-it-hidden');
            if (emailSuccess) emailSuccess.classList.remove('see-it-hidden');
        } else {
            if (emailSubmit) {
                emailSubmit.disabled = false;
                emailSubmit.textContent = 'Send';
            }
        }
    });

    // Swiper controls
    swiperClose?.addEventListener('click', hideSwiper);
    swiperPrev?.addEventListener('click', () => swipeCard('left'));
    swiperNext?.addEventListener('click', () => swipeCard('right'));
    swiperSkipLeft?.addEventListener('click', () => swipeCard('left'));
    swiperSkipRight?.addEventListener('click', () => swipeCard('right'));
    swiperSelect?.addEventListener('click', selectSwiperProduct);

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
                // Fallback on error
                const a = document.createElement('a');
                a.href = state.lastResultUrl;
                a.download = 'see-it-room.jpg';
                a.click();
            }
        }
    });

    console.log('[See It] Initialization complete');
    }); // End of waitForElements callback
    } // End of initSeeIt function
    
    // Run immediately if DOM is ready, otherwise wait for DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSeeIt);
    } else {
        // DOM already loaded, run immediately
        initSeeIt();
    }
})();
