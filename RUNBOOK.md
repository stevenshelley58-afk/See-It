# Runbook: See It Shopify App

## 0. Prerequisites

Before you start, ensure you have the following:

1.  **Node.js**: Version 18.20+, 20.10+, or 21.0.0+. [Download Node.js](https://nodejs.org/)
2.  **Shopify Partner Account**: You need an account at [partners.shopify.com](https://partners.shopify.com) to create and manage apps.
3.  **Git**: [Download Git](https://git-scm.com/downloads)

**Note on Shopify CLI**: You do **not** need to install the Shopify CLI globally. It is included in the project dependencies (`npm install` installs it locally).

## 1. Environment Setup

1.  Copy `.env.example` to `.env` in the `c:\See It` directory (or `c:\See It\app` if running from there).
2.  Fill in the required values:
    *   `SHOPIFY_API_KEY`: From your Shopify Partner Dashboard.
    *   `SHOPIFY_API_SECRET`: From your Shopify Partner Dashboard.
    *   `SCOPES`: `write_products,read_products` (and any others needed).
    *   `SHOPIFY_APP_URL`: The tunnel URL (e.g., from `npm run dev`) or your production URL.
    *   `DATABASE_URL`: `file:dev.sqlite` (for local development).

## 2. Installation & Database

Open a terminal in `c:\See It\app`:

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Run Database Migrations
npx prisma migrate dev --name init
```

## 3. Running Locally

```bash
npm run dev
```

This command will:
1.  Start the Remix server.
2.  Start the Shopify CLI (which handles the tunnel).
3.  Output a URL to install the app.

## 4. Installing on a Dev Store

1.  Look for the URL in the terminal output labeled "Preview your app". It will look like:
    `https://admin.shopify.com/store/<your-store-name>/apps/<your-app-name>`
    OR a direct tunnel URL like `https://<random-id>.trycloudflare.com`.
2.  Click that URL.
3.  **OAuth Flow**:
    *   Shopify will ask you to install the app.
    *   Click "Install app".
    *   This hits the `/auth` route in `app/shopify.server.js`.
    *   After approval, Shopify redirects to `/auth/callback`.
    *   The app validates the session and redirects to `/app` (the Embedded Admin UI).

## 5. Billing & Quotas

*   **Billing Creation**:
    *   The app checks for a valid plan in `app/routes/app._index.jsx` (or where the plan selection is).
    *   To upgrade, the app posts to `/api/billing` with `plan=PRO`.
    *   This calls `billing.request` in `app/routes/api.billing.jsx`.
*   **Billing Callback**:
    *   Shopify redirects to `/api/billing/callback` after payment approval.
    *   The `loader` in `app/routes/api.billing.callback.jsx` verifies the payment and updates `Shop.plan`, `Shop.dailyQuota`, and `Shop.monthlyQuota` in the database.

## 6. Verification

To verify the wiring:
1.  **Check Logs**: Ensure no errors during `npm run dev`.
2.  **Check Database**: Open `dev.sqlite` (using a SQLite viewer or `npx prisma studio`) and verify the `Shop` table has an entry for your store.
3.  **Check Quotas**: Trigger a render (if implemented) and verify `UsageDaily` is updated.
