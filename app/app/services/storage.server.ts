import { Storage } from '@google-cloud/storage';

// Initialize GCS client
// In Cloud Run/Railway, credentials come from GOOGLE_APPLICATION_CREDENTIALS env var
// or from the service account attached to the compute instance
const storage = new Storage();

const GCS_BUCKET = process.env.GCS_BUCKET || 'see-it-uploads';

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
