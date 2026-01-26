# Step 08: API Routes

## Context

You are working on a Shopify Remix app. You have created the telemetry and monitor modules. Now create the v1 API routes.

## Task

Create versioned API routes for the monitor UI.

## Instructions

1. Create `app/routes/api.monitor.v1.runs.tsx`:

```typescript
/**
 * GET /api/monitor/v1/runs
 * 
 * Paginated list of render runs with filters.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRuns, type RunListFilters } from "../services/monitor";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  
  const filters: RunListFilters = {};
  
  const status = url.searchParams.get("status");
  if (status) filters.status = status;
  
  const dateFrom = url.searchParams.get("dateFrom");
  if (dateFrom) filters.dateFrom = new Date(dateFrom);
  
  const dateTo = url.searchParams.get("dateTo");
  if (dateTo) filters.dateTo = new Date(dateTo);
  
  const productId = url.searchParams.get("productId");
  if (productId) filters.productId = productId;
  
  const requestId = url.searchParams.get("requestId");
  if (requestId) filters.requestId = requestId;
  
  const promptVersion = url.searchParams.get("promptVersion");
  if (promptVersion) filters.promptVersion = parseInt(promptVersion);
  
  const model = url.searchParams.get("model");
  if (model) filters.model = model;

  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");

  const result = await getRuns(shop.id, filters, { page, limit });

  return json(result);
};
```

2. Create `app/routes/api.monitor.v1.runs.$id.tsx`:

```typescript
/**
 * GET /api/monitor/v1/runs/:id
 * 
 * Full run detail with variants and signed URLs.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRunDetail } from "../services/monitor";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return json({ error: "Missing run ID" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const run = await getRunDetail(id, shop.id);

  if (!run) {
    return json({ error: "Run not found" }, { status: 404 });
  }

  return json(run);
};
```

3. Create `app/routes/api.monitor.v1.runs.$id.events.tsx`:

```typescript
/**
 * GET /api/monitor/v1/runs/:id/events
 * 
 * Event timeline for a run.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRunEvents } from "../services/monitor";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return json({ error: "Missing run ID" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const result = await getRunEvents(id, shop.id);

  return json(result);
};
```

4. Create `app/routes/api.monitor.v1.runs.$id.artifacts.tsx`:

```typescript
/**
 * GET /api/monitor/v1/runs/:id/artifacts
 * 
 * Artifacts for a run with signed URLs.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRunArtifacts } from "../services/monitor";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return json({ error: "Missing run ID" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const result = await getRunArtifacts(id, shop.id);

  return json(result);
};
```

5. Create `app/routes/api.monitor.v1.runs.$id.export.tsx`:

```typescript
/**
 * GET /api/monitor/v1/runs/:id/export
 * 
 * Download debug bundle as ZIP.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRunDetail, getRunEvents, getRunArtifacts } from "../services/monitor";
import archiver from "archiver";
import { PassThrough } from "stream";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return new Response("Missing run ID", { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return new Response("Shop not found", { status: 404 });
  }

  const [run, events, artifacts] = await Promise.all([
    getRunDetail(id, shop.id),
    getRunEvents(id, shop.id),
    getRunArtifacts(id, shop.id),
  ]);

  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  // Create ZIP archive
  const archive = archiver("zip", { zlib: { level: 9 } });
  const passthrough = new PassThrough();

  archive.pipe(passthrough);

  // Add JSON files
  archive.append(JSON.stringify(run, null, 2), { name: "run.json" });
  archive.append(JSON.stringify(run.variants, null, 2), { name: "variants.json" });
  archive.append(JSON.stringify(events.events, null, 2), { name: "events.json" });
  archive.append(JSON.stringify(run.resolvedFactsJson, null, 2), { name: "resolved_facts.json" });
  archive.append(JSON.stringify(run.promptPackJson, null, 2), { name: "prompt_pack.json" });
  archive.append(JSON.stringify(artifacts.artifacts, null, 2), { name: "artifacts.json" });

  // Add manifest
  const manifest = {
    runId: run.id,
    requestId: run.requestId,
    exportedAt: new Date().toISOString(),
    files: [
      "run.json",
      "variants.json",
      "events.json",
      "resolved_facts.json",
      "prompt_pack.json",
      "artifacts.json",
    ],
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  archive.finalize();

  // Convert to web stream
  const readable = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk) => controller.enqueue(chunk));
      passthrough.on("end", () => controller.close());
      passthrough.on("error", (err) => controller.error(err));
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="debug-bundle-${id}.zip"`,
    },
  });
};
```

6. Create `app/routes/api.monitor.v1.health.tsx`:

```typescript
/**
 * GET /api/monitor/v1/health
 * 
 * Health statistics for the shop.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getHealthStats } from "../services/monitor";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const stats = await getHealthStats(shop.id);

  return json(stats);
};
```

7. Add archiver dependency:

```bash
npm install archiver
npm install -D @types/archiver
```

## Verification

Start the dev server and test:

```bash
# Get runs list
curl http://localhost:3000/api/monitor/v1/runs

# Get run detail (replace ID)
curl http://localhost:3000/api/monitor/v1/runs/some-run-id

# Get health
curl http://localhost:3000/api/monitor/v1/health
```

All should return valid JSON (or appropriate errors if no data).

## Do Not

- Do not modify existing routes yet
- Do not add authentication bypass
