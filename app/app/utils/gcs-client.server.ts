import { Storage } from "@google-cloud/storage";

let storageInstance: Storage | null = null;

export function getGcsClient(): Storage {
    if (storageInstance) {
        return storageInstance;
    }

    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        try {
            let jsonString = process.env.GOOGLE_CREDENTIALS_JSON.trim();

            // Remove surrounding quotes if present
            if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
                jsonString = jsonString.slice(1, -1);
            }

            let credentials;
            try {
                // Try base64 decode first
                const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
                if (decoded.startsWith('{')) {
                    credentials = JSON.parse(decoded);
                } else {
                    credentials = JSON.parse(jsonString);
                }
            } catch {
                // Fall back to direct JSON parse
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

export const GCS_BUCKET = process.env.GCS_BUCKET || 'see-it-room';
