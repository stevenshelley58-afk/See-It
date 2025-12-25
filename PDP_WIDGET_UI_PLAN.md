### See It — PDP Widget + Modal UI Consistency Plan (Desktop + Mobile)

**Purpose**: This document is a “UI contract” for the See It Shopify rebuild. It is written so a different coding agent can implement changes **without drifting** from the premium look. If there is any ambiguity, default to “more premium, calmer, cleaner”.

**Applies to**:
- **Storefront (Theme App Extension)**: PDP widget block + modal flow (Entry → Prepare → Position → Result + Email/Saved Rooms).
- **Merchant Admin (Embedded Remix app)**: Dashboard, Products, Analytics, Settings, Billing.

**Non‑negotiable** (business rule):
- If **customers or merchants** see it, it must look **premium**. No compromises.
- **Primary CTAs are pill buttons on both desktop and mobile**.

**Interpretation rule (for dumb agents)**:
- If you are unsure, do **NOT** invent a new style. Reuse an existing primitive (token, button, card, header).
- If you see two different styles for the “same kind of thing” (ex: primary CTA), you must **pick one** and make all screens match it.

---

## 1) Golden reference + current implementation locations

### Golden reference (visual baseline)
- Treat the **storefront modal** styling as the strongest “premium” baseline to preserve.

### Storefront (extension) files
- **Liquid block (PDP widget + modal markup)**: `app/extensions/see-it-extension/blocks/see-it-button.liquid`
- **Styles**: `app/extensions/see-it-extension/assets/see-it-modal.css`
- **Client logic**: `app/extensions/see-it-extension/assets/see-it-modal.js`
- **Local harness**: `app/extensions/see-it-extension/test-widget.html`

### Merchant admin (Remix) files
- **Core UI primitives**:
  - `app/app/components/ui/Button.jsx`
  - `app/app/components/ui/Card.jsx`
  - `app/app/components/ui/PageShell.jsx`
  - `app/app/components/ui/StatCard.jsx`
  - `app/app/components/ui/UsageBar.jsx`
  - `app/app/components/ui/index.js`
- **Routes**:
  - Dashboard: `app/app/routes/app._index.jsx`
  - Products: `app/app/routes/app.products.jsx`
  - Settings: `app/app/routes/app.settings.jsx`
  - App shell: `app/app/routes/app.jsx`
- **Styles entry**: `app/app/tailwind.css`

---

## 2) Critical Shopify safety requirement (must do first)

### 2.1 Stop extension CSS from leaking into merchant storefront themes

**Problem**: Theme extension CSS currently uses global selectors (example: `* { font-family: ... }`) which can unintentionally restyle the merchant’s entire PDP and theme.

**Rule**: Extension styles must be scoped under See It roots only.

**Implementation contract**:
- Allowed selectors start with:
  - `.see-it-widget-hook ...`
  - `#see-it-modal ...` or `.see-it-modal ...`
  - `.see-it-modal-content ...`
- **Disallowed**: `*`, `html`, `body`, `h1` etc unless scoped (e.g. `.see-it-modal h1`).

**Acceptance**:
- Installing the block **does not change fonts/colors/buttons** anywhere outside the widget and modal.

### 2.2 “Leakage audit” (exact grep checks)

Run these searches and ensure **zero** unsafe selectors exist in `app/extensions/see-it-extension/assets/see-it-modal.css`.

**Hard fail if found** (must be removed or scoped):
- `^\\*$` selector (`* { ... }`)
- `^html\\b`
- `^body\\b`
- `^h1\\b`, `^h2\\b`, `^p\\b`, `^button\\b`, `^span\\b`
- `@import` for fonts is allowed, but font usage must be scoped.

**Allowed pattern**:
- `.see-it-modal * { ... }` (scoped universal)
- `.see-it-widget-hook * { ... }` (scoped universal)

### 2.3 Theme-resilience rules (storefront)

**Assume the merchant theme is hostile**:
- It may set `button { all: unset }`
- It may set `* { box-sizing: border-box }` or worse
- It may set `img { max-width: 100% }`
- It may set `body { font-family: ... }`

