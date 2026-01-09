# Session Saving Issue - Diagnosis

## Problem
Sessions are not appearing in the monitor dashboard at https://see-it-monitor.vercel.app/

## Root Cause Analysis

### 1. Database Connection
The monitor app expects a Postgres database to store sessions, but:
- The database may not be connected (missing `DATABASE_URL` or Railway Postgres env vars)
- The database schema may not be migrated (tables don't exist)
- The health endpoint now checks database connection status

### 2. Analytics Events Flow
- The extension (`see-it-modal.js`) sends events to `/api/analytics/events`
- The analytics endpoint tries to save to database AND GCS
- If database fails, events are still saved to GCS but not to Postgres
- The dashboard queries Postgres first, then falls back to GCS

### 3. Current State
- Events are being sent to the monitor API (based on code)
- Events are saved to GCS (fallback works)
- Events may NOT be saved to Postgres (database issue)

## Diagnosis Steps

### Step 1: Check Health Endpoint
Visit: `https://see-it-monitor.vercel.app/api/health`

Look for:
- `dbConnected`: Should be `true`
- `dbError`: Should be `null` if connected
- `dbSessionCount`: Number of sessions in database
- `sessionCount`: Number of sessions in GCS

### Step 2: Check Analytics Endpoint Response
When events are sent, check the response for:
- `stored.db`: Should be `true`
- `stored.dbErrorCount`: Should be `0`
- `dbErrors`: Array of any database errors

### Step 3: Verify Database Setup
1. Check Vercel environment variables:
   - `DATABASE_URL` or
   - `DATABASE_PUBLIC_URL` or
   - Railway Postgres variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`)

2. Run database migrations:
   ```bash
   cd see-it-monitor
   npm run db:push
   ```
   Or if using migrations:
   ```bash
   npm run db:migrate
   ```

## Fixes Applied

1. ✅ Enhanced health endpoint to check database connection
2. ✅ Added better error logging in analytics endpoint
3. ✅ Analytics endpoint now reports database save status

## Next Steps

1. **Check Vercel environment variables** - Ensure database connection string is set
2. **Run database migrations** - Ensure schema is applied
3. **Test analytics endpoint** - Send a test event and check response
4. **Monitor logs** - Check Vercel function logs for database errors

## Testing

To test if sessions are being saved:

1. Open browser DevTools on a Shopify store with See It enabled
2. Trigger a session (click "See it in your room")
3. Check Network tab for POST to `/api/analytics/events`
4. Check response - should have `stored.db: true`
5. Check health endpoint - should show `dbSessionCount > 0`

## Fallback Behavior

Even if database fails:
- Events are still saved to GCS
- Dashboard can read from GCS (fallback)
- But dashboard prefers database for better performance

The issue is likely that:
1. Database is not connected, OR
2. Database schema is not migrated, OR
3. Database connection is failing silently
