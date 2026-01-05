# See It Monitor - Comprehensive Architecture

## Vision
A single dashboard that answers: "Is See It working for merchants and their customers?"

---

## Data Sources & What We Capture

### 1. Shopify Admin API (Merchant Health)
```
Shop Install Events
├── installed_at
├── uninstalled_at (if applicable)
├── shop_domain
├── shop_name
├── shopify_plan (basic, shopify, advanced, plus)
├── store_created_at
└── billing_status

App Embed Status
├── is_embedded (boolean - is app block actually on theme?)
├── theme_id
├── theme_name
├── embed_enabled_at
├── embed_disabled_at
└── pages_with_embed[]

Products with See It
├── product_id
├── product_title
├── product_type
├── has_ar_ready_images (boolean)
├── image_count
├── ar_sessions_count
├── last_ar_session_at
└── conversion_rate (orders with AR view / total orders)

Orders (Conversion Tracking)
├── order_id
├── had_ar_session (boolean)
├── ar_session_ids[]
├── products_viewed_in_ar[]
├── time_from_ar_to_purchase
├── order_value
└── customer_id (hashed)
```

### 2. Railway API (Technical Health)
```
Service Health
├── service_id
├── status (up/down/degraded)
├── uptime_percentage
├── last_deploy_at
├── current_version
└── region

API Metrics
├── endpoint
├── method
├── response_time_ms
├── status_code
├── error_message (if any)
├── timestamp
└── request_id

Resource Usage
├── cpu_usage
├── memory_usage
├── network_in/out
├── active_connections
└── cost_to_date
```

### 3. AI Providers (Replicate/FAL) - Cost & Performance
```
Generation Request
├── request_id
├── session_id
├── provider (replicate/fal)
├── model_id
├── model_version
├── step (inpaint/segment/upscale)
├── input_params
│   ├── image_size
│   ├── prompt
│   └── model_specific_params
├── started_at
├── completed_at
├── duration_ms
├── status (success/failed/timeout)
├── error_message
├── cost_usd
├── is_regeneration (boolean - costing extra money)
├── regeneration_reason (user_requested/auto_retry/quality_fail)
└── output_quality_score (if we implement auto-scoring)
```

### 4. Client-Side SDK (User Experience)
```
Session Lifecycle
├── session_id
├── shop_domain
├── product_id
├── product_title
├── product_price
├── started_at
├── ended_at
├── duration_ms
├── completion_status (completed/abandoned/error)
├── abandonment_step (where they dropped off)
└── abandonment_reason (timeout/user_closed/error)

Step Events (Granular)
├── session_id
├── step (room_capture/mask_edit/inpaint/placement/final)
├── step_started_at
├── step_completed_at
├── step_duration_ms
├── user_interactions
│   ├── retakes (room photo)
│   ├── mask_edits (count)
│   ├── placement_adjustments (count)
│   ├── regenerations_requested
│   └── zoom/pan actions
├── auto_vs_manual (for masking)
├── quality_rating (if user rates)
└── errors[]

Device Context
├── device_type (mobile/tablet/desktop)
├── os (iOS/Android/Windows/Mac)
├── os_version
├── browser
├── browser_version
├── screen_size
├── has_camera
├── has_gyroscope
├── webgl_support
├── connection_type (wifi/cellular/unknown)
└── connection_speed_estimate

User Journey
├── entry_point (product_page/collection/homepage/direct)
├── referrer
├── time_on_product_page_before_ar
├── ar_button_visible_time (how long before they clicked)
├── post_ar_action (add_to_cart/continue_browsing/leave)
├── add_to_cart_within_session (boolean)
├── purchase_within_24h (boolean - needs backend correlation)
└── return_visits_to_ar
```

