/**
 * GCS Client for Session Monitor Dashboard
 * Read-only access to see-it-sessions bucket
 */

import { Storage } from '@google-cloud/storage';
import type { SessionMeta, ShopIndex, SessionCardData, FunnelData, ErrorSummary, ShopStats } from './types';
import crypto from 'crypto';

const PROJECT_ID = process.env.GCS_PROJECT_ID;
const SESSION_BUCKET = process.env.GCS_SESSION_BUCKET || 'see-it-sessions';

let storageInstance: Storage | null = null;

export function getStorage(): Storage {
    if (storageInstance) return storageInstance;

    if (process.env.GCS_PRIVATE_KEY && process.env.GCS_CLIENT_EMAIL) {
        storageInstance = new Storage({
            projectId: PROJECT_ID,
            credentials: {
                client_email: process.env.GCS_CLIENT_EMAIL,
                private_key: process.env.GCS_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
        });
    } else if (process.env.GOOGLE_CREDENTIALS_JSON) {
        try {
            let jsonString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
            if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
                jsonString = jsonString.slice(1, -1);
            }
            let credentials;
            try {
                const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
                if (decoded.startsWith('{')) {
                    credentials = JSON.parse(decoded);
                } else {
                    credentials = JSON.parse(jsonString);
                }
            } catch {
                credentials = JSON.parse(jsonString);
            }
            storageInstance = new Storage({ credentials });
        } catch (error) {
            console.error('[GCS] Failed to parse credentials:', error);
            storageInstance = new Storage();
        }
    } else {
        storageInstance = new Storage();
    }

    return storageInstance;
}

/**
 * List all sessions with pagination
 */
export async function listSessions(options: {
    limit?: number;
    offset?: number;
    status?: string;
    shop?: string;
}): Promise<SessionCardData[]> {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);
    const { limit = 50, offset = 0, status, shop } = options;

    try {
        // Check if bucket exists first
        const [bucketExists] = await bucket.exists();
        if (!bucketExists) {
            console.warn(`[GCS] Bucket ${SESSION_BUCKET} does not exist`);
            return [];
        }

        // IMPORTANT: GCS "prefix" listing is not time-ordered. We must load metas, sort,
        // and only then apply pagination. Otherwise the UI can look unsorted / miss new sessions.
        const [files] = await bucket.getFiles({ prefix: 'sessions/' });
        const metaFiles = files.filter((f) => f.name.endsWith('/meta.json'));

        // Cap worst-case work to keep Vercel functions healthy.
        // If you exceed this, consider adding a precomputed index file in GCS.
        const MAX_META_FILES_TO_SCAN = 5000;
        const metaFileNames = metaFiles.slice(0, MAX_META_FILES_TO_SCAN).map((f) => f.name);

        const metas: Array<{ prefix: string; meta: SessionMeta }> = [];

        // Download/parse meta.json with modest concurrency
        const CONCURRENCY = 10;
        let idx = 0;

        async function worker() {
            while (idx < metaFileNames.length) {
                const myIdx = idx++;
                const name = metaFileNames[myIdx];
                try {
                    const [content] = await bucket.file(name).download();
                    const meta: SessionMeta = JSON.parse(content.toString());
                    if (status && meta.status !== status) continue;
                    if (shop && meta.shop !== shop) continue;
                    const prefix = name.replace(/meta\.json$/, '');
                    metas.push({ prefix, meta });
                } catch (error) {
                    console.error(`Failed to read session meta ${name}:`, error);
                }
            }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, metaFileNames.length) }, () => worker()));

        metas.sort((a, b) => new Date(b.meta.updatedAt).getTime() - new Date(a.meta.updatedAt).getTime());

        const page = metas.slice(offset, offset + limit);

        return await Promise.all(
            page.map(async ({ prefix, meta }) => {
                const lastStep = meta.steps[meta.steps.length - 1];
                const latestFile = lastStep?.file || lastStep?.files?.[0];
                return {
                    sessionId: meta.sessionId,
                    shop: meta.shop,
                    status: meta.status,
                    currentStep: lastStep?.step || null,
                    stepsCompleted: meta.steps.filter(s => s.status === 'success').length,
                    latestImageUrl: latestFile ? await getSignedUrl(`${prefix}${latestFile}`) : null,
                    updatedAt: meta.updatedAt,
                    startedAt: meta.startedAt,
                    device: meta.device,
                    browser: meta.browser,
                    productTitle: meta.product?.title,
                };
            })
        );
    } catch (error) {
        console.error('[GCS] Failed to list sessions:', error);
        return [];
    }
}

