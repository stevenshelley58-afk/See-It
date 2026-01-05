# Vercel Deployment Configuration

## Root Directory Setting

This Next.js app is located in the `see-it-monitor` subdirectory of the repository.

**You must configure Vercel to use `see-it-monitor` as the Root Directory:**

1. Go to your Vercel project settings
2. Navigate to **Settings** → **General**
3. Under **Root Directory**, click **Edit**
4. Set it to: `see-it-monitor`
5. Save

This tells Vercel where to find the `package.json` and Next.js app.

## Environment Variables

Set these in Vercel → Settings → Environment Variables:

- `GOOGLE_CREDENTIALS_JSON` - Base64-encoded or raw JSON service account credentials
- `GCS_SESSION_BUCKET` - (optional) Defaults to `see-it-sessions`
- `GCS_PROJECT_ID` - (optional) GCP project ID
- `GCS_CLIENT_EMAIL` - (optional) Alternative credential format
- `GCS_PRIVATE_KEY` - (optional) Alternative credential format

## Build Settings

Vercel should auto-detect Next.js, but if needed:
- Framework Preset: **Next.js**
- Build Command: `npm run build` (or leave empty for auto-detect)
- Output Directory: `.next` (auto-detected)
- Install Command: `npm install` (auto-detected)
