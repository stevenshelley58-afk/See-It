/**
 * GCS Client for Session Monitor Dashboard
 * Read-only access to see-it-sessions bucket
 */

import { Storage } from '@google-cloud/storage';
import type { SessionMeta, ShopIndex, SessionCardData, FunnelData, ErrorSummary, ShopStats } from './types';

const PROJECT_ID = process.env.GCS_PROJECT_ID;
const SESSION_BUCKET = process.env.GCS_SESSION_BUCKET || 'see-it-sessions';

let storageInstance: Storage | null = null;

function getStorage(): Storage {
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
    const { limit = 50, status, shop } = options;

    try {
        // List session directories
        const [files] = await bucket.getFiles({
            prefix: 'sessions/',
            delimiter: '/',
        });

        // Get meta.json for each session
        const sessions: SessionCardData[] = [];

        // Get prefixes (session directories)
        const [, , apiResponse] = await bucket.getFiles({
            prefix: 'sessions/',
            delimiter: '/',
            autoPaginate: false,
        });

        const prefixes = (apiResponse as { prefixes?: string[] })?.prefixes || [];

        for (const prefix of prefixes.slice(0, limit * 2)) {
            try {
                const metaFile = bucket.file(`${prefix}meta.json`);
                const [exists] = await metaFile.exists();
                if (!exists) continue;

                const [content] = await metaFile.download();
                const meta: SessionMeta = JSON.parse(content.toString());

                // Apply filters
                if (status && meta.status !== status) continue;
                if (shop && meta.shop !== shop) continue;

                const lastStep = meta.steps[meta.steps.length - 1];
                const latestFile = lastStep?.file || lastStep?.files?.[0];

                sessions.push({
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
                });

                if (sessions.length >= limit) break;
            } catch (error) {
                console.error(`Failed to read session ${prefix}:`, error);
            }
        }

        // Sort by updatedAt descending
        sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        return sessions;
    } catch (error) {
        console.error('[GCS] Failed to list sessions:', error);
        return [];
    }
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