export async function getGcsSessionHealthSummary(): Promise<{
    bucketName: string;
    bucketExists: boolean;
    metaFileCount: number;
}> {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);
    const [bucketExists] = await bucket.exists();
    if (!bucketExists) {
        return { bucketName: SESSION_BUCKET, bucketExists: false, metaFileCount: 0 };
    }
    const [files] = await bucket.getFiles({ prefix: 'sessions/', maxResults: 2000 });
    const metaFileCount = files.filter((f) => f.name.endsWith('/meta.json')).length;
    return { bucketName: SESSION_BUCKET, bucketExists: true, metaFileCount };
}

export type AnalyticsEventForStorage = {
    type: string;
    sessionId?: string;
    shopDomain: string;
    data: Record<string, unknown>;
    timestamp: string;
    deviceContext?: Record<string, unknown>;
};

export async function writeAnalyticsEventsToGcs(args: {
    events: AnalyticsEventForStorage[];
    requestInfo?: {
        origin?: string | null;
        userAgent?: string | null;
        ip?: string | null;
    };
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    try {
        const storage = getStorage();
        const bucket = storage.bucket(SESSION_BUCKET);

        const [bucketExists] = await bucket.exists();
        if (!bucketExists) {
            return { ok: false, error: `Bucket ${SESSION_BUCKET} does not exist` };
        }

        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');

        const nonce = crypto.randomBytes(8).toString('hex');
        const filePath = `analytics/events/${y}/${m}/${d}/${now.toISOString()}_${nonce}.json`;

        const payload = {
            serverTimestamp: now.toISOString(),
            request: {
                origin: args.requestInfo?.origin || null,
                userAgent: args.requestInfo?.userAgent || null,
                ip: args.requestInfo?.ip || null,
            },
            events: args.events,
        };

        await bucket.file(filePath).save(JSON.stringify(payload), {
            contentType: 'application/json',
            resumable: false,
        });

        return { ok: true, path: filePath };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
    }
}

type StoredAnalyticsBatch = {
    serverTimestamp: string;
    request?: {
        origin?: string | null;
        userAgent?: string | null;
        ip?: string | null;
    };
    events: AnalyticsEventForStorage[];
};

export type AnalyticsDerivedSession = {
    sessionId: string;
    shopDomain: string;
    productTitle: string | null;
    status: 'in_progress' | 'completed' | 'abandoned' | 'failed';
    currentStep: string | null;
    stepsCompleted: number;
    startedAt: string;
    updatedAt: string;
    endedAt: string | null;
    deviceType: string | null;
    browser: string | null;
};

export type AnalyticsDerivedError = {
    id: string;
    sessionId: string | null;
    shopDomain: string | null;
    errorCode: string;
    errorMessage: string;
    severity: string;
    occurredAt: string;
};

async function listRecentAnalyticsBatchFiles(args: {
    daysBack: number; // inclusive of today (0 = today only)
    maxFilesTotal: number;
}): Promise<string[]> {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);

    const [bucketExists] = await bucket.exists();
    if (!bucketExists) return [];

    const files: string[] = [];
    const now = new Date();

    for (let i = 0; i <= args.daysBack; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        d.setUTCDate(d.getUTCDate() - i);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const prefix = `analytics/events/${y}/${m}/${day}/`;

        try {
            const [dayFiles] = await bucket.getFiles({
                prefix,
                maxResults: Math.min(500, args.maxFilesTotal),
                autoPaginate: false,
            });
            for (const f of dayFiles) {
                if (f.name.endsWith('.json')) files.push(f.name);
            }
        } catch (err) {
            console.warn('[GCS] Failed listing analytics events for prefix', prefix, err);
        }
    }

    // Filenames include ISO timestamps, so lexicographic sort works for recency within the day prefix.
    files.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return files.slice(0, args.maxFilesTotal);
}

async function readAnalyticsBatch(fileName: string): Promise<StoredAnalyticsBatch | null> {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);
    try {
        const [content] = await bucket.file(fileName).download();
        const parsed: unknown = JSON.parse(content.toString());
        const batch = parsed as Partial<StoredAnalyticsBatch>;
        if (!batch || !Array.isArray(batch.events)) return null;
        return {
            serverTimestamp: typeof batch.serverTimestamp === 'string' ? batch.serverTimestamp : new Date().toISOString(),
            request: batch.request,
            events: batch.events,
        };
    } catch (err) {
        console.warn('[GCS] Failed reading analytics batch', fileName, err);
        return null;
    }
}

/**
 * Derive "sessions" from stored analytics event batches in GCS.
 * This is a fallback path when Postgres isn't migrated and GCS session meta files aren't available.
 */