### 5. Image Preparation (Merchant Setup Experience)
```
Product Setup Session
├── setup_session_id
├── shop_domain
├── merchant_user_id (if available)
├── product_id
├── started_at
├── completed_at
├── duration_ms
├── completion_status

Images Prepared
├── image_id
├── product_id
├── original_image_url
├── preparation_method (auto/manual/hybrid)
├── auto_detection_confidence
├── manual_edits_required (boolean)
├── edit_types[] (mask_adjustment/background_removal/crop)
├── processing_time_ms
├── final_quality_score
├── approved_by_merchant (boolean)
└── revision_count

Setup Friction Points
├── errors_encountered[]
├── help_requests (did they click help?)
├── time_stuck_per_step
├── abandoned_products[] (started but didn't finish)
└── retry_count
```

### 6. Error Tracking (What's Breaking)
```
Error Event
├── error_id
├── session_id (if applicable)
├── shop_domain
├── error_type (client/server/ai_provider/shopify)
├── error_code
├── error_message
├── stack_trace
├── context
│   ├── step
│   ├── action
│   ├── input_data (sanitized)
│   └── user_agent
├── severity (critical/error/warning)
├── is_user_facing (boolean)
├── user_saw_error_message (boolean)
├── recovery_action (retry_success/retry_fail/abandoned)
├── timestamp
└── resolved (boolean)

Error Patterns (Aggregated)
├── error_code
├── occurrence_count
├── affected_shops[]
├── affected_sessions_count
├── first_seen
├── last_seen
├── trend (increasing/stable/decreasing)
├── common_device_context
└── suggested_fix
```

---

## Dashboard Views

