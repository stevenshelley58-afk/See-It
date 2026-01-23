/**
 * GET /api/monitor/v1/runs/:id/export
 *
 * Download debug bundle as ZIP.
 */

import { type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getRunDetail,
  getRunEvents,
  getRunArtifacts,
} from "../services/monitor";
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
  archive.append(JSON.stringify(run.variants, null, 2), {
    name: "variants.json",
  });
  archive.append(JSON.stringify(events.events, null, 2), {
    name: "events.json",
  });
  archive.append(JSON.stringify(run.resolvedFactsJson, null, 2), {
    name: "resolved_facts.json",
  });
  archive.append(JSON.stringify(run.promptPackJson, null, 2), {
    name: "prompt_pack.json",
  });
  archive.append(JSON.stringify(artifacts.artifacts, null, 2), {
    name: "artifacts.json",
  });

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
      passthrough.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      passthrough.on("end", () => controller.close());
      passthrough.on("error", (err: Error) => controller.error(err));
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="debug-bundle-${id}.zip"`,
    },
  });
};