export async function deriveSessionsFromAnalytics(args: {
    daysBack?: number;
    maxFilesTotal?: number;
    lookbackMs?: number;
}): Promise<{ sessions: AnalyticsDerivedSession[]; recentErrors: AnalyticsDerivedError[] }> {
    const daysBack = args.daysBack ?? 2;
    const maxFilesTotal = args.maxFilesTotal ?? 200;
    const lookbackMs = args.lookbackMs ?? 24 * 60 * 60 * 1000;

    const cutoff = Date.now() - lookbackMs;

    const files = await listRecentAnalyticsBatchFiles({ daysBack, maxFilesTotal });
    if (files.length === 0) return { sessions: [], recentErrors: [] };

    const CONCURRENCY = 10;
    let idx = 0;
    const batches: StoredAnalyticsBatch[] = [];

    async function worker() {
        while (idx < files.length) {
            const myIdx = idx++;
            const fileName = files[myIdx];
            const batch = await readAnalyticsBatch(fileName);
            if (batch) batches.push(batch);
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()));

    type InternalSession = AnalyticsDerivedSession & {
        completedSteps: Set<string>;
    };

    const sessionMap = new Map<string, InternalSession>();
    const recentErrors: AnalyticsDerivedError[] = [];

    for (const batch of batches) {
        for (const e of batch.events) {
            const ts = Date.parse(e.timestamp);
            if (!Number.isFinite(ts) || ts < cutoff) continue;

            const sessionId = e.sessionId || null;
            const shopDomain = e.shopDomain;

            if (e.type === 'error') {
                const data = e.data as Partial<{
                    errorCode: string;
                    errorMessage: string;
                    severity: string;
                }>;
                recentErrors.push({
                    id: `gcs_err_${ts}_${Math.random().toString(16).slice(2)}`,
                    sessionId,
                    shopDomain: shopDomain || null,
                    errorCode: data.errorCode || 'UNKNOWN_ERROR',
                    errorMessage: data.errorMessage || 'Unknown error',
                    severity: data.severity || 'error',
                    occurredAt: e.timestamp,
                });
            }

            if (!sessionId) continue;

            const existing = sessionMap.get(sessionId);
            const base: InternalSession =
                existing ||
                ({
                    sessionId,
                    shopDomain,
                    productTitle: null,
                    status: 'in_progress',
                    currentStep: null,
                    stepsCompleted: 0,
                    startedAt: e.timestamp,
                    updatedAt: e.timestamp,
                    endedAt: null,
                    deviceType: (e.deviceContext as Partial<{ deviceType?: string }> | undefined)?.deviceType || null,
                    browser: (e.deviceContext as Partial<{ browser?: string }> | undefined)?.browser || null,
                    completedSteps: new Set<string>(),
                } as InternalSession);

            // Keep earliest start and latest update
            if (Date.parse(base.startedAt) > ts) base.startedAt = e.timestamp;
            if (Date.parse(base.updatedAt) < ts) base.updatedAt = e.timestamp;

            // Update optional device/browser when present
            const deviceType = (e.deviceContext as Partial<{ deviceType?: string }> | undefined)?.deviceType;
            const browser = (e.deviceContext as Partial<{ browser?: string }> | undefined)?.browser;
            if (deviceType) base.deviceType = deviceType;
            if (browser) base.browser = browser;

            if (e.type === 'session_started') {
                const data = e.data as Partial<{ productTitle?: string }>;
                if (typeof data.productTitle === 'string') base.productTitle = data.productTitle;
            }

            if (e.type === 'step_update') {
                const data = e.data as Partial<{ step?: string; status?: string }>;
                if (typeof data.step === 'string') base.currentStep = data.step;
                if (data.status === 'completed' && typeof data.step === 'string') {
                    if (!base.completedSteps.has(data.step)) {
                        base.completedSteps.add(data.step);
                        base.stepsCompleted = base.completedSteps.size;
                    }
                }
            }

            if (e.type === 'session_ended') {
                const data = e.data as Partial<{ status?: string }>;
                if (data.status === 'completed') base.status = 'completed';
                else if (data.status === 'abandoned') base.status = 'abandoned';
                else base.status = 'failed';
                base.endedAt = e.timestamp;
            }

            sessionMap.set(sessionId, base);
        }
    }

    // Only keep errors within the lookback window and sort newest-first
    recentErrors.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

    const sessions: AnalyticsDerivedSession[] = Array.from(sessionMap.values())
        .map(({ completedSteps, ...s }) => s)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    return { sessions, recentErrors };
}

/**
 * Get a single session by ID
 */
export async function getSession(sessionId: string): Promise<SessionMeta | null> {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);

    try {
        const metaFile = bucket.file(`sessions/${sessionId}/meta.json`);
        const [exists] = await metaFile.exists();
        if (!exists) return null;

        const [content] = await metaFile.download();
        return JSON.parse(content.toString());
    } catch (error) {
        console.error(`[GCS] Failed to get session ${sessionId}:`, error);
        return null;
    }
}

/**
 * Get signed URL for a file
 */
