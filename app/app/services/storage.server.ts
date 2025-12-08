import { Storage } from '@google-cloud/storage';

// Initialize GCS client with credentials from environment variable
// Railway stores the JSON as a string in GOOGLE_CREDENTIALS_JSON
let storage: Storage;

if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
        // Railway may wrap in quotes - remove them if present
        let jsonString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
        if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
            jsonString = jsonString.slice(1, -1);
        }
        
        // Try base64 decode first (if Railway truncates, use base64)
        let credentials;
        try {
            const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
            if (decoded.startsWith('{')) {
                // Valid JSON after base64 decode
                credentials = JSON.parse(decoded);
                console.log('[Storage] Decoded GOOGLE_CREDENTIALS_JSON from base64');
            } else {
                // Not base64, parse as direct JSON
                credentials = JSON.parse(jsonString);
                console.log('[Storage] Parsed GOOGLE_CREDENTIALS_JSON as direct JSON');
            }
        } catch {
            // Fallback: try direct JSON parse
            credentials = JSON.parse(jsonString);
            console.log('[Storage] Parsed GOOGLE_CREDENTIALS_JSON as direct JSON (base64 failed)');
        }
        
        storage = new Storage({ credentials });
        console.log('[Storage] Successfully initialized with GOOGLE_CREDENTIALS_JSON');
    } catch (error) {
        console.error('[Storage] Failed to parse GOOGLE_CREDENTIALS_JSON:', error instanceof Error ? error.message : error);
        console.error(`[Storage] JSON length: ${process.env.GOOGLE_CREDENTIALS_JSON?.length || 0}`);
        // Security: DO NOT log credential content, even partial
        console.error('[Storage] Falling back to default credentials (may fail)');
        storage = new Storage();
    }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // File path to credentials (local dev)
    storage = new Storage();
    console.log('[Storage] Using GOOGLE_APPLICATION_CREDENTIALS file');
} else {
    console.warn('[Storage] No GCS credentials found - uploads will fail');
    storage = new Storage();
}

const GCS_BUCKET = process.env.GCS_BUCKET || 'see-it-room';

// Log configuration on module load
console.log(`[Storage] GCS Bucket: ${GCS_BUCKET}`);
console.log(`[Storage] Credentials: ${process.env.GOOGLE_CREDENTIALS_JSON ? 'GOOGLE_CREDENTIALS_JSON' : process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'GOOGLE_APPLICATION_CREDENTIALS file' : 'DEFAULT (may fail)'}`);

export class StorageService {
    /**
     * Generate a presigned URL for direct upload to GCS
     * Also returns the public URL where the file will be accessible
     */
    static async getPresignedUploadUrl(shopId: string, roomSessionId: string, filename: string, contentType: string = 'image/jpeg') {
        const bucket = storage.bucket(GCS_BUCKET);
        const key = `rooms/${shopId}/${roomSessionId}/${filename}`;
        const file = bucket.file(key);

        // Generate a signed URL for uploading (PUT request)
        const [uploadUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // 15 minutes
            contentType: contentType,
        });

        // Generate the public URL (assuming bucket has public access or we use signed read URLs)
        // For simplicity, generate a long-lived signed read URL
        const [publicUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        });

        console.log(`[Storage] Generated presigned URLs for ${key}`);
        
        return { 
            uploadUrl, 
            publicUrl,
            bucket: GCS_BUCKET,
            key 
        };
    }

    /**
     * Get a signed read URL for an existing file
     */
    static async getSignedReadUrl(key: string, expiresInMs: number = 60 * 60 * 1000) {
        const bucket = storage.bucket(GCS_BUCKET);
        const file = bucket.file(key);

        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + expiresInMs,
        });

        return url;
    }

    /**
     * Check if a file exists in the bucket
     */
    static async fileExists(key: string): Promise<boolean> {
        const bucket = storage.bucket(GCS_BUCKET);
        const file = bucket.file(key);
        const [exists] = await file.exists();
        return exists;
    }
}