Therefore:
- Every interactive element must have explicit `display`, `padding`, `border`, `background`, `font`, `line-height`, `cursor`.
- All See It images should define `display: block` and an explicit `object-fit` on the relevant screens.

---

## 3) Design tokens (the single source of truth for “premium”)

### 3.1 Token names (shared conceptually across storefront + admin)

These tokens must exist in **both** surfaces (storefront and admin). Exact implementation may differ (CSS vars vs Tailwind mapping), but the values must match.

### 3.1.1 Token table (exact values — do not “tweak” ad-hoc)

If an agent wants to change these values, they must change them **once** in the token definitions and then verify all screens.

#### Typography
- `--si-font`: `Inter, -apple-system, BlinkMacSystemFont, sans-serif`
- `--si-title-size-mobile`: `28px` (Entry title can be larger, but must be consistent)
- `--si-title-size-desktop`: `36px`
- `--si-body-size`: `14px`–`16px` (pick `15px` if you must pick one)
- `--si-label-size`: `12px`
- `--si-tracking-title`: `-0.02em`
- `--si-tracking-label`: `0.10em`
- `--si-line-title`: `1.2`–`1.3` (pick `1.2`)
- `--si-line-body`: `1.5`

#### Color
- `--si-bg`: `#FAFAFA`
- `--si-surface`: `#FFFFFF`
- `--si-text`: `#1A1A1A`
- `--si-muted`: `#737373`
- `--si-muted-2`: `#A3A3A3`
- `--si-border`: `#E5E5E5`
- `--si-border-soft`: `#F0F0F0`
- `--si-cta`: `#171717`
- `--si-cta-hover`: `#262626`
- `--si-success`: `#22C55E`
- `--si-danger`: `#DC2626`

#### Radii
- `--si-radius-card`: `16px`
- `--si-radius-btn`: `12px`
- `--si-radius-pill`: `9999px`
- `--si-radius-chip`: `9999px`

#### Elevation / shadows
- `--si-shadow-card`: `0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)`
- `--si-shadow-float`: `0 6px 16px rgba(0,0,0,0.20), 0 2px 6px rgba(0,0,0,0.12)`
- `--si-shadow-modal`: `0 28px 80px rgba(0,0,0,0.45), 0 10px 30px rgba(0,0,0,0.30)`

#### Motion
- `--si-ease`: `cubic-bezier(0.25, 0.1, 0.25, 1)`
- `--si-duration-fast`: `150ms`
- `--si-duration-base`: `200ms`
- `--si-duration-slow`: `350ms` (screen transitions)

#### Sizing
- `--si-hit`: `44px` (minimum touch target)
- `--si-cta-min-h`: `46px` (storefront already uses this; keep it)

#### Typography
- `--si-font`: `Inter, -apple-system, BlinkMacSystemFont, sans-serif`
- `--si-tracking-tight`: `-0.02em` (titles)
- `--si-tracking-label`: `0.08em` to `0.10em` (uppercase labels)

#### Color (neutral premium)
- `--si-bg`: `#FAFAFA` (page background / subtle gradient start)
- `--si-surface`: `#FFFFFF` (cards/panels)
- `--si-text`: `#1A1A1A` (primary text)
- `--si-muted`: `#737373` (secondary text)
- `--si-border`: `#F0F0F0` / `#E5E5E5` (hairlines)
- `--si-cta`: `#171717` or `#1A1A1A` (primary CTA background)

#### Radii
- `--si-radius-card`: `16px` (or `12px`, but pick one and use everywhere)
- `--si-radius-btn`: `12px`
- `--si-radius-pill`: `9999px`

#### Shadows (3 levels max)
- `--si-shadow-sm`: subtle surface lift (cards)
- `--si-shadow-md`: elevated UI (floating chips)
- `--si-shadow-modal`: cinematic modal drop shadow (desktop modal container)

#### Motion
- `--si-ease`: `cubic-bezier(0.25, 0.1, 0.25, 1)`
- `--si-duration-fast`: `150ms`
- `--si-duration-base`: `200ms`–`250ms`
- Must respect `prefers-reduced-motion: reduce`

### 3.2 Storefront token implementation

