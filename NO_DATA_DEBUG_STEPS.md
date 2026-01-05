# Debug: Dashboard Shows No Data

## Problem Found
Build logs show: `[GCS] Failed to list sessions: Error: The specified bucket does not exist.`

## Issues to Fix

### 1. Set Environment Variables in Vercel

Go to Vercel Dashboard → see-it-monitor project → Settings → Environment Variables

Add these variables:

**Required:**
- `GOOGLE_CREDENTIALS_JSON` - Your Google Cloud service account JSON (base64-encoded or raw JSON string)

**Optional:**
- `GCS_SESSION_BUCKET` - Defaults to `see-it-sessions` if not set
- `GCS_PROJECT_ID` - Your GCP project ID

### 2. Verify GCS Bucket Exists

The bucket `see-it-sessions` must exist and your service account must have access to it.

**Check if bucket exists:**
```bash
gsutil ls gs://see-it-sessions/
```

**If bucket doesn't exist, create it:**
```bash
gsutil mb gs://see-it-sessions/
```

**Grant access to service account:**
```bash
gsutil iam ch serviceAccount:YOUR_SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com:objectViewer gs://see-it-sessions
```

### 3. Service Account Permissions Needed

Your service account needs these permissions:
- `storage.buckets.get` - To check if bucket exists
- `storage.objects.list` - To list sessions
- `storage.objects.get` - To read session files

Or grant the role: `Storage Object Viewer`

### 4. Test Health Endpoint

After setting environment variables, test:
```
https://see-it-monitor.vercel.app/api/health
```

This will tell you:
- If GCS is connected
- If bucket exists
- How many sessions found

### 5. Check if Sessions Are Being Logged

The dashboard can't show data if sessions aren't being logged. Check:

1. **See It App (Railway) logs** - Look for `[SessionLogger]` messages
2. **GCS bucket** - Manually check if files exist:
   ```bash
   gsutil ls -r gs://see-it-sessions/sessions/
   ```

## Next Steps

1. ✅ Set `GOOGLE_CREDENTIALS_JSON` in Vercel
2. ✅ Verify bucket `see-it-sessions` exists
3. ✅ Verify service account has permissions
4. ✅ Test `/api/health` endpoint
5. ✅ Do a test session in See It app and verify it's logged
6. ✅ Check dashboard again

## After Fixing Environment Variables

You'll need to **redeploy** after adding environment variables:
- Vercel will auto-redeploy, OR
- Go to Deployments → Click "..." → Redeploy
