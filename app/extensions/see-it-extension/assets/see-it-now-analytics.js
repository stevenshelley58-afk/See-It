/**
 * See It Now - Lightweight Analytics Beacon
 * Posts events to the monitor dashboard for session tracking
 * 
 * Usage (from see-it-now.js):
 *   window.SeeItNowAnalytics.init({ monitorUrl: 'https://see-it-monitor.vercel.app' });
 *   window.SeeItNowAnalytics.startSession(productId, productTitle, shopDomain);
 *   window.SeeItNowAnalytics.trackEvent('room_uploaded', { roomSessionId: '...' });
 *   window.SeeItNowAnalytics.endSession('completed');
 */

(function () {
  'use strict';

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  const DEFAULT_MONITOR_URL = '';  // Set via init() or data attribute
  const FLUSH_INTERVAL = 5000;     // 5 seconds
  const MAX_QUEUE_SIZE = 20;       // Flush when queue reaches this size

  // ============================================================================
  // STATE
  // ============================================================================

  let config = {
    monitorUrl: DEFAULT_MONITOR_URL,
    shopDomain: '',
    debug: false,
  };

  let sessionId = null;
  let sessionStartedAt = null;
  let productId = null;
  let productTitle = null;
  let currentStep = null;
  let eventQueue = [];
  let flushTimer = null;
  let deviceContext = null;

  // ============================================================================
  // DEVICE DETECTION
  // ============================================================================

  function detectDeviceContext() {
    const ua = navigator.userAgent;

    // Device type
    let deviceType = 'desktop';
    if (/iPhone|iPad|iPod|Android/i.test(ua)) {
      deviceType = /iPad|Tablet/i.test(ua) ? 'tablet' : 'mobile';
    }

    // OS
    let os = 'Unknown';
    let osVersion = '';
    if (/Windows/.test(ua)) {
      os = 'Windows';
      const match = ua.match(/Windows NT (\d+\.\d+)/);
      osVersion = match ? match[1] : '';
    } else if (/Mac OS X/.test(ua)) {
      os = 'macOS';
      const match = ua.match(/Mac OS X (\d+[._]\d+)/);
      osVersion = match ? match[1].replace('_', '.') : '';
    } else if (/iPhone|iPad/.test(ua)) {
      os = 'iOS';
      const match = ua.match(/OS (\d+[._]\d+)/);
      osVersion = match ? match[1].replace('_', '.') : '';
    } else if (/Android/.test(ua)) {
      os = 'Android';
      const match = ua.match(/Android (\d+\.\d+)/);
      osVersion = match ? match[1] : '';
    }

    // Browser
    let browser = 'Unknown';
    let browserVersion = '';
    if (/Chrome/.test(ua) && !/Edg/.test(ua)) {
      browser = 'Chrome';
      const match = ua.match(/Chrome\/(\d+)/);
      browserVersion = match ? match[1] : '';
    } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
      browser = 'Safari';
      const match = ua.match(/Version\/(\d+)/);
      browserVersion = match ? match[1] : '';
    } else if (/Firefox/.test(ua)) {
      browser = 'Firefox';
      const match = ua.match(/Firefox\/(\d+)/);
      browserVersion = match ? match[1] : '';
    } else if (/Edg/.test(ua)) {
      browser = 'Edge';
      const match = ua.match(/Edg\/(\d+)/);
      browserVersion = match ? match[1] : '';
    }

    // Connection type
    let connectionType = 'unknown';
    const connection = navigator.connection;
    if (connection && connection.effectiveType) {
      connectionType = connection.effectiveType;
    }

    return {
      deviceType,
      os,
      osVersion,
      browser,
      browserVersion,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      hasCamera: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      hasGyroscope: 'DeviceOrientationEvent' in window,
      webglSupport: (function () {
        try {
          const canvas = document.createElement('canvas');
          return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        } catch {
          return false;
        }
      })(),
      connectionType,
    };
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  function generateSessionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `sin_${timestamp}_${random}`;
  }

  function startSession(pId, pTitle, shopDomain) {
    sessionId = generateSessionId();
    sessionStartedAt = new Date();
    productId = pId || null;
    productTitle = pTitle || null;
    currentStep = 'session_started';

    if (shopDomain) {
      config.shopDomain = shopDomain;
    }

    // Detect device context once per session
    deviceContext = detectDeviceContext();

    queueEvent('session_started', {
      productId,
      productTitle,
      entryPoint: detectEntryPoint(),
      referrer: document.referrer || null,
      timeOnPageBeforeArMs: 0,  // We start tracking from button click
      flow: 'see_it_now',
      env: detectEnvironment(),
      flow_version: '1.0.0',
      app_version: '1.0.0',
    });

    log('Session started:', sessionId);
    return sessionId;
  }

  function endSession(status, metadata) {
    if (!sessionId) {
      log('No active session to end');
      return;
    }

    const durationMs = sessionStartedAt ? Date.now() - sessionStartedAt.getTime() : null;

    queueEvent('session_ended', {
      status: status || 'completed',
      durationMs,
      abandonmentStep: status === 'abandoned' ? currentStep : null,
      ...metadata,
    });

    log('Session ended:', { status, durationMs });

    // Flush immediately on session end
    flush();

    // Reset state
    sessionId = null;
    sessionStartedAt = null;
    productId = null;
    productTitle = null;
    currentStep = null;
  }

  // ============================================================================
  // EVENT TRACKING
  // ============================================================================

  function trackEvent(eventType, data) {
    if (!sessionId && eventType !== 'ar_button_impression' && eventType !== 'ar_button_click') {
      log('No active session, cannot track event:', eventType);
      return;
    }

    // Update current step for step-like events
    if (['room_uploaded', 'variants_generated', 'variant_selected'].includes(eventType)) {
      currentStep = eventType;
    }

    queueEvent(eventType, data);
    log('Event tracked:', eventType, data);
  }

  function trackStep(step, status, metadata) {
    currentStep = step;
    queueEvent('step_update', {
      step,
      status,
      ...metadata,
    });
    log('Step tracked:', { step, status });
  }

  function trackError(errorCode, errorMessage, metadata) {
    queueEvent('error', {
      errorCode,
      errorMessage,
      severity: 'error',
      step: currentStep,
      isUserFacing: true,
      ...metadata,
    });
    log('Error tracked:', { errorCode, errorMessage });
  }

  // ============================================================================
  // EVENT QUEUE
  // ============================================================================

  function queueEvent(type, data) {
    const event = {
      type,
      sessionId: sessionId || undefined,
      shopDomain: config.shopDomain,
      data: data || {},
      timestamp: new Date().toISOString(),
      deviceContext: deviceContext || undefined,
    };

    eventQueue.push(event);

    // Flush if queue is full
    if (eventQueue.length >= MAX_QUEUE_SIZE) {
      flush();
    }
  }

  function flush() {
    if (eventQueue.length === 0) return;
    if (!config.monitorUrl) {
      log('No monitor URL configured, events discarded');
      eventQueue = [];
      return;
    }

    const eventsToSend = [...eventQueue];
    eventQueue = [];

    const endpoint = config.monitorUrl.replace(/\/$/, '') + '/api/analytics/events';

    // Use sendBeacon for reliability on page unload, fetch otherwise
    const payload = JSON.stringify({ events: eventsToSend });

    if (navigator.sendBeacon) {
      try {
        const success = navigator.sendBeacon(endpoint, payload);
        if (!success) {
          // Fallback to fetch if sendBeacon fails
          sendWithFetch(endpoint, payload, eventsToSend);
        } else {
          log('Flushed events via beacon:', eventsToSend.length);
        }
      } catch {
        sendWithFetch(endpoint, payload, eventsToSend);
      }
    } else {
      sendWithFetch(endpoint, payload, eventsToSend);
    }
  }

  function sendWithFetch(endpoint, payload, eventsToSend) {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
      .then(response => {
        if (!response.ok) {
          log('Flush failed, re-queuing events');
          eventQueue = [...eventsToSend, ...eventQueue];
        } else {
          log('Flushed events via fetch:', eventsToSend.length);
        }
      })
      .catch(() => {
        log('Flush error, re-queuing events');
        eventQueue = [...eventsToSend, ...eventQueue];
      });
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  function detectEntryPoint() {
    const referrer = document.referrer;
    const path = window.location.pathname;

    if (!referrer) return 'direct';

    try {
      const referrerUrl = new URL(referrer);
      const currentUrl = new URL(window.location.href);

      if (referrerUrl.hostname !== currentUrl.hostname) {
        return 'external';
      }

      if (path.includes('/products/')) return 'product_page';
      if (path.includes('/collections/')) return 'collection';
      return 'internal';
    } catch {
      return 'unknown';
    }
  }

  function detectEnvironment() {
    const hostname = window.location.hostname;
    if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
      return 'development';
    }
    if (hostname.includes('staging') || hostname.includes('preview')) {
      return 'staging';
    }
    return 'production';
  }

  function log(...args) {
    if (config.debug) {
      console.log('[SeeItNowAnalytics]', ...args);
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function init(options) {
    if (options) {
      if (options.monitorUrl) config.monitorUrl = options.monitorUrl;
      if (options.shopDomain) config.shopDomain = options.shopDomain;
      if (options.debug !== undefined) config.debug = options.debug;
    }

    // Set up periodic flush
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(flush, FLUSH_INTERVAL);

    // Flush on page unload
    window.addEventListener('beforeunload', function () {
      if (sessionId) {
        queueEvent('session_ended', {
          status: 'abandoned',
          durationMs: sessionStartedAt ? Date.now() - sessionStartedAt.getTime() : null,
          abandonmentStep: currentStep,
          reason: 'page_unload',
        });
      }
      flush();
    });

    // Flush on visibility change
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    });

    log('Analytics initialized:', config);
  }

  function destroy() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flush();
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.SeeItNowAnalytics = {
    init,
    startSession,
    endSession,
    trackEvent,
    trackStep,
    trackError,
    flush,
    destroy,
    getSessionId: function () { return sessionId; },
    isActive: function () { return sessionId !== null; },
  };

})();