Add CSS variables at:
- `.see-it-modal` (for modal scope)
- `.see-it-widget-hook` (for widget scope)

**Required rule**: Every “primitive” class must reference tokens, not random hex values, unless the color is functional (like the purple brush stroke) and intentionally distinct.

### 3.3 Admin token implementation

Admin uses Tailwind. Implement tokens via CSS variables in `app/app/tailwind.css`, and reference them through Tailwind utility classes (or small component-level class strings) without rewriting every screen.

---

## 4) Component system (shared rules, separate implementations)

### 4.0 Naming contract (storefront vs admin)

Storefront is plain CSS. Admin is Tailwind + component wrappers.

**Storefront must have**:
- `.see-it-btn-primary-pill` (primary pill CTA)
- `.see-it-btn-outline-pill` (secondary pill CTA)
- `.see-it-btn-primary` (desktop primary action — BUT must also become pill if it is “primary CTA”)
- `.see-it-btn-secondary` (desktop secondary)

**Admin must have**:
- `Button` variants that map to:
  - Primary CTA (pill)
  - Secondary CTA (pill)
  - Tertiary (text)

### 4.1 CTA hierarchy (applies everywhere)

- **Primary CTA**
  - Always pill (mobile + desktop)
  - Dark background, white text
  - Strong weight (500–600)
  - Height ≥ 44px
  - Active: slight scale (`0.98–0.99`) + subtle shadow change
- **Secondary CTA**
  - Pill, light surface, border, dark text
  - No “random rectangles”; same radius, same height rules
- **Tertiary CTA**
  - Text button (no background) used only for low-emphasis actions (Cancel, Back)

### 4.1.1 Exact “primary pill” spec (do not improvise)

Primary pill must:
- Use `--si-cta` for background and `--si-cta-hover` on hover (desktop).
- Have `border: none` (or border same as background).
- Use `min-height: var(--si-cta-min-h)` or ≥ `46px`.
- Have `border-radius: var(--si-radius-pill)`.
- Have `box-shadow`:
  - default: subtle (optional)
  - hover: `--si-shadow-float` (desktop only)
  - active: reduce shadow + scale `0.99`

### 4.1.2 Exact “secondary pill” spec

Secondary pill must:
- Use surface background (white / neutral)
- Use border `--si-border`
- Text color `--si-text` or `#404040`
- Same height and same pill radius as primary

### 4.1.3 Button content rules

- Icons must be aligned center and never shrink text.
- If a button has an icon, it must have a consistent icon size (18–20px).
- Button labels should be in Title Case; avoid shouting (no all-caps on CTAs).

### 4.2 Card / Panel rule

Pick **one** consistent pattern:
- Option A (recommended): **Card** is surface + radius + border + subtle shadow.
- Option B: **Card** is shadow-only; add a **Panel** primitive for bordered containers.

**Rule**: no ad-hoc `div bg-white rounded-xl border...` if a primitive exists.

### 4.2.1 Spacing contract (cards/panels)

- Card padding must be:
  - Mobile: `16px`
  - Desktop: `24px`
- Card radius must be `--si-radius-card`.
- Card border must be `--si-border-soft` (very subtle).

### 4.3 Header rule (applies to every screen)

Standard header layout:
- Left: Back or Close (icon or text)
- Center: uppercase label (tracking label token)
- Right: spacer or secondary control

---

## 5) PDP widget (block on product page) requirements

### 5.1 Functional requirements

In `see-it-button.liquid`:
- **Button label must use**: `block.settings.button_label`
  - No hardcoded label text when a setting exists.
- **Button style must reflect**: `block.settings.button_style`
  - If `primary`: primary pill CTA style
  - If `secondary`: secondary pill CTA style

### 5.1.1 Exact wiring rules (liquid)

Do this and only this:
- Button text:
  - Use `{{ block.settings.button_label }}` (fallback to the schema default is automatic).
- Button style class:
  - If `button_style == 'primary'`, apply a class that maps to the primary pill styling.
  - If `button_style == 'secondary'`, apply a class that maps to the secondary pill styling.

Do NOT:
- Hardcode the label text (“Tap to see it now”) if a setting exists.
- Compute a class and then forget to apply it.

### 5.1.2 Widget copy contract

