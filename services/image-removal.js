import { GoogleAuth } from 'google-auth-library';

export async function removeObject(projectId, imageBase64, maskBase64) {
    const LOCATION = "us-central1";
    const MODEL_ID = "imagen-3.0-capability-001";

    // 1. Authenticate (Updated for Railway/Base64 Env Var)
    let credentials;
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        // Decode the Base64 string from Railway
        const jsonString = Buffer.from(process.env.GOOGLE_CREDENTIALS_JSON, 'base64').toString('utf-8');
        credentials = JSON.parse(jsonString);
    }

    const auth = new GoogleAuth({
        credentials, // Pass the decoded credentials directly
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // 2. API Endpoint
    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;

    // 3. Payload
    const payload = {
        instances: [
            {
                prompt: "",
                referenceImages: [
                    {
                        referenceType: "REFERENCE_TYPE_RAW",
                        referenceImage: { bytesBase64Encoded: imageBase64 }
                    },
                    {
                        referenceType: "REFERENCE_TYPE_MASK",
                        referenceImage: { bytesBase64Encoded: maskBase64 },
                        maskImageConfig: {
                            maskMode: "MASK_MODE_USER_PROVIDED",
                            dilation: 0.03
                        }
                    }
                ]
            }
        ],
        parameters: {
            editMode: "EDIT_MODE_INPAINT_REMOVAL",
            sampleCount: 1,
            includeRaiReasoning: true
        }
    };

    // 4. Request
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Imagen API Failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // 5. Output
    if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
        return data.predictions[0].bytesBase64Encoded;
    } else {
        throw new Error("API returned no image. Check Safety/RAI filters.");
    }
}
