/**
 * See It Analytics SDK
 * Drop this into the See It app to capture comprehensive analytics
 * 
 * Usage:
 *   import { SeeItAnalytics } from './analytics';
 *   const analytics = new SeeItAnalytics({ shopDomain: 'myshop.com' });
 *   analytics.startSession(productId, productTitle, productPrice);
 *   analytics.trackStep('room_capture', 'started');
 *   analytics.trackStep('room_capture', 'completed', { retakeCount: 2 });
 *   analytics.endSession('completed');
 */

type Step = 'room_capture' | 'mask' | 'inpaint' | 'placement' | 'final';
type StepStatus = 'started' | 'completed' | 'failed' | 'skipped';
type SessionStatus = 'completed' | 'abandoned' | 'error';
type PostArAction = 'add_to_cart' | 'continue_browsing' | 'leave';

interface DeviceContext {
  deviceType: 'mobile' | 'tablet' | 'desktop';
  os: string;
  osVersion: string;
  browser: string;
  browserVersion: string;
  screenWidth: number;
  screenHeight: number;
  hasCamera: boolean;
  hasGyroscope: boolean;
  webglSupport: boolean;
  connectionType: string;
}

interface AnalyticsConfig {
  shopDomain: string;
  endpoint?: string;
  debug?: boolean;
  batchSize?: number;
  flushInterval?: number;
}

interface AnalyticsEvent {
  type: string;
  sessionId?: string;
  shopDomain: string;
  data: Record<string, unknown>;
  timestamp: string;
  deviceContext?: DeviceContext;
}

interface StepMetadata {
  retakeCount?: number;
  maskEditCount?: number;
  placementAdjustments?: number;
  regenerationCount?: number;
  autoVsManual?: 'auto' | 'manual' | 'hybrid';
  autoConfidence?: number;
  qualityRating?: number;
  inputFile?: string;
  outputFile?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  [key: string]: unknown;
}

interface AIRequestData {
  requestId: string;
  provider: 'replicate' | 'fal' | 'openai';
  model: string;
  modelVersion?: string;
  operation: 'inpaint' | 'segment' | 'remove_bg' | 'upscale';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: 'pending' | 'success' | 'failed' | 'timeout';
  costUsd?: number;
  isRegeneration?: boolean;
  regenerationReason?: 'user_requested' | 'auto_retry' | 'quality_fail';
  errorMessage?: string;
}

export class SeeItAnalytics {
  private config: Required<AnalyticsConfig>;
  private eventQueue: AnalyticsEvent[] = [];
  private sessionId: string | null = null;
  private sessionStartedAt: Date | null = null;
  private deviceContext: DeviceContext | null = null;
  private currentStep: Step | null = null;
  private stepStartedAt: Date | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private productId: string | null = null;
  private productTitle: string | null = null;
  private productPrice: number | null = null;
  private pageLoadedAt: Date = new Date();

  constructor(config: AnalyticsConfig) {
    this.config = {
      shopDomain: config.shopDomain,
      endpoint: config.endpoint || 'https://see-it-monitor.vercel.app/api/analytics/events',
      debug: config.debug || false,
      batchSize: config.batchSize || 10,
      flushInterval: config.flushInterval || 5000,
    };

    this.deviceContext = this.detectDeviceContext();
    this.setupFlushTimer();
    this.setupBeforeUnload();
    this.log('Analytics initialized', this.config);
  }

  // ============================================
  // SESSION LIFECYCLE
  // ============================================

  startSession(
    productId: string,
    productTitle?: string,
    productPrice?: number,
    sessionIdOverride?: string
  ): string {
    this.sessionId = sessionIdOverride || this.generateSessionId();
    this.sessionStartedAt = new Date();
    this.productId = productId;
    this.productTitle = productTitle || null;
    this.productPrice = productPrice || null;

    const timeOnPageBeforeAr = Date.now() - this.pageLoadedAt.getTime();

    this.trackEvent('session_started', {
      productId,
      productTitle,
      productPrice,
      entryPoint: this.detectEntryPoint(),
      referrer: document.referrer || null,
      timeOnPageBeforeArMs: timeOnPageBeforeAr,
    });

    this.log('Session started', this.sessionId);
    return this.sessionId;
  }

  endSession(status: SessionStatus, metadata?: Record<string, unknown>): void {
    if (!this.sessionId || !this.sessionStartedAt) {
      this.log('No active session to end');
      return;
    }

    const durationMs = Date.now() - this.sessionStartedAt.getTime();

    this.trackEvent('session_ended', {
      status,
      durationMs,
      abandonmentStep: status === 'abandoned' ? this.currentStep : null,
      ...metadata,
    });

    this.log('Session ended', { status, durationMs });
    
    // Flush immediately on session end
    this.flush();

    // Reset session state
    this.sessionId = null;
    this.sessionStartedAt = null;
    this.currentStep = null;
    this.stepStartedAt = null;
    this.productId = null;
    this.productTitle = null;
    this.productPrice = null;
  }