The widget has 3 lines:
- Title: “Try it in Your Home” (or merchant-configurable later; not now)
- Description: one sentence (short)
- CTA: merchant-configured label (default “See it in your room”)

Keep this tone:
- Premium, confident, not gimmicky
- No exclamation spam


### 5.2 Visual requirements

Widget container (`.see-it-widget-hook`) must:
- Look like a premium card/panel (radius, border or shadow consistent with modal system)
- Keep spacing consistent (16px mobile padding; 16–20px desktop)
- Avoid fixed widths; must fit theme containers

Widget CTA must:
- Be premium, pill or premium-rounded consistently (recommend pill)
- Be full width (mobile) and optionally full width (desktop, acceptable either way if consistent)

### 5.2.1 Exact widget CTA shape rule

**Required**:
- Widget CTA must be pill on desktop and mobile (matches global CTA rule).
- If the agent keeps the current widget CTA, they must remove `border-radius: 0` and match `--si-radius-pill`.

### 5.3 Theme safety requirements

- No global CSS selectors.
- Do not assume the theme’s base line-height, button reset, or font.
- All widget styling must be resilient to aggressive theme CSS.

---

## 6) Storefront modal (Entry / Prepare / Position / Result) requirements

### 6.1 Cross-screen consistency checklist

All screens must share:
- The same typography scale (title, body, label)
- The same CTA hierarchy (primary pill always)
- The same spacing rhythm
- The same radii and shadows

### 6.2 Screen-specific requirements

#### Entry
- Title + description match premium typography (tight tracking, calm muted body)
- CTA stack spacing matches other screens
- Desktop split layout proportions consistent with other desktop screens

#### Prepare
- Mobile bottom controls pinned; safe-area respected
- Desktop has right-side control panel consistent with Position/Result panels
- Loading overlay + upload badge match tokenized radius/shadow

#### Position
- Instruction pill uses the same chip styling as other micro-UI
- Toggle sizing and behavior consistent on mobile and desktop
- **Generate** is primary pill on both

#### Result
- Success badge styling matches other badges
- Primary action (Share) is primary pill on both
- Secondary actions are consistent pills

#### Email + Saved Rooms modals
- Must match the main premium system (radius/shadow/typography)
- Backdrop tone must be consistent with the overall modal experience

---
### 6.3 Modal “UI primitives” (you must consolidate to these)

In the extension CSS, ensure there is exactly one set of primitives:

- **Surface**
  - `.see-it-surface` (optional helper): background, border, radius, shadow
- **Header row**
  - `.see-it-header-row` (or use existing `.see-it-screen-header` consistently)
- **Primary pill**
  - `.see-it-btn-primary-pill` (use everywhere a primary CTA appears, including desktop)
- **Secondary pill**
  - `.see-it-btn-outline-pill` (or a named equivalent) used consistently
- **Badge**
  - `.see-it-badge` + modifier classes (`--success`, `--neutral`, etc.)
- **Divider**
  - `.see-it-divider` (thin border line with `--si-border-soft`)

If a screen uses a one-off style instead of these primitives, it is considered a failure.

### 6.4 Screen-by-screen “no drift” mapping (exact)

This section is deliberately strict. If a different coding agent changes markup, they must preserve these mappings.

#### Entry screen (storefront)
- Primary CTA buttons:
  - Mobile: `#see-it-btn-take-photo` must have `.see-it-btn-primary-pill`
  - Desktop: `#see-it-btn-take-photo-desktop` must also have `.see-it-btn-primary-pill` (or an equivalent that is visually identical)
- Secondary actions:
  - Upload/Saved buttons must be `.see-it-btn-outline-pill` (or visually identical)
- Title and description:
  - `.see-it-entry-title` and `.see-it-entry-description` must use the typography tokens

#### Prepare screen (storefront)
- Primary CTA:
  - `#see-it-confirm-room` and `#see-it-confirm-room-desktop` must be `.see-it-btn-primary-pill`
- Secondary:
  - `Undo`, `Clear`, `Erase` are secondary pills or secondary buttons, but must be consistent between mobile and desktop.
- Loading overlay:
  - Must use the same surface radius and blur as the modal system; no harsh dark overlays.

