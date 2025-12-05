/**
 * Type declarations for @imgly/background-removal-node
 * This package doesn't ship with TypeScript types
 */

declare module '@imgly/background-removal-node' {
    export interface RemoveBackgroundOptions {
        output?: {
            format?: 'image/png' | 'image/jpeg' | 'image/webp';
            quality?: number;
        };
        model?: 'small' | 'medium' | 'large';
        debug?: boolean;
    }

    /**
     * Removes the background from an image buffer
     * @param input - Image buffer or URL
     * @param options - Configuration options
     * @returns Promise<Blob> - The processed image with transparent background
     */
    export function removeBackground(
        input: Buffer | ArrayBuffer | Uint8Array | string,
        options?: RemoveBackgroundOptions
    ): Promise<Blob>;
}
