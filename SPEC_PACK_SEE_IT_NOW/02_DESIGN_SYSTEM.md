# 02 — Design System

## Purpose
This document defines all visual tokens, typography, spacing, and component styles for the See It Now storefront experience. All values are exact — do not invent alternatives.

---

## CSS Custom Properties (Design Tokens)

All tokens are scoped to `.see-it-now-widget-hook` and `.see-it-now-modal`. Copy these exactly:

```css
/* Typography */
--si-font: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
--si-title-size-mobile: 24px;
--si-title-size-desktop: 32px;
--si-body-size: 15px;
--si-label-size: 11px;
--si-tracking-title: -0.025em;
--si-line-title: 1.25;
--si-line-body: 1.6;

/* Colors */
--si-bg: #FAFAFA;
--si-surface: #FFFFFF;
--si-text: #171717;
--si-muted: #737373;
--si-muted-2: #A3A3A3;
--si-border: #E5E5E5;
--si-border-soft: #F5F5F5;
--si-cta: #171717;
--si-cta-hover: #000000;
--si-danger: #EF4444;

/* Radii */
--si-radius-card: 16px;
--si-radius-btn: 12px;
--si-radius-pill: 9999px;

/* Shadows */
--si-shadow-card: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.02);
--si-shadow-float: 0 8px 24px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.04);
--si-shadow-modal: 0 32px 64px -12px rgba(0, 0, 0, 0.14);

/* Animation */
--si-ease: cubic-bezier(0.16, 1, 0.3, 1);
--si-duration-fast: 150ms;
--si-duration-base: 250ms;
--si-duration-slow: 400ms;

/* Touch targets */
--si-hit: 44px;
--si-cta-min-h: 48px;
```

---

## Typography

| Element | Size | Weight | Color | Letter Spacing | Line Height |
|---------|------|--------|-------|----------------|-------------|
| Entry title | 24px (mobile) / 32px (desktop) | 600 | `--si-text` | -0.025em | 1.25 |
| Thinking title | 20px | 600 | `--si-text` | -0.025em | 1.25 |
| Error title | 20px | 600 | `--si-text` | - | - |
| Body/description | 16px | 400 | `--si-muted` | - | 1.5 |
| Thinking subtitle | 14px | 400 | `--si-muted` | - | - |
| Thinking tip | 13px | 400 (italic) | `--si-muted` | - | - |
| Button text (primary) | 15px | 600 | #FFFFFF | -0.01em | - |
| Button text (secondary) | 15px | 500 | `--si-text` | - | - |
| Widget title | 15px | 600 | `--si-text` | -0.025em | 1.25 |
| Widget description | 14px | 400 | `--si-muted` | - | 1.4 |
| Version badge | 10px | 600 | `--si-muted` | - | - |

---

## Font Loading

**CRITICAL**: The Google Fonts import is the ONLY external resource allowed:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
```

This is acceptable because:
1. It's a font, not executable code
2. It's loaded via CSS, not a `<script>` tag
3. The fallback stack ensures text renders immediately

No other external resources (scripts, CDNs, analytics) are permitted.

---

## Z-Index Layering

| Layer | Z-Index | Element |
|-------|---------|---------|
| Modal backdrop | 2147483647 | `.see-it-now-modal` |
| Global error toast | 100 | `#see-it-now-global-error` |
| Active screen | 10 | `.see-it-now-screen.active` |
| Version badge | 5 | `.see-it-now-version-badge` |
| Carousel dots | 3 | `.see-it-now-dots` |
| Carousel nav | 2 | `.see-it-now-nav-left`, `.see-it-now-nav-right` |

The modal uses the maximum safe z-index (2147483647) to ensure it overlays all Shopify theme elements.

---

## Responsive Breakpoints

| Breakpoint | Width | Behavior |
|------------|-------|----------|
| Mobile | < 768px | Full-screen modal, entry screen shown, camera capture available |
| Desktop | ≥ 768px | Centered modal (90vw max 1000px, 80vh max 700px), no entry screen, file picker opens immediately |

```css
@media (min-width: 768px) {
  .see-it-now-modal-content {
    width: 90vw;
    max-width: 1000px;
    height: 80vh;
    max-height: 700px;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.5);
  }
}
```

---

## Button Components

### Primary Pill Button (`.see-it-now-btn-primary-pill`)

```css
display: flex;
align-items: center;
justify-content: center;
gap: 8px;
width: 100%;
background-color: var(--si-cta);  /* #171717 */
color: #FFFFFF;
min-height: 48px;
border-radius: 9999px;
border: none;
font-weight: 600;
font-size: 15px;
letter-spacing: -0.01em;
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
transition: all 250ms cubic-bezier(0.16, 1, 0.3, 1);
```

Hover state:
```css
background-color: #000000;
transform: translateY(-1px);
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.04);
```

Active state:
```css
transform: scale(0.99);
box-shadow: none;
```

