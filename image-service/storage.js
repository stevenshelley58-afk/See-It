import { Storage } from '@google-cloud/storage';

// Initialize GCS client with credentials from environment variable
// Cloud Run/Railway stores the JSON as a string in GOOGLE_CREDENTIALS_JSON
let storage;

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
        console.error('[Storage] Failed to parse GOOGLE_CREDENTIALS_JSON:', error.message);
        console.error(`[Storage] JSON length: ${process.env.GOOGLE_CREDENTIALS_JSON?.length || 0}`);
        console.error(`[Storage] First 100 chars: ${process.env.GOOGLE_CREDENTIALS_JSON?.substring(0, 100)}`);
        console.error('[Storage] Falling back to default credentials (may fail)');
        storage = new Storage();
    }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // File path to credentials (local dev or Cloud Run with mounted secret)
    storage = new Storage();
    console.log('[Storage] Using credentials from GOOGLE_APPLICATION_CREDENTIALS file');
} else {
    console.warn('[Storage] No GCS credentials found - using default (may fail)');
    storage = new Storage();
}

export async function downloadToBuffer(url) {
    console.log(`Downloading from: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

export async function uploadBufferToGCS(bucketName, key, buffer, contentType) {
    console.log(`Uploading to bucket: ${bucketName}, key: ${key}`);
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(key);

    await file.save(buffer, {
        contentType: contentType,
        resumable: false
    });

    // Make the file publicly accessible or generate a signed URL
    const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    console.log(`Generated signed URL: ${signedUrl}`);
    return signedUrl;
}