### 1. Overview (At a Glance)
```
┌─────────────────────────────────────────────────────────────────┐
│  SEE IT MONITOR                                    Last 24h ▼   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ 47       │  │ 89%      │  │ $12.47   │  │ 3        │        │
│  │ Active   │  │ Success  │  │ AI Cost  │  │ Errors   │        │
│  │ Shops    │  │ Rate     │  │ Today    │  │ Today    │        │
│  │ +3 ↑     │  │ +2% ↑    │  │ -$1.20 ↓ │  │ -5 ↓     │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ LIVE SESSIONS (12 active)                               │   │
│  │ ○ myshop.com - Room capture - 0:45                      │   │
│  │ ○ furniture.co - Inpainting - 1:23                      │   │
│  │ ○ decor.store - Placement - 0:12                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ SYSTEM STATUS                                           │   │
│  │ ● Railway API      Healthy     45ms avg                 │   │
│  │ ● Replicate        Healthy     2.3s avg                 │   │
│  │ ● FAL              Healthy     1.8s avg                 │   │
│  │ ● Shopify Webhook  Healthy     12ms avg                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Merchant Health
```
┌─────────────────────────────────────────────────────────────────┐
│  MERCHANT HEALTH                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Installation Funnel                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Installed ████████████████████████████████████ 100 (100%)│   │
│  │ Embedded  ████████████████████████████░░░░░░░░  78 (78%) │   │
│  │ Products  ██████████████████████░░░░░░░░░░░░░░  56 (56%) │   │
│  │ Sessions  ████████████████░░░░░░░░░░░░░░░░░░░░  42 (42%) │   │
│  │ Active    ████████████░░░░░░░░░░░░░░░░░░░░░░░░  31 (31%) │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ⚠️ NEEDS ATTENTION                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ luxe-furniture.com - Installed 14 days ago, 0 sessions  │   │
│  │   → Embed not enabled. Offer setup help?                │   │
│  │                                                         │   │
│  │ modern-decor.co - Embedded but 0 products prepared      │   │
│  │   → Stuck at product setup. Reach out?                  │   │
│  │                                                         │   │
│  │ home-style.shop - 5 products, but 0 sessions this week  │   │
│  │   → Was active, now quiet. Check in?                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  TOP PERFORMING MERCHANTS                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Shop              Sessions  Completion  Conversion       │   │
│  │ premium-home.com     234       94%         +12%          │   │
│  │ artisan-furn.co      187       91%         +8%           │   │
│  │ scandi-living.com    156       88%         +15%          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. User Journey & Drop-off
```
┌─────────────────────────────────────────────────────────────────┐
│  USER JOURNEY ANALYSIS                              Last 7d     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Session Funnel                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  AR Button Click  ████████████████████████████  1,247   │   │
│  │         ↓ 92%                                           │   │
│  │  Room Capture     ██████████████████████████░░  1,147   │   │
│  │         ↓ 78%     ← 22% drop: camera denied (142)       │   │
│  │  Mask/Segment     ████████████████████░░░░░░░░    894   │   │
│  │         ↓ 89%     ← 11% drop: timeout waiting (103)     │   │
│  │  Inpaint          ██████████████████░░░░░░░░░░    796   │   │
│  │         ↓ 94%     ← 6% drop: didn't like result (48)    │   │
│  │  Placement        █████████████████░░░░░░░░░░░    748   │   │
│  │         ↓ 97%                                           │   │
│  │  Completed        █████████████████░░░░░░░░░░░    726   │   │
│  │                                                         │   │
│  │  Overall: 58% completion rate                           │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Post-AR Actions                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Added to Cart        ████████████░░░░░░░░░░░░  312 (43%)│   │
│  │ Continued Browsing   ████████░░░░░░░░░░░░░░░░  234 (32%)│   │
│  │ Left Site            █████░░░░░░░░░░░░░░░░░░░  180 (25%)│   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Conversion Impact                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     With AR    Without AR    Lift       │   │
│  │ Add to Cart Rate     43%         28%        +54%        │   │
│  │ Purchase Rate        18%         12%        +50%        │   │
│  │ Avg Order Value     $847        $623        +36%        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Cost Tracking
```
┌─────────────────────────────────────────────────────────────────┐
│  COST ANALYSIS                                      This Month  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Total AI Spend: $347.82                                        │
│  Sessions: 2,847                                                │
│  Cost per Session: $0.12                                        │
│  Cost per Conversion: $1.14                                     │
│                                                                 │
│  Breakdown by Step                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Inpainting (Replicate)   ██████████████████  $198.45    │   │
│  │ Segmentation (FAL)       ████████░░░░░░░░░░   $87.23    │   │
│  │ Object Removal           █████░░░░░░░░░░░░░   $42.14    │   │
│  │ Upscaling                ██░░░░░░░░░░░░░░░░   $20.00    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ⚠️ REGENERATION COSTS (Wasted Spend)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Total Regenerations: 423 ($52.47)                       │   │
│  │                                                         │   │
│  │ By Reason:                                              │   │
│  │ • User requested better result    287  ($35.87)         │   │
│  │ • Auto-retry on failure            98  ($12.25)         │   │
│  │ • Quality threshold not met        38   ($4.35)         │   │
│  │                                                         │   │
│  │ By Shop (top offenders):                                │   │
│  │ • experimental-store.com   47 regens  ($5.87)           │   │
│  │ • test-shop.myshopify.com  34 regens  ($4.25)           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Cost Trend                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ $15 │      ╭─╮                                          │   │
│  │     │   ╭──╯ ╰──╮    ╭─╮                                │   │
│  │ $10 │╭──╯       ╰────╯ ╰──╮                             │   │
│  │     ││                    ╰──                           │   │
│  │  $5 │╯                                                  │   │
│  │     └────────────────────────────────────────           │   │
│  │      1   5   10   15   20   25   30                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5. Product Setup Experience
```
┌─────────────────────────────────────────────────────────────────┐
│  PRODUCT SETUP EXPERIENCE                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Images Prepared: 1,247 total                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Auto (no edits needed)     █████████████████  847 (68%) │   │
│  │ Hybrid (minor edits)       █████░░░░░░░░░░░░  312 (25%) │   │
│  │ Manual (significant work)  ██░░░░░░░░░░░░░░░   88 (7%)  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Setup Time Distribution                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ < 30 seconds (auto magic)  ████████████████   712       │   │
│  │ 30s - 2 min (quick edit)   ██████░░░░░░░░░░   398       │   │
│  │ 2 - 5 min (needs work)     ███░░░░░░░░░░░░░   112       │   │
│  │ > 5 min (struggled)        █░░░░░░░░░░░░░░░    25       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ⚠️ FRICTION POINTS                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Products Abandoned Mid-Setup: 34                        │   │
│  │                                                         │   │
│  │ Common Issues:                                          │   │
│  │ • Mask detection poor on glass/reflective (12)          │   │
│  │ • Upload timeout on large images (8)                    │   │
│  │ • Confused by crop interface (7)                        │   │
│  │ • Background removal left artifacts (7)                 │   │
│  │                                                         │   │
│  │ → Consider: Auto-retry with different model for glass   │   │
│  │ → Consider: Image compression before upload             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6. Error Intelligence
```
┌─────────────────────────────────────────────────────────────────┐
│  ERROR INTELLIGENCE                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Current Issues (Last 24h)                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔴 CRITICAL (0)  🟠 ERROR (3)  🟡 WARNING (12)          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Top Errors                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Error                    Count  Trend   Shops  Action   │   │
│  │─────────────────────────────────────────────────────────│   │
│  │ REPLICATE_TIMEOUT          23    ↑      8     Retry 3x  │   │
│  │   Inpaint taking >30s                                   │   │
│  │   Affected: furniture-co, luxe-home, ...                │   │
│  │   [View Details] [Acknowledge]                          │   │
│  │                                                         │   │
│  │ CAMERA_PERMISSION_DENIED   18    →      12    Expected  │   │
│  │   User denied camera access                             │   │
│  │   High on iOS Safari (14/18)                            │   │
│  │   [View Details]                                        │   │
│  │                                                         │   │
│  │ MASK_GENERATION_FAILED      7    ↓       3    Watching  │   │
│  │   SAM model returned empty mask                         │   │
│  │   Common with: white backgrounds, glass objects         │   │
│  │   [View Details]                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Error by Device/Browser                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │            iOS Safari  iOS Chrome  Android  Desktop     │   │
│  │ Camera        14          2           1        1        │   │
│  │ WebGL          0          0           3        0        │   │
│  │ Memory         2          1           5        0        │   │
│  │ Network        3          2           4        2        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Collection Implementation