### Outline Pill Button (`.see-it-now-btn-outline-pill`)

```css
display: flex;
align-items: center;
justify-content: center;
gap: 8px;
width: 100%;
background-color: var(--si-surface);  /* #FFFFFF */
color: var(--si-text);  /* #171717 */
min-height: 48px;
border-radius: 9999px;
border: 1px solid var(--si-border);  /* #E5E5E5 */
font-weight: 500;
font-size: 15px;
transition: all 250ms cubic-bezier(0.16, 1, 0.3, 1);
```

Hover state:
```css
border-color: var(--si-muted-2);  /* #A3A3A3 */
background-color: #f9f9f9;
```

### Text Button (`.see-it-now-btn-text`)

```css
background: none;
border: none;
color: var(--si-muted);  /* #737373 */
font-size: 13px;
font-weight: 500;
padding: 10px 16px;
border-radius: 8px;
display: flex;
align-items: center;
gap: 6px;
transition: all 150ms;
```

Hover state:
```css
color: var(--si-text);  /* #171717 */
background: var(--si-border-soft);  /* #F5F5F5 */
```

### Icon Button (`.see-it-now-btn-icon`)

```css
background: transparent;
border: none;
color: var(--si-text);  /* #171717 */
padding: 8px;
border-radius: 50%;
display: flex;
align-items: center;
justify-content: center;
min-width: 44px;
min-height: 44px;
transition: background 150ms;
```

Hover state:
```css
background: var(--si-border-soft);  /* #F5F5F5 */
```

Icon size inside: 24px × 24px

---

## Animations

### Spinner

```css
.see-it-now-thinking-spinner {
  width: 40px;
  height: 40px;
  border: 2px solid var(--si-border);  /* #E5E5E5 */
  border-top-color: var(--si-text);     /* #171717 */
  border-radius: 50%;
  animation: see-it-now-spin 0.8s linear infinite;
}

@keyframes see-it-now-spin {
  to { transform: rotate(360deg); }
}
```

### Loading Dots

```css
.see-it-now-loading-dots::after {
  content: '';
  animation: see-it-now-dots 1.5s infinite;
}

@keyframes see-it-now-dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}
```

### Screen Transitions

```css
.see-it-now-screen {
  opacity: 0;
  transform: translateX(20px);
  pointer-events: none;
  transition: opacity 250ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

.see-it-now-screen.active {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}
```

### Carousel Slide Transition

```css
.see-it-now-swipe-track {
  transition: transform 0.3s ease-out;
}
```

During drag: `transition: none;`

### Dot Active State

```css
.see-it-now-dot {
  transition: background 0.2s, transform 0.2s;
}

.see-it-now-dot.active {
  transform: scale(1.25);
}
```

---

## Accessibility Requirements

### Touch Targets
- All interactive elements: minimum 44px × 44px
- CTA buttons: minimum height 48px

### Focus Management
- When modal opens: focus should be trapped inside modal
- Close button should be focusable
- Carousel navigation should support keyboard (ArrowLeft/ArrowRight)

### ARIA Labels
- Close buttons: `aria-label="Close"`
- Back buttons: `aria-label="Back"`
- Carousel dots: `aria-label="View image {n}"`

### Reduced Motion
Not currently implemented. Future enhancement: respect `prefers-reduced-motion`.

### Screen Reader
- Modal should have `role="dialog"` (implicit in structure)
- Images should have descriptive alt text: `alt="Visualization {n}"`

---

## Scroll Lock

When modal is open, body scrolling must be disabled:

```css
html.see-it-now-modal-open,
html.see-it-now-modal-open body {
  overflow: hidden !important;
  position: fixed !important;
  width: 100% !important;
  height: 100% !important;
}
```

JavaScript must:
1. Save current scroll position before locking
2. Restore scroll position after unlocking

---

## Dark Mode

**Not supported.** The design uses a light theme only. Variables are not toggled based on `prefers-color-scheme`.

---

## Icon Specifications

All icons are inline SVGs with:
- `fill="none"`
- `stroke="currentColor"`
- `stroke-width="1.5"` (header icons) or `stroke-width="2"` (button icons)
- `viewBox="0 0 24 24"`

### Cube Icon (trigger button)
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6L18 9L12 12L6 9Z"/>
  <path stroke-linecap="round" stroke-linejoin="round" d="M6 9L6 15L12 18L12 12Z"/>
  <path stroke-linecap="round" stroke-linejoin="round" d="M12 12L18 9L18 15L12 18Z"/>
</svg>
```

### Close Icon (X)
```html
<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
</svg>
```

### Back Icon (chevron left)
```html
<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
</svg>
```

### Camera Icon
```html
<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"/>
  <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/>
</svg>
```

### Share/Upload Icon
```html
<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
</svg>
```

### Refresh Icon (try again)
```html
<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
</svg>
```

### Cube Icon (try another)
```html
<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
</svg>
```

### Warning Icon (error)
```html
<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
</svg>
```
