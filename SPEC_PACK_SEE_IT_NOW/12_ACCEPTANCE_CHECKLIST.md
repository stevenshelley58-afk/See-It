# 12 — Acceptance Checklist

## Purpose
This document defines the "definition of done" for See It Now. All items must pass before shipping.

---

## Storefront (Theme Extension)

### Button Rendering

- [ ] See It Now button appears on PDP when product has required tag
- [ ] Button does NOT appear when product lacks required tag (if enabled)
- [ ] Button does NOT appear when product has no featured image
- [ ] Button styling matches design system (primary/secondary pill)
- [ ] Cube icon displays correctly
- [ ] Widget card renders with title and description

### Mobile Flow

- [ ] Clicking button opens modal
- [ ] Modal shows entry screen (not thinking screen)
- [ ] Entry screen shows product image, title, description
- [ ] "Take Photo" button opens camera (capture="environment")
- [ ] "Upload a photo" link opens file picker
- [ ] Close button (X) closes modal and returns to PDP
- [ ] Selecting file transitions to thinking screen
- [ ] Thinking screen shows product image, spinner, rotating tips
- [ ] Loading dots animate after title
- [ ] Tips rotate every 3 seconds
- [ ] Successful generation shows result screen with variants
- [ ] Error shows error screen with message and retry button

### Desktop Flow

- [ ] Clicking button opens file picker immediately
- [ ] NO entry screen shown on desktop
- [ ] Selecting file opens modal in thinking state
- [ ] Rest of flow identical to mobile

### Result Screen

- [ ] Carousel displays all returned variants
- [ ] Dots match number of variants
- [ ] First dot is active initially
- [ ] Swipe left advances to next variant
- [ ] Swipe right goes to previous variant
- [ ] Edge resistance when at first/last slide
- [ ] Clicking dots navigates to that variant
- [ ] Click left area navigates backward
- [ ] Click right area navigates forward
- [ ] Keyboard left/right arrows work
- [ ] Share button triggers share or download
- [ ] Try Again button restarts with same room
- [ ] Try Another Product button closes modal
- [ ] Back button restarts flow
- [ ] Close button closes modal
- [ ] Version badge shows "See It Now"

### Error Handling

- [ ] Upload failure shows error screen
- [ ] Confirm failure (not uploaded yet) retries with backoff
- [ ] Generation failure shows error screen with message
- [ ] Network error shows user-friendly message
- [ ] File picker cancel does NOT show error (returns to previous state)
- [ ] No HTML error pages ever shown (all JSON errors)

### Scroll Lock

- [ ] Body scroll disabled when modal open
- [ ] Scroll position restored after modal close
- [ ] iOS scroll position preserved

### Image Normalization

- [ ] Images cropped to nearest Gemini-supported ratio
- [ ] Images resized to max 2048px
- [ ] Images converted to JPEG
- [ ] EXIF orientation handled

---

## Backend API

### POST /apps/see-it/room/upload

- [ ] Returns room_session_id
- [ ] Returns upload_url (presigned GCS URL)
- [ ] Returns content_type
- [ ] Creates RoomSession in database
- [ ] Returns 403 without valid app proxy auth
- [ ] Returns 400 for invalid content type

### POST /apps/see-it/room/confirm

- [ ] Returns canonical_room_image_url
- [ ] Returns canonical dimensions
- [ ] Creates canonical JPEG in GCS
- [ ] Returns 400 if image not uploaded
- [ ] Returns 404 for invalid session
- [ ] Handles crop_params if provided

### POST /apps/see-it/see-it-now/render

- [ ] Returns session_id with see-it-now prefix
- [ ] Returns variants array with id, image_url, direction
- [ ] Returns duration_ms
- [ ] Returns version: "see-it-now"
- [ ] Generates 1-5 variants (handles partial success)
- [ ] Returns 403 for non-allowed shop
- [ ] Returns 403 for missing auth
- [ ] Returns 422 for non-live product
- [ ] Returns 404 for invalid room session
- [ ] Returns 429 for rate limit exceeded
- [ ] Never returns HTML (always JSON)

### POST /apps/see-it/see-it-now/select

- [ ] Records selection in RenderJob
- [ ] Returns final_image_url
- [ ] Upscales if upscale=true
- [ ] Returns 403 for non-allowed shop

### OPTIONS Handling

- [ ] All routes return 204 for OPTIONS
- [ ] CORS headers included in all responses

---

## Admin App

### Dashboard

- [ ] Shows enabled product count
- [ ] Shows monthly render usage
- [ ] Shows plan information

### Products Page

- [ ] Lists products with thumbnails
- [ ] Shows status badges (live, ready, unprepared, failed)
- [ ] Filter by status works
- [ ] Prepare button starts preparation
- [ ] Enable button sets status to live
- [ ] Disable button sets status to ready
- [ ] Edit opens modal

### Product Edit

- [ ] Shows prepared image
- [ ] Allows editing See It Now instructions
- [ ] Allows selecting variant subset
- [ ] Save persists changes

### Settings Page

- [ ] Shows global See It Now prompt
- [ ] Save persists changes
- [ ] Theme setup instructions displayed

---

## Database

- [ ] Shop record created on install
- [ ] ProductAsset tracks preparation status
- [ ] RoomSession expires after 24 hours
- [ ] RenderJob records all generations
- [ ] Cascade delete works (shop deletion cleans all data)
- [ ] All queries scoped to shop

---

## Storage

- [ ] Room images uploaded to correct path
- [ ] Canonical images created
- [ ] Generated variants stored
- [ ] Signed URLs work
- [ ] CORS allows storefront origin

---

## Security

- [ ] App proxy auth validates all storefront requests
- [ ] Admin auth validates all admin requests
- [ ] All queries scoped to authenticated shop
- [ ] SSRF protection on all server-side fetches
- [ ] Rate limiting prevents abuse
- [ ] Allowlist enforced for See It Now features
- [ ] No PII stored in room sessions
- [ ] API keys not exposed to client

---

## Observability

- [ ] Health endpoint returns 200 when healthy
- [ ] Health endpoint returns 503 when unhealthy
- [ ] Request IDs propagated through logs
- [ ] All stages logged with context
- [ ] Errors logged with stack traces
- [ ] Console logs prefixed with [See It Now]

---

## Performance

- [ ] Time to first result: < 60 seconds (typical < 20s)
- [ ] Image normalization: < 2 seconds
- [ ] Upload: < 5 seconds
- [ ] Confirm: < 5 seconds
- [ ] Generation: < 45 seconds typical

---

## Cross-Browser Testing

- [ ] Chrome (desktop): Works
- [ ] Safari (desktop): Works
- [ ] Firefox (desktop): Works
- [ ] Chrome (Android): Works
- [ ] Safari (iOS): Works
- [ ] Camera capture works on mobile browsers

---

## Deployment

- [ ] Environment variables set
- [ ] Database migrations applied
- [ ] GCS bucket configured with CORS
- [ ] Shopify app proxy configured
- [ ] Theme extension deployed
- [ ] Health check passes
- [ ] Logs accessible

---

## Final Sign-Off

| Reviewer | Date | Status |
|----------|------|--------|
| Developer | | |
| QA | | |
| Product | | |

---

## Known Limitations (Documented)

- [ ] Maximum 5 variants per generation
- [ ] Room sessions expire in 24 hours
- [ ] No saved rooms in MVP
- [ ] No manual placement/scaling
- [ ] Requires product tag for display
- [ ] Shop must be in allowlist