### Client-Side SDK (New)
```typescript
// see-it-analytics.ts - Drop into the app

interface SeeItAnalytics {
  // Automatically captured
  sessionId: string;
  shopDomain: string;
  productId: string;
  deviceContext: DeviceContext;
  
  // Event tracking
  trackEvent(event: AnalyticsEvent): void;
  trackStep(step: Step, status: StepStatus, metadata?: object): void;
  trackError(error: ErrorEvent): void;
  trackUserAction(action: UserAction): void;
  
  // Conversion tracking
  trackARButtonImpression(): void;
  trackARButtonClick(): void;
  trackPostARAction(action: 'add_to_cart' | 'continue' | 'leave'): void;
  
  // Lifecycle
  startSession(productId: string): void;
  endSession(status: 'completed' | 'abandoned' | 'error'): void;
  
  // Flush on page unload
  flush(): Promise<void>;
}
```

### Backend Event Ingestion
```
POST /api/analytics/events
{
  "events": [
    {
      "type": "step_completed",
      "session_id": "sess_xxx",
      "shop": "myshop.com",
      "data": { ... },
      "timestamp": "2024-01-15T10:23:45Z"
    }
  ]
}
```

### Data Storage Strategy
```
PostgreSQL (Railway)
├── shops (merchant data, install status)
├── products (AR-enabled products)
├── sessions (core session data)
├── session_steps (granular step data)
├── errors (error events)
├── ai_requests (generation tracking, costs)
└── conversions (order correlation)

GCS (unchanged)
├── Session images
└── Visual debugging artifacts

Redis (optional, for real-time)
├── Active sessions
├── Real-time metrics
└── Rate limiting
```

---

## API Integrations Needed

