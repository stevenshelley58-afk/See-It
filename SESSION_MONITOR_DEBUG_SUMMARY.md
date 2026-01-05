# Session Monitor Debug Summary

## What Was Fixed

### 1. ✅ Session Logger Already Exists
The session logger (`app/app/services/session-logger.server.ts`) already exists and is properly implemented. It:
- Logs to GCS bucket `see-it-sessions` (configurable via `GCS_SESSION_BUCKET` env var)
- Uses fire-and-forget pattern (never blocks user flows)
- Stores session data as `sessions/{sessionId}/meta.json` with all steps
- Uploads images: `01_room.jpg`, `02_mask.png`, `03_inpaint.jpg`, etc.
- Is called from:
  - `app-proxy.room.confirm.ts` - logs 'room' step
  - `app-proxy.room.cleanup.ts` - logs 'mask' and 'inpaint' steps
  - `app-proxy.render.ts` - logs 'placement' and 'final' steps

### 2. ✅ Dashboard Already Exists
The dashboard (`see-it-monitor`) already exists with full functionality:
- Main page showing active and recent sessions
- Session detail pages
- Shop and stats pages
- Proper GCS integration

### 3. ✅ Added Health & Resync Endpoints
Added two new API endpoints to the dashboard:

**GET `/api/health`**
- Returns GCS connection status
- Number of sessions found
- Latest session timestamp
- Quick way to verify everything is connected

**POST `/api/resync`**
- Scans GCS bucket for all sessions
- Rebuilds session index
- Useful if data gets out of sync

## Next Steps to Debug "No Data Showing"

### Step 1: Check GCS Bucket Exists
```bash
# Run the check script
node check_sessions_gcs.js

# Or manually with gsutil
gsutil ls gs://see-it-sessions/
gsutil ls gs://see-it-sessions/sessions/
```

If bucket doesn't exist:
- The session logger will try to create it automatically
- Or create manually: `gsutil mb gs://see-it-sessions`

### Step 2: Verify Environment Variables

**In See It App (Railway):**
- `GCS_SESSION_BUCKET=see-it-sessions` (or default)
- `GOOGLE_CREDENTIALS_JSON` - Service account JSON (base64 or raw)

**In Dashboard (Vercel):**
- `GCS_SESSION_BUCKET=see-it-sessions` (or default)
- `GOOGLE_CREDENTIALS_JSON` - Service account JSON (base64 or raw)
- Optional: `GCS_PROJECT_ID` - GCP project ID
- Optional: `GCS_CLIENT_EMAIL` and `GCS_PRIVATE_KEY` - Alternative credential format

### Step 3: Test Session Logging

1. Do a test session in See It app:
   - Upload a room image
   - Confirm room
   - Do cleanup (mask/inpaint)
   - Place a product
   - Render final image

2. Watch Railway logs for session logger messages:
   ```
   [SessionLogger] Logged room step for session {id}
   [SessionLogger] Logged mask step for session {id}
   [SessionLogger] Logged inpaint step for session {id}
   [SessionLogger] Logged placement step for session {id}
   [SessionLogger] Logged final step for session {id}
   ```

3. Check GCS bucket for new files:
   ```bash
   gsutil ls -r gs://see-it-sessions/sessions/
   ```

### Step 4: Test Dashboard

1. Visit health endpoint: `https://see-it-monitor.vercel.app/api/health`
   - Should show `gcsConnected: true`
   - Should show `sessionCount: > 0` if sessions exist

2. Visit main dashboard: `https://see-it-monitor.vercel.app/`
   - Should list sessions if they exist

3. If no sessions, try resync: `POST https://see-it-monitor.vercel.app/api/resync`

### Step 5: Common Issues

**Issue: Bucket doesn't exist**
- Session logger tries to create it, but needs proper permissions
- Create manually with proper IAM permissions

**Issue: Wrong credentials format**
- `GOOGLE_CREDENTIALS_JSON` must be either:
  - Base64-encoded JSON string, OR
  - Raw JSON string (properly escaped)
- Check Vercel/Railway env vars are set correctly

**Issue: Permissions**
- Service account needs:
  - `storage.buckets.get` (to check bucket exists)
  - `storage.buckets.create` (if auto-creating bucket)
  - `storage.objects.create` (to write session data)
  - `storage.objects.get` (to read session data)
  - `storage.objects.list` (to list sessions)

**Issue: No data in bucket**
- Check Railway logs for session logger errors
- Verify `logSessionStep()` is being called (it's fire-and-forget, so errors are logged but don't break the app)
- Test with a manual session

**Issue: Dashboard can't read**
- Check Vercel function logs
- Verify `GOOGLE_CREDENTIALS_JSON` is set in Vercel
- Test health endpoint first

## File Structure

### See It App
- `app/app/services/session-logger.server.ts` - Session logger (already exists)
- `app/app/routes/app-proxy.*.ts` - Routes that call logger

### Dashboard
- `see-it-monitor/src/app/page.tsx` - Main dashboard page
- `see-it-monitor/src/lib/gcs.ts` - GCS client library
- `see-it-monitor/src/app/api/health/route.ts` - Health endpoint (NEW)
- `see-it-monitor/src/app/api/resync/route.ts` - Resync endpoint (NEW)

### Session Data Structure in GCS
```
sessions/
  {sessionId}/
    meta.json           - All session metadata and steps
    01_room.jpg         - Room image (if provided)
    02_mask.png         - Mask image
    02_mask_overlay.jpg - Mask overlay
    03_inpaint.jpg      - Inpainted room
    04_product.png      - Product image (if provided)
    04_placement.json   - Placement metadata
    05_final.jpg        - Final rendered image
```

## Testing Checklist

- [ ] GCS bucket `see-it-sessions` exists
- [ ] See It app has `GOOGLE_CREDENTIALS_JSON` set
- [ ] Dashboard has `GOOGLE_CREDENTIALS_JSON` set
- [ ] Test session creates files in GCS
- [ ] Health endpoint shows `gcsConnected: true`
- [ ] Health endpoint shows `sessionCount > 0`
- [ ] Dashboard displays sessions
- [ ] Resync endpoint works
