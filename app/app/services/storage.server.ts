import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";

const storage = getGcsClient();

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

    /**
     * Upload a buffer directly to GCS
     * Returns a signed read URL for the uploaded file
     */
    static async uploadBuffer(
        buffer: Buffer,
        key: string,
        contentType: string = 'image/png'
    ): Promise<string> {
        const bucket = storage.bucket(GCS_BUCKET);
        const file = bucket.file(key);

        await file.save(buffer, {
            contentType,
            resumable: false,
        });

        // Return a signed read URL (1 hour expiry)
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000,
        });

        return url;
    }
}
