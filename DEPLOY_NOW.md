# Deploy See It — Agent Runbook (**ALWAYS DEPLOY**)

## Non‑negotiable agent rule
If you change **anything** in this repo that affects production behavior, you **MUST** deploy and verify it:

- **Backend (Railway)**: deploy by pushing to `main`
- **Storefront widgets (Shopify theme app extension)**: deploy by running `shopify app deploy` (via `npm run deploy` in `c:\See It\app`)

Why: storefront stores load extension assets from Shopify CDN, so code changes don’t reach merchants until a new extension version is released.

---

## Step 0 — Decide what to deploy (based on what you changed)
- **Backend-only changes** (`app/app/**`, DB/prisma, Remix routes/services): push to `main` (Railway auto-deploys)
- **Theme extension changes** (`app/extensions/see-it-extension/**`): run `npm run deploy` from `c:\See It\app`
- **Both**: do both deployments (common)

---

## Step 1 — Deploy backend (Railway)
Run these in **PowerShell** from `c:\See It`:

```powershell
cd "c:\See It"
git add -A
git commit -m "Deploy: <short description>"
git push origin main
```

### If you changed Prisma schema / migrations
Run migrations on Railway **before** relying on new code paths.
Reference: `DEPLOYMENT.md` (full guide).

---

## Step 2 — Verify Railway environment variables
Railway project: `https://railway.app/project/eb044abc-f17a-4747-aff8-5c5e79c42669`

Required variables (production):

| Variable | Description | Example |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | (from Google AI Studio) |
| `GOOGLE_CREDENTIALS_JSON` | GCS service account JSON | full JSON (or encoded as your env expects) |
| `GCS_BUCKET` | GCS bucket name | `see-it-room` |

---

## Step 3 — Deploy Shopify theme app extension (Storefront widgets)
Run this from `c:\See It\app`:

```powershell
cd "c:\See It\app"
npm run deploy
```

Notes:
- `npm run deploy` runs `shopify app deploy` (see `app/package.json`).
- When prompted, confirm **Yes, release this new version**.

---

## Step 4 — Ensure the extension is enabled on the target store
In Shopify admin:

- **Online Store → Themes → Customize**
- Enable the **See It** app embed (or the block, depending on install)
- Save

---

## Step 5 — Smoke test (MANDATORY)

### V1 (BHM live store) — must work here
Test on:
`https://www.bhm.com.au/products/detailed-sundar-mirror-bleach-chalky-bleach?_pos=1&_psq=sunda&_ss=e&_v=1.0`

Checklist:
- Open DevTools Console
- Hard refresh
- Confirm **no syntax errors** from `see-it-modal.js`
  - A common break is TypeScript syntax leaking into the shipped browser JS (e.g. `(window as any)`), which will kill all click handlers.
- Click **“See it in your room”** → modal opens
- Upload a room image → flow proceeds

### V2 (test store) — must work when installed
If the test store is password protected, enter it first.

Checklist:
- Click V2 button → V2 modal opens
- Upload a room image → generates placements / progresses through flow

---

## If the button is “dead” on a store (fast diagnosis)
- Check Network tab: confirm the extension JS/CSS loaded from Shopify CDN (e.g. `.../extensions/.../assets/see-it-modal.js`)
- Check Console for **syntax errors** (syntax errors prevent the whole script from running)
- Confirm the theme isn’t rendering multiple triggers with duplicate IDs (bind via delegation or `querySelectorAll` when needed)
