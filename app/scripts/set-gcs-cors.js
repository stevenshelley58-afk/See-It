#!/usr/bin/env node
/**
 * Script to set CORS configuration on the GCS bucket
 * Run with: node scripts/set-gcs-cors.js
 */

import { Storage } from '@google-cloud/storage';

const CORS_CONFIG = [
    {
        origin: [
            "https://*.myshopify.com",
            "https://see-it-production.up.railway.app"
        ],
        method: ["GET", "HEAD", "PUT", "POST", "DELETE", "OPTIONS"],
        responseHeader: ["Content-Type", "x-goog-resumable", "Content-Length", "Access-Control-Allow-Origin"],
        maxAgeSeconds: 3600
    }
];

async function setCors() {
    const bucketName = process.env.GCS_BUCKET || 'see-it-room';
    
    let storage;
    
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
                credentials = JSON.parse(jsonString);
            }
            
            storage = new Storage({ credentials });
            console.log('Using credentials from GOOGLE_CREDENTIALS_JSON');
        } catch (error) {
            console.error('Failed to parse credentials:', error.message);
            storage = new Storage();
        }
    } else {
        storage = new Storage();
        console.log('Using default credentials');
    }
    
    const bucket = storage.bucket(bucketName);
    
    console.log(`Setting CORS on bucket: ${bucketName}`);
    console.log('CORS config:', JSON.stringify(CORS_CONFIG, null, 2));
    
    try {
        await bucket.setCorsConfiguration(CORS_CONFIG);
        console.log(`\n✅ CORS configuration set successfully on gs://${bucketName}`);
        
        // Verify by reading back
        const [metadata] = await bucket.getMetadata();
        console.log('\nVerified CORS config:', JSON.stringify(metadata.cors, null, 2));
    } catch (error) {
        console.error('\n❌ Failed to set CORS:', error.message);
        if (error.code === 403) {
            console.error('Permission denied. The service account may not have storage.buckets.update permission.');
        }
        process.exit(1);
    }
}

setCors();