#### Position screen (storefront)
- Primary CTA:
  - `#see-it-generate` and `#see-it-generate-desktop` must be `.see-it-btn-primary-pill`
- Toggle:
  - Must look identical between mobile and desktop (size/track/thumb)

#### Result screen (storefront)
- Primary CTA:
  - `#see-it-share` and `#see-it-share-desktop` must be `.see-it-btn-primary-pill`
- Secondary:
  - Adjust/New Room and Try Another Room must be `.see-it-btn-outline-pill` (or visually identical)

---

## 7) Admin UI (merchant) requirements

### 7.1 Layout consistency

Every admin route must:
- Use `PageShell` for outer spacing and background
- Use consistent page header structure (title + subtitle + right action)

### 7.2 Button system

In `app/app/components/ui/Button.jsx`:
- Add a `pill` variant (or `shape="pill"`) so merchants also get the same premium CTAs.
- Ensure mobile/desktop width behavior is consistent and intentional.
- Add focus styles (premium accessibility polish).

### 7.2.1 Admin button contract (exact)

Admin `Button` must support:
- `variant="primary"` → dark background, white text
- `variant="secondary"` → light background/border, dark text
- `shape="pill"` (or `pill` boolean) → sets `border-radius: 9999px` and consistent padding/height
- `size` values must map to a consistent min-height:
  - `sm`: ≥ 36px
  - `md`: ≥ 44px
  - `lg`: ≥ 48px

**Critical**:
- The comment in `Button.jsx` currently claims full-width mobile behavior; if the implementation doesn’t do it, fix it or correct the comment. No lying comments.

### 7.3 Card / Panel

Decide one Card/Panel rule (Section 4.2) and enforce it:
- Replace ad-hoc bordered cards with the primitive
- Ensure consistent padding: `p-4 md:p-6`

### 7.4 System UI consistency

Standardize:
- Toast (one component, used everywhere)
- Empty state (one pattern)
- ErrorBoundary UI (same structure and CTA layout)

---

## 8) Implementation order (prevents regressions)

1. **Scope extension CSS** (stop theme leakage)
2. **Wire widget settings** (button label + style)
3. **Tokenize storefront modal + widget** (CSS vars)
4. **Unify CTA styles across modal screens** (primary pill everywhere)
5. **Admin button/card standardization** (pill support + consistent cards)
6. **System UI polish** (toasts, empty, error, loading)

---

## 9) Testing checklist (must pass before calling it “done”)

### Storefront
- Widget + modal render on PDP with:
  - long product title
  - no featured image (block should render nothing / no JS errors)
  - mobile viewport + safe-area simulation
- “Theme interference” test:
  - Theme has global font rules, button rules, `*` resets
  - Confirm See It **does not** leak out, and theme **does not** degrade See It inside modal/widget

### Admin
- Dashboard, Products, Analytics, Settings, Billing:
  - consistent header spacing and typography
  - primary CTA uses premium pill when appropriate
  - cards/panels match the same radii/padding/elevation

---

## 10) Done criteria (Definition of Done)

You are finished only when:
- Extension CSS is fully scoped; no global impact on merchant themes.
- PDP widget respects settings and matches premium modal design language.
- All modal screens share one CTA hierarchy and one spacing/radius system.
- All admin screens share one layout/header/card/button system.
- Mobile + desktop are visually consistent: same product, same premium standard.

---

## Appendix A — “Don’t get cute” rules (common failure modes)

- Do not introduce new random hex colors.
- Do not change typography scale on one screen to “make it fit”; fix layout/spacing instead.
- Do not mix pill + rectangle CTAs for primary actions. Primary is pill everywhere.
- Do not add heavy borders; premium uses subtle borders and intentional shadows.
- Do not add extra animations; keep it calm and responsive.
- Do not restyle Shopify admin Polaris components globally; wrap and harmonize visually.

## Appendix B — What to do when you see inconsistency

If you see inconsistency:
1. Identify the primitive (button/card/header/badge) it should map to.
2. Replace the inconsistent styling with the primitive.
3. Verify on mobile + desktop.
4. Re-run the leakage audit checks.