export async function getSignedUrl(key: string, expiresInMs: number = 60 * 60 * 1000): Promise<string> {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);
    const file = bucket.file(key);

    const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresInMs,
    });

    return url;
}

/**
 * Get active sessions (updated in last 10 minutes)
 */
export async function getActiveSessions(): Promise<SessionCardData[]> {
    const sessions = await listSessions({ limit: 100 });
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

    return sessions.filter(s =>
        s.status === 'in_progress' &&
        new Date(s.updatedAt).getTime() > tenMinutesAgo
    );
}

/**
 * Get funnel data for stats
 */
export async function getFunnelData(sessions: SessionMeta[]): Promise<FunnelData[]> {
    const steps: Array<'room' | 'mask' | 'inpaint' | 'placement' | 'final'> = ['room', 'mask', 'inpaint', 'placement', 'final'];
    const total = sessions.length || 1;

    return steps.map(step => {
        const count = sessions.filter(s =>
            s.steps.some(st => st.step === step && st.status === 'success')
        ).length;
        return {
            step,
            count,
            percentage: Math.round((count / total) * 100),
        };
    });
}

/**
 * Get error summary
 */
export async function getErrorSummary(sessions: SessionMeta[]): Promise<ErrorSummary[]> {
    const errorMap = new Map<string, ErrorSummary>();

    for (const session of sessions) {
        for (const step of session.steps) {
            if (step.error) {
                const existing = errorMap.get(step.error.code);
                if (existing) {
                    existing.count++;
                    if (!existing.affectedShops.includes(session.shop)) {
                        existing.affectedShops.push(session.shop);
                    }
                    if (new Date(step.at) > new Date(existing.lastOccurred)) {
                        existing.lastOccurred = step.at;
                    }
                } else {
                    errorMap.set(step.error.code, {
                        code: step.error.code,
                        count: 1,
                        lastOccurred: step.at,
                        affectedShops: [session.shop],
                    });
                }
            }
        }
    }

    return Array.from(errorMap.values()).sort((a, b) => b.count - a.count);
}

/**
 * Get shop stats
 */
export async function getShopStats(sessions: SessionMeta[]): Promise<ShopStats[]> {
    const shopMap = new Map<string, SessionMeta[]>();

    for (const session of sessions) {
        const existing = shopMap.get(session.shop) || [];
        existing.push(session);
        shopMap.set(session.shop, existing);
    }

    return Array.from(shopMap.entries()).map(([shop, shopSessions]) => {
        const completed = shopSessions.filter(s => s.status === 'complete').length;
        const failed = shopSessions.filter(s => s.status === 'failed').length;
        const totalDuration = shopSessions.reduce((sum, s) => sum + (s.totalDurationMs || 0), 0);

        return {
            shop,
            totalSessions: shopSessions.length,
            completedSessions: completed,
            failedSessions: failed,
            completionRate: Math.round((completed / shopSessions.length) * 100),
            avgDurationMs: Math.round(totalDuration / shopSessions.length),
        };
    }).sort((a, b) => b.totalSessions - a.totalSessions);
}

/**
 * Get shop index
 */
export async function getShopIndex(shopDomain: string): Promise<ShopIndex | null> {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);

    try {
        const indexFile = bucket.file(`shops/${shopDomain}/sessions.json`);
        const [exists] = await indexFile.exists();
        if (!exists) return null;

        const [content] = await indexFile.download();
        return JSON.parse(content.toString());
    } catch (error) {
        console.error(`[GCS] Failed to get shop index ${shopDomain}:`, error);
        return null;
    }
}

/**
 * List all shops from shop index files in GCS
 */
export async function listAllShops(): Promise<ShopIndex[]> {
    const storage = getStorage();
    const bucket = storage.bucket(SESSION_BUCKET);

    try {
        const [bucketExists] = await bucket.exists();
        if (!bucketExists) {
            return [];
        }

        // Get prefixes (shop directories)
        const [, , apiResponse] = await bucket.getFiles({
            prefix: 'shops/',
            delimiter: '/',
            autoPaginate: false,
        });

        const prefixes = (apiResponse as { prefixes?: string[] })?.prefixes || [];
        const shops: ShopIndex[] = [];

        for (const prefix of prefixes) {
            // Extract shop domain from prefix (e.g., "shops/example.myshopify.com/" -> "example.myshopify.com")
            const shopDomain = prefix.replace('shops/', '').replace('/', '');
            if (!shopDomain) continue;

            try {
                const index = await getShopIndex(shopDomain);
                if (index) {
                    shops.push(index);
                }
            } catch (error) {
                console.error(`[GCS] Failed to read shop index for ${shopDomain}:`, error);
            }
        }

        return shops.sort((a, b) => b.totalSessions - a.totalSessions);
    } catch (error) {
        console.error('[GCS] Failed to list shops:', error);
        return [];
    }
}