  // ============================================
  // STEP TRACKING
  // ============================================

  trackStep(step: Step, status: StepStatus, metadata?: StepMetadata): void {
    if (!this.sessionId) {
      this.log('No active session, cannot track step');
      return;
    }

    let durationMs: number | null = null;

    if (status === 'started') {
      this.currentStep = step;
      this.stepStartedAt = new Date();
    } else if (status === 'completed' || status === 'failed') {
      if (this.stepStartedAt && this.currentStep === step) {
        durationMs = Date.now() - this.stepStartedAt.getTime();
      }
    }

    this.trackEvent('step_update', {
      step,
      status,
      durationMs,
      ...metadata,
    });

    this.log('Step tracked', { step, status, durationMs });
  }

  // ============================================
  // AI REQUEST TRACKING
  // ============================================

  trackAIRequest(data: AIRequestData): void {
    this.trackEvent('ai_request', {
      ...data,
      step: this.currentStep,
    });

    this.log('AI request tracked', data);
  }

  // Convenience method for tracking regenerations
  trackRegeneration(
    provider: AIRequestData['provider'],
    model: string,
    operation: AIRequestData['operation'],
    reason: AIRequestData['regenerationReason']
  ): void {
    this.trackEvent('regeneration_requested', {
      provider,
      model,
      operation,
      reason,
      step: this.currentStep,
    });

    this.log('Regeneration tracked', { provider, model, operation, reason });
  }

  // ============================================
  // ERROR TRACKING
  // ============================================

  trackError(
    errorCode: string,
    errorMessage: string,
    severity: 'critical' | 'error' | 'warning' = 'error',
    metadata?: Record<string, unknown>
  ): void {
    try {
      this.trackEvent('error', {
        errorCode,
        errorMessage,
        severity,
        step: this.currentStep,
        isUserFacing: metadata?.isUserFacing ?? true,
        ...metadata,
      });

      this.log('Error tracked', { errorCode, errorMessage, severity });
    } catch (err) {
      // Fail silently - analytics should never break the app
      console.error('[Analytics] Failed to track error:', err);
    }
  }

  // ============================================
  // CONVERSION TRACKING
  // ============================================

  trackARButtonImpression(): void {
    try {
      this.trackEvent('ar_button_impression', {
        productId: this.productId,
        productTitle: this.productTitle,
        productPrice: this.productPrice,
        timeOnPage: Date.now() - this.pageLoadedAt.getTime(),
      });
    } catch (err) {
      console.error('[Analytics] Failed to track impression:', err);
    }
  }

  trackARButtonClick(): void {
    try {
      this.trackEvent('ar_button_click', {
        productId: this.productId,
        productTitle: this.productTitle,
        productPrice: this.productPrice,
        timeOnPage: Date.now() - this.pageLoadedAt.getTime(),
      });
    } catch (err) {
      console.error('[Analytics] Failed to track click:', err);
    }
  }

  trackPostArAction(action: PostArAction): void {
    try {
      this.trackEvent('post_ar_action', {
        action,
        productId: this.productId,
        productTitle: this.productTitle,
        productPrice: this.productPrice,
      });

      if (action === 'add_to_cart') {
        this.trackEvent('add_to_cart_from_ar', {
          productId: this.productId,
          productTitle: this.productTitle,
          productPrice: this.productPrice,
          sessionDurationMs: this.sessionStartedAt 
            ? Date.now() - this.sessionStartedAt.getTime() 
            : null,
        });
      }

      this.log('Post-AR action tracked', action);
    } catch (err) {
      console.error('[Analytics] Failed to track post-AR action:', err);
    }
  }

  // ============================================
  // USER INTERACTION TRACKING
  // ============================================

  trackUserAction(action: string, metadata?: Record<string, unknown>): void {
    try {
      this.trackEvent('user_action', {
        action,
        step: this.currentStep,
        ...metadata,
      });

      this.log('User action tracked', { action, metadata });
    } catch (err) {
      console.error('[Analytics] Failed to track user action:', err);
    }
  }

  // Common user actions
  trackRetake(): void {
    this.trackUserAction('retake_photo');
  }

  trackMaskEdit(editType: 'add' | 'remove' | 'reset'): void {
    this.trackUserAction('mask_edit', { editType });
  }

  trackPlacementAdjust(adjustType: 'move' | 'scale' | 'rotate'): void {
    this.trackUserAction('placement_adjust', { adjustType });
  }

  trackZoomPan(action: 'zoom_in' | 'zoom_out' | 'pan'): void {
    this.trackUserAction('zoom_pan', { action });
  }