### 1. Shopify Admin API
- `GET /admin/api/2024-01/shop.json` - Shop info
- `GET /admin/api/2024-01/themes.json` - Check embed status
- `GET /admin/api/2024-01/products.json` - Products with metafields
- `GET /admin/api/2024-01/orders.json` - Conversion tracking
- Webhooks: `app/uninstalled`, `orders/create`, `products/update`

### 2. Railway API
- `GET /project/{id}/deployments` - Deploy status
- `GET /project/{id}/metrics` - Resource usage
- `GET /project/{id}/logs` - Error logs

### 3. Replicate API
- `GET /predictions` - Generation history
- Webhook on completion for timing/cost

### 4. FAL API  
- Similar to Replicate - track generations

---

## Priority Implementation Order

### Phase 1: Foundation (Week 1)
- [ ] Database schema for analytics
- [ ] Event ingestion API
- [ ] Basic client SDK
- [ ] Session tracking (start/end/steps)

### Phase 2: Merchant Health (Week 2)
- [ ] Shopify integration for install/embed status
- [ ] Product tracking
- [ ] Merchant dashboard view
- [ ] "Needs attention" alerts

### Phase 3: User Journey (Week 3)
- [ ] Full funnel tracking
- [ ] Drop-off analysis
- [ ] Device/browser breakdown
- [ ] Conversion correlation

### Phase 4: Cost & Errors (Week 4)
- [ ] AI provider cost tracking
- [ ] Regeneration monitoring
- [ ] Error aggregation
- [ ] Alerting system

### Phase 5: Intelligence (Week 5+)
- [ ] Conversion impact analysis
- [ ] Automated recommendations
- [ ] Anomaly detection
- [ ] Merchant health scoring

---

## File Structure (Expanded Monitor)

```
see-it-monitor/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Overview dashboard
│   │   ├── merchants/
│   │   │   ├── page.tsx             # Merchant list
│   │   │   └── [domain]/page.tsx    # Single merchant detail
│   │   ├── sessions/
│   │   │   ├── page.tsx             # Session list
│   │   │   └── [id]/page.tsx        # Session detail
│   │   ├── journey/
│   │   │   └── page.tsx             # User journey/funnel
│   │   ├── costs/
│   │   │   └── page.tsx             # Cost tracking
│   │   ├── errors/
│   │   │   └── page.tsx             # Error intelligence
│   │   ├── setup/
│   │   │   └── page.tsx             # Product setup experience
│   │   └── api/
│   │       ├── analytics/
│   │       │   └── events/route.ts  # Event ingestion
│   │       ├── health/route.ts
│   │       ├── shopify/
│   │       │   └── webhook/route.ts
│   │       └── sync/
│   │           └── route.ts
│   ├── lib/
│   │   ├── db/
│   │   │   ├── schema.ts            # Drizzle schema
│   │   │   ├── client.ts
│   │   │   └── queries/
│   │   │       ├── sessions.ts
│   │   │       ├── merchants.ts
│   │   │       ├── costs.ts
│   │   │       └── errors.ts
│   │   ├── integrations/
│   │   │   ├── shopify.ts
│   │   │   ├── railway.ts
│   │   │   ├── replicate.ts
│   │   │   └── fal.ts
│   │   ├── gcs.ts
│   │   └── analytics/
│   │       ├── funnel.ts
│   │       ├── conversion.ts
│   │       └── costs.ts
│   └── components/
│       ├── dashboard/
│       ├── charts/
│       └── tables/
├── sdk/
│   └── see-it-analytics.ts          # Client SDK (copy to main app)
└── scripts/
    ├── sync-shopify.ts
    └── backfill-costs.ts
```

---

## Questions to Decide

1. **Database**: Add Postgres to Railway, or use Vercel Postgres?
2. **Real-time**: Need live session updates, or is polling OK?
3. **Retention**: How long to keep detailed analytics? (suggest: 90 days granular, 1 year aggregated)
4. **Alerts**: Email? Slack? Dashboard only?
5. **Access**: Just you, or merchant-facing dashboards too?
