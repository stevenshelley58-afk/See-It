# See It Monitor Dashboard

A monitoring dashboard for the See It application, providing visibility into system health, runs, and shop activity.

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
npm install
```

### Environment Setup

Copy the example environment file and configure:

```bash
cp .env.example .env.local
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `RAILWAY_API_URL` | Base URL of the Railway API (e.g., `https://see-it-production.up.railway.app`) |
| `MONITOR_API_TOKEN` | API token for authenticating with the External Operator API and enabling implicit dashboard auth |
| `DATABASE_URL` | PostgreSQL connection string (same database as main app, required for prompt-control APIs) |
| `DATABASE_PUBLIC_URL` | Alternative DB URL (Railway public URL). If set without `DATABASE_URL`, builds will map it to `DATABASE_URL` for Prisma generate. |
| `MONITOR_REVEAL_TOKEN` | (Optional) Token for accessing revealed data |
| `MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH` | (Optional) Set to `"true"` to enable implicit auth in production. In development, implicit auth is enabled by default when `MONITOR_API_TOKEN` is set |

### Vercel Deployment

Set these environment variables in your Vercel project settings:

- `RAILWAY_API_URL` = `https://see-it-production.up.railway.app`
- `MONITOR_API_TOKEN` = your API token (from Railway)
- `MONITOR_REVEAL_TOKEN` = optional reveal token

After setting environment variables, a new deployment is required to pick them up.

### Deployment

Push to GitHub → Vercel auto-deploys.

**Local development is not supported.**

## Architecture

### API Proxy

All API calls are proxied through `/api/external/*` to keep authentication tokens server-side only. The client never has direct access to API tokens.

### Pages

- `/` - Control Room with health status and system overview
- `/runs` - List of render runs
- `/runs/[id]` - Individual run details
- `/shops` - List of shops
- `/shops/[id]` - Individual shop details
- `/prompts` - Prompt registry and version management
- `/controls` - Runtime configuration per shop
- `/settings` - System settings and configuration

## Security

- API tokens are stored in environment variables and never exposed to the client
- All external API calls are proxied through Next.js API routes
- No sensitive data in client-side bundles
- **Implicit Dashboard Auth**: In development, browser requests to protected APIs (`/api/*` except `/api/health` and `/api/auth`) automatically receive admin access when `MONITOR_API_TOKEN` is set, without requiring Authorization headers. This allows the dashboard UI to work seamlessly. In production, set `MONITOR_ALLOW_IMPLICIT_DASHBOARD_AUTH=true` to enable this behavior, or use proper JWT/API key authentication for stricter access control.

## Production Smoke Test

After deploying to Vercel with env vars configured, verify the API proxy works:

### 1. Test Health Endpoint

```bash
curl -s https://see-it-monitor.vercel.app/api/external/health | head -c 200
```

### 2. Test Runs Endpoint

```bash
curl -s "https://see-it-monitor.vercel.app/api/external/runs?limit=1" | head -c 200
```

### Security Verification Checklist

Open DevTools Network tab and verify:

- [ ] **No Authorization header visible** - Headers are added server-side only
- [ ] **No tokens in response bodies** - Check JSON payloads for any token strings
- [ ] **`_reveal` param stripped** - If you add `?_reveal=true`, upstream request should NOT include it
- [ ] **Cache-Control: no-store** - Responses should not be cached
