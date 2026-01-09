# Event Saving Guide - Everything is Saved by Default

## Overview

**All events are automatically saved to the database and visible in the monitor by default.** No configuration needed.

## How It Works

### 1. Event Flow

```
User Action → Extension/App → Analytics SDK → POST /api/analytics/events → Database
```

### 2. What Gets Saved

**ALL events are saved to the `analytics_events` table** - this is the raw event log that captures everything:

- `session_started` - When a user starts an AR session
- `session_ended` - When a session completes/abandons/fails
- `step_update` - Progress through each step (room_capture, mask, inpaint, placement, final)
- `error` - Any errors that occur
- `ai_request` - AI API calls (for cost tracking)
- `user_action` - User interactions (retake, mask edit, placement adjust, etc.)
- `post_ar_action` - Actions after AR (add to cart, continue browsing, leave)
- `ar_button_click` - When user clicks "See it in your room"
- `ar_button_impression` - When the AR button is shown
- `regeneration_requested` - When user requests a regeneration
- `setup_started` - Product setup begins
- `setup_completed` - Product setup finishes
- `setup_abandoned` - Product setup abandoned
- `image_prepared` - Product image prepared
- And any other custom events you track

### 3. Structured Data

In addition to the raw event log, specific event types also update structured tables for better querying:

- **`sessions`** - Updated by `session_started`, `step_update`, `session_ended`
- **`session_steps`** - Updated by `step_update` events
- **`errors`** - Created by `error` events
- **`ai_requests`** - Created by `ai_request` events
- **`shops`** - Auto-created when first session from a shop arrives

### 4. Database is Primary Source

The monitor dashboard queries the **database first** (not GCS). This means:

- ✅ All sessions appear in real-time
- ✅ All events are queryable
- ✅ Fast queries and aggregations
- ✅ Historical data is preserved

GCS is kept as a backup/archive, but the dashboard uses the database.

## What's Visible in the Monitor

### Control Room (Home Page)
- **Active Sessions** - Sessions in progress (from `sessions` table)
- **Recent Completions** - Recently completed sessions
- **Stats** - Success rate, active shops, AI costs, errors (from database)

### Sessions Page
- All sessions from `sessions` table
- Can filter by shop, status, date range

### Analytics
- All events from `analytics_events` table
- Can query any event type
- Full event history preserved

### Errors Page
- All errors from `errors` table
- Includes session context, severity, step

### Costs Page
- AI request costs from `ai_requests` table
- Aggregated by session, shop, date

## Event Types Tracked

### Session Lifecycle
- `session_started` - Session begins
- `session_ended` - Session ends (completed/abandoned/error)

### Steps
- `step_update` - Step progress (room_capture, mask, inpaint, placement, final)
  - Status: started, completed, failed, skipped
  - Includes metadata: retakeCount, maskEditCount, etc.

### Errors
- `error` - Any error with code, message, severity, step context

### AI Operations
- `ai_request` - AI API calls with provider, model, cost, duration
- `regeneration_requested` - User-triggered regenerations

### User Interactions
- `user_action` - Generic user actions
  - retake_photo
  - mask_edit (add/remove/reset)
  - placement_adjust (move/scale/rotate)
  - zoom_pan
  - help_click

### Conversion Tracking
- `ar_button_impression` - AR button shown
- `ar_button_click` - AR button clicked
- `post_ar_action` - Action after AR (add_to_cart, continue_browsing, leave)
- `add_to_cart_from_ar` - Direct add to cart from AR

### Product Setup
- `setup_started` - Merchant starts setting up product
- `setup_completed` - Setup finished
- `setup_abandoned` - Setup abandoned
- `image_prepared` - Product image prepared

## Querying Events

All events are in the `analytics_events` table:

```sql
-- Get all events for a session
SELECT * FROM analytics_events 
WHERE session_id = 'sess_...' 
ORDER BY server_timestamp;

-- Get all user actions
SELECT * FROM analytics_events 
WHERE event_type = 'user_action';

-- Get all errors
SELECT * FROM analytics_events 
WHERE event_type = 'error';

-- Get all events for a shop
SELECT * FROM analytics_events 
WHERE shop_domain = 'example.myshopify.com'
ORDER BY server_timestamp DESC;
```

## No Configuration Needed

Everything is saved automatically:
- ✅ Events are sent to `/api/analytics/events`
- ✅ All events saved to `analytics_events` table
- ✅ Structured events update relevant tables
- ✅ Dashboard queries database directly
- ✅ Everything is visible by default

## Backup to GCS

Events are also saved to GCS as a backup:
- Path: `analytics/events/{year}/{month}/{day}/{timestamp}_{nonce}.json`
- Used for disaster recovery
- Can be re-imported if needed (see `/api/backfill`)

## Summary

**Everything is saved. Everything is visible. No configuration needed.**

- All events → `analytics_events` table
- Sessions → `sessions` table
- Steps → `session_steps` table
- Errors → `errors` table
- AI costs → `ai_requests` table
- Dashboard → Queries database directly
