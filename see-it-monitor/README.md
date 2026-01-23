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
| `MONITOR_API_TOKEN` | API token for authenticating with the External Operator API |
| `MONITOR_REVEAL_TOKEN` | (Optional) Token for accessing revealed data |

### Development

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

### Production Build

```bash
npm run build
npm start
```

## Architecture

### API Proxy

All API calls are proxied through `/api/external/*` to keep authentication tokens server-side only. The client never has direct access to API tokens.

### Pages

- `/` - Control Room with health status and system overview
- `/runs` - List of render runs
- `/runs/[id]` - Individual run details
- `/shops` - List of shops
- `/shops/[id]` - Individual shop details

## Security

- API tokens are stored in environment variables and never exposed to the client
- All external API calls are proxied through Next.js API routes
- No sensitive data in client-side bundles