  trackHelpClick(context: string): void {
    this.trackUserAction('help_click', { context, step: this.currentStep });
  }

  // ============================================
  // PRODUCT SETUP TRACKING (For merchant dashboard)
  // ============================================

  trackSetupStarted(productId: string): void {
    try {
      this.trackEvent('setup_started', { productId });
    } catch (err) {
      console.error('[Analytics] Failed to track setup start:', err);
    }
  }

  trackSetupCompleted(productId: string, metadata?: Record<string, unknown>): void {
    try {
      this.trackEvent('setup_completed', { productId, ...metadata });
    } catch (err) {
      console.error('[Analytics] Failed to track setup complete:', err);
    }
  }

  trackSetupAbandoned(productId: string, step: string): void {
    try {
      this.trackEvent('setup_abandoned', { productId, abandonedAt: step });
    } catch (err) {
      console.error('[Analytics] Failed to track setup abandoned:', err);
    }
  }

  trackImagePrepared(
    productId: string,
    method: 'auto' | 'manual' | 'hybrid',
    processingTimeMs: number,
    metadata?: Record<string, unknown>
  ): void {
    try {
      this.trackEvent('image_prepared', {
        productId,
        method,
        processingTimeMs,
        ...metadata,
      });
    } catch (err) {
      console.error('[Analytics] Failed to track image prepared:', err);
    }
  }

  // ============================================
  // INTERNAL METHODS
  // ============================================

  private trackEvent(type: string, data: Record<string, unknown>): void {
    try {
      const event: AnalyticsEvent = {
        type,
        sessionId: this.sessionId || undefined,
        shopDomain: this.config.shopDomain,
        data,
        timestamp: new Date().toISOString(),
        deviceContext: this.deviceContext || undefined,
      };

      this.eventQueue.push(event);

      if (this.eventQueue.length >= this.config.batchSize) {
        this.flush();
      }
    } catch (err) {
      // Fail silently - analytics should never break the app
      console.error('[Analytics] Failed to track event:', err);
    }
  }

  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events: eventsToSend }),
        keepalive: true, // Important for beforeunload
      });

      if (!response.ok) {
        // Put events back in queue on failure
        this.eventQueue = [...eventsToSend, ...this.eventQueue];
        this.log('Flush failed, events re-queued', response.status);
      } else {
        this.log('Flushed events', eventsToSend.length);
      }
    } catch (error) {
      // Put events back in queue on error
      this.eventQueue = [...eventsToSend, ...this.eventQueue];
      this.log('Flush error, events re-queued', error);
    }
  }

  private setupFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  private setupBeforeUnload(): void {
    window.addEventListener('beforeunload', () => {
      // Track abandonment if session active
      if (this.sessionId) {
        try {
          this.trackEvent('session_ended', {
            status: 'abandoned',
            durationMs: this.sessionStartedAt 
              ? Date.now() - this.sessionStartedAt.getTime() 
              : null,
            abandonmentStep: this.currentStep,
            reason: 'page_unload',
          });
        } catch (err) {
          console.error('[Analytics] Failed to track abandonment:', err);
        }
      }
      this.flush();
    });

    // Also handle visibility change (tab switch, app background)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flush();
      }
    });
  }

  private detectDeviceContext(): DeviceContext {
    const ua = navigator.userAgent;
    
    // Detect device type
    let deviceType: 'mobile' | 'tablet' | 'desktop' = 'desktop';
    if (/Mobi|Android/i.test(ua)) {
      deviceType = /iPad|Tablet/i.test(ua) ? 'tablet' : 'mobile';
    }

    // Detect OS
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

    // Detect browser
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

    // Detect capabilities
    const hasCamera = !!(navigator.mediaDevices?.getUserMedia);
    const hasGyroscope = 'DeviceOrientationEvent' in window;
    
    let webglSupport = false;
    try {
      const canvas = document.createElement('canvas');
      webglSupport = !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch {
      webglSupport = false;
    }

    // Connection type
    let connectionType = 'unknown';
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    if (connection?.effectiveType) {
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
      hasCamera,
      hasGyroscope,
      webglSupport,
      connectionType,
    };
  }

  private detectEntryPoint(): string {
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

  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `sess_${timestamp}_${randomPart}`;
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[SeeIt Analytics]', ...args);
    }
  }

  // ============================================
  // CLEANUP
  // ============================================

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }
}

// ============================================
// SINGLETON INSTANCE (Optional)
// ============================================

let analyticsInstance: SeeItAnalytics | null = null;

export function initAnalytics(config: AnalyticsConfig): SeeItAnalytics {
  if (analyticsInstance) {
    analyticsInstance.destroy();
  }
  analyticsInstance = new SeeItAnalytics(config);
  return analyticsInstance;
}

export function getAnalytics(): SeeItAnalytics | null {
  return analyticsInstance;
}

export default SeeItAnalytics;
