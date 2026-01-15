# See It Now - Session Monitor Setup Guide

This guide explains how to enable monitoring for customer sessions using the See It Now feature.

## Overview

The monitoring system consists of three components:

1. **Server-side Session Logger** - Logs session data to GCS from the See It Now routes
2. **Client-side Analytics Beacon** - Tracks user interactions in the storefront extension
3. **Monitor Dashboard** - Displays live sessions, errors, and historical data

## Data Flow

```
Customer Website (Shopify)
       │
       ▼
See It Now Extension ──► /api/analytics/events (monitor)
       │                         │
       ▼                         ▼
App Proxy Routes ──► GCS Bucket + Postgres DB
(render, select)              │
                              ▼
                    Monitor Dashboard
                    (live view, history, errors)
```

## Environment Variables

### Main App (Railway)

These should already be configured if the app is running:

```env
# Google Cloud Storage
GOOGLE_CREDENTIALS_JSON=base64_encoded_or_raw_json_string
GCS_SESSION_BUCKET=see-it-sessions
```

### Monitor Dashboard (Vercel)

Configure these in Vercel dashboard for `see-it-monitor`:

```env
# Database (required)
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require

# Admin endpoints (required)
MIGRATE_SECRET=generate_a_long_random_secret
BACKFILL_SECRET=generate_a_long_random_secret

# Google Cloud Storage (must match main app)
GOOGLE_CREDENTIALS_JSON=base64_encoded_or_raw_json_string
GCS_SESSION_BUCKET=see-it-sessions
```

**Important:** The `GOOGLE_CREDENTIALS_JSON` and `GCS_SESSION_BUCKET` must be identical to the main app's values so the monitor can read session data.

## Storefront Extension Configuration

### Option 1: Via Shopify Theme Editor

1. Go to your Shopify store's Online Store > Themes
2. Click "Customize" on your active theme
3. Add the "See It Now" block to your product page
4. Configure the following settings:
   - **Monitor Dashboard URL**: `https://your-monitor-url.vercel.app`
   - **Enable Session Analytics**: Checked (default)

### Option 2: Via Block Settings

The extension supports these analytics settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `monitor_url` | text | `""` | URL of your monitor dashboard |
| `enable_analytics` | checkbox | `true` | Enable/disable session tracking |

## Events Tracked

### Server-side Events (GCS)

These events are logged by the app proxy routes to GCS:

| Event | Route | Data |
|-------|-------|------|
| `variants_generated` | `/see-it-now/render` | sessionId, shop, productId, variantCount, variantIds, imageUrls, durationMs |
| `variant_selected` | `/see-it-now/select` | sessionId, shop, selectedVariantId, selectedImageUrl, upscaled |
| `error` | Both routes | sessionId, shop, errorCode, errorMessage, step |

### Client-side Events (Monitor API)

These events are sent by the storefront extension to `/api/analytics/events`:

| Event | Trigger | Data |
|-------|---------|------|
| `session_started` | User clicks "See It Now" button | productId, productTitle, entryPoint, deviceContext |
| `room_uploaded` | User uploads/captures room photo | roomSessionId, imageSize |
| `variants_generated` | Images finish generating | variantCount, variantIds, durationMs |
| `variant_selected` | User shares an image | selectedVariantIndex, action |
| `error` | Any error occurs | errorCode, errorMessage, step |
| `session_ended` | Modal closes | status, durationMs, abandonmentStep |

## GCS Bucket Structure

Session data is stored in GCS with this structure:

```
see-it-sessions/
├── see-it-now/
│   └── {sessionId}/
│       └── session.json     # Full session data with all events
├── sessions/                # Original See It flow sessions
│   └── {sessionId}/
│       ├── meta.json
│       ├── 01_room.jpg
│       ├── 02_mask.png
│       └── ...
└── shops/
    └── {shopDomain}/
        ├── sessions.json           # Original See It sessions index
        └── see-it-now-sessions.json # See It Now sessions index
```

## Monitor Dashboard Features

Once configured, you'll see in the monitor:

- **Live Sessions** - Real-time view of active sessions
- **Session History** - Browse past sessions
- **Session Details** - View uploaded rooms, generated variants, selected favorites
- **Error Tracking** - See crashes/failures with device/browser context
- **Shop Analytics** - Per-shop session counts and success rates

## Verifying the Setup

### 1. Check Main App Logging

After a See It Now session completes, check Railway logs for:
```
[See It Now] Hero shot generation completed: X variants in Yms
```

### 2. Check GCS Data

Use the monitor's health endpoint:
```
GET https://your-monitor-url.vercel.app/api/health
```

Response should show:
```json
{
  "gcsConnected": true,
  "sessionsFound": 5,
  "latestSession": "2024-01-15T10:30:00Z"
}
```

### 3. Check Client Analytics

Open browser DevTools console while using See It Now. With analytics enabled, you should see:
```
[SeeItNowAnalytics] Session started: sin_xxx_xxx
[SeeItNowAnalytics] Event tracked: room_uploaded {...}
[SeeItNowAnalytics] Event tracked: variants_generated {...}
```

### 4. View in Dashboard

Navigate to your monitor dashboard:
- Main page shows recent sessions
- Click a session to see details
- Errors tab shows any failures

## Troubleshooting

### No sessions appearing in monitor

1. **Check GCS credentials match** - Both main app and monitor need identical `GOOGLE_CREDENTIALS_JSON`
2. **Verify bucket name** - Both must use `GCS_SESSION_BUCKET=see-it-sessions`
3. **Check Database connection** - Monitor needs a working `DATABASE_URL`
4. **Run resync** - `POST /api/resync` to rebuild indexes

### Analytics events not being sent

1. **Check monitor URL** - Verify it's configured in extension settings
2. **Check CORS** - Monitor endpoint allows Shopify domains
3. **Check console** - Browser console shows analytics debug logs
4. **Verify network** - Network tab should show POST to `/api/analytics/events`

### Session data incomplete

1. **Check route logging** - Railway logs should show session logging messages
2. **Verify GCS writes** - Check if files appear in the bucket
3. **Check permissions** - Service account needs write access to bucket

## Quick Start Checklist

- [ ] Set `GOOGLE_CREDENTIALS_JSON` in Vercel (same as Railway)
- [ ] Set `GCS_SESSION_BUCKET=see-it-sessions` in Vercel
- [ ] Set `DATABASE_URL` in Vercel
- [ ] Deploy monitor to Vercel
- [ ] Configure `monitor_url` in Shopify theme extension settings
- [ ] Test a See It Now session
- [ ] Verify session appears in monitor dashboard
