/**
 * Session Monitor - TypeScript Types
 */

export type StepName = 'room' | 'mask' | 'inpaint' | 'placement' | 'final';
export type SessionStatus = 'in_progress' | 'complete' | 'failed' | 'abandoned';

export interface StepEntry {
    step: StepName;
    status: 'success' | 'failed';
    at: string;
    sinceStartMs?: number;
    sincePrevMs?: number;
    durationMs?: number;
    processingTimeMs?: number;
    file?: string;
    files?: string[];
    model?: string;
    metadata?: Record<string, unknown>;
    error?: {
        code: string;
        message: string;
        retryCount?: number;
    };
}

export interface SessionMeta {
    sessionId: string;
    shop: string;
    userAgent?: string;
    device?: string;
    browser?: string;
    platform?: string;
    screenSize?: string;
    referrer?: string;
    productPageUrl?: string;
    startedAt: string;
    updatedAt: string;
    totalDurationMs?: number;
    status: SessionStatus;
    abandonedAt?: StepName;
    failedAt?: StepName;
    failureReason?: string;
    steps: StepEntry[];
    product?: {
        id?: string;
        title?: string;
        price?: string;
        hasAR?: boolean;
        isPrepared?: boolean;
    };
}

export interface ShopSessionEntry {
    sessionId: string;
    startedAt: string;
    status: SessionStatus;
    stepsCompleted: number;
}

export interface ShopIndex {
    shop: string;
    totalSessions: number;
    sessions: ShopSessionEntry[];
}

// Dashboard display types
export interface SessionCardData {
    sessionId: string;
    shop: string;
    status: SessionStatus;
    currentStep: StepName | null;
    stepsCompleted: number;
    latestImageUrl: string | null;
    updatedAt: string;
    startedAt: string;
    device?: string;
    browser?: string;
    productTitle?: string;
}

export interface FunnelData {
    step: StepName;
    count: number;
    percentage: number;
}

export interface ErrorSummary {
    code: string;
    count: number;
    lastOccurred: string;
    affectedShops: string[];
}

export interface ShopStats {
    shop: string;
    totalSessions: number;
    completedSessions: number;
    failedSessions: number;
    completionRate: number;
    avgDurationMs: number;
}
