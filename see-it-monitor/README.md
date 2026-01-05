# See It Session Monitor

Dashboard for monitoring See It app sessions. Displays session data logged from the See It Shopify app to GCS bucket `see-it-sessions`.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables in Vercel (or `.env.local` for local development):
```
GOOGLE_CREDENTIALS_JSON=base64_encoded_or_raw_json_string
GCS_SESSION_BUCKET=see-it-sessions
```

The `GOOGLE_CREDENTIALS_JSON` can be:
- Base64-encoded JSON string
- Raw JSON string (must be properly escaped for your environment)
- The service account JSON object as a string

3. Run locally:
```bash
npm run dev
```

4. Deploy to Vercel:
```bash
vercel deploy
```

## API Endpoints

### `GET /api/health`
Health check endpoint. Returns:
- GCS connection status
- Number of sessions found
- Latest session timestamp

### `GET /api/sessions`
Get all sessions. Query params:
- `includeImages=true` - Include signed URLs for images (mask, inpaint)

### `GET /api/sessions/[sessionId]`
Get a single session by ID. Query params:
- `includeImages=true` - Include signed URLs for images

### `POST /api/resync`
Rescan GCS bucket and rebuild session index. Useful if data gets out of sync.

## Session Data Structure

Sessions are stored in GCS with the following structure:
```
sessions/
  {sessionId}/
    room.json      - Room step metadata
    mask.json      - Mask step metadata
    inpaint.json   - Inpaint step metadata
    placement.json - Placement step metadata
    final.json     - Final step metadata
    images/
      mask.png     - Mask image (if available)
      inpaint.png  - Inpainted image (if available)
```

## Troubleshooting

**No sessions showing:**
1. Check `/api/health` to verify GCS connection
2. Verify `GOOGLE_CREDENTIALS_JSON` is set correctly in Vercel
3. Verify bucket `see-it-sessions` exists
4. Check that session logging is working in the See It app (check Railway logs)
5. Use `POST /api/resync` to rebuild the index

**GCS connection errors:**
- Verify credentials JSON is valid
- Check that the service account has permissions to read from the bucket
- Ensure the bucket name is correct (`GCS_SESSION_BUCKET` env var)
