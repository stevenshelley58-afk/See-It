/**
 * Migrate legacy ProductAsset.status values to the current status vocabulary.
 *
 * NOTE: This script intentionally uses direct Postgres access (node-postgres)
 * rather than Prisma Client. Prisma's native query engine does not currently
 * support Windows ARM64, and many Windows ARM dev environments run Node as arm64.
 *
 * Supports:
 *  - --dry-run    : show what would change (no writes)
 *  - --rollback   : revert changes using a report file from a prior run
 *  - --report=... : path to write/read the rollback report (defaults to ./tmp/migrate-statuses-<timestamp>.ndjson)
 *
 * IMPORTANT:
 *  - Rollback is safe only when using a report from the migration run.
 *  - Without a report, rollback is refused unless --unsafe is provided.
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import pg from "pg";
import {
  isPostgresUrl,
  resolveDatabaseUrl,
  getSslConfig,
  logConnectionInfo,
} from "../lib/db-url.js";

const { Client } = pg;
let db;

/**
 * Phase 7 mapping (per status system overhaul spec)
 *
 * - ready (with prepared_image_url)      -> ready, enabled=false
 * - ready (without prepared_image_url)   -> unprepared, enabled=false
 * - pending/processing                   -> preparing, enabled=false
 * - stale/orphaned                       -> unprepared, enabled=false
 * - failed                               -> failed, enabled=false
 *
 * Also: set enabled=false for all existing records as safety.
 */

function parseArgs(argv) {
  const args = {
    dryRun: false,
    rollback: false,
    unsafe: false,
    reportPath: null,
    preferDotenv: false,
  };

  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--rollback") args.rollback = true;
    else if (raw === "--unsafe") args.unsafe = true;
    else if (raw === "--prefer-dotenv") args.preferDotenv = true;
    else if (raw.startsWith("--report=")) args.reportPath = raw.slice("--report=".length);
  }

  return args;
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function timestampForFilename(d = new Date()) {
  // Example: 2026-01-10T08-16-53.582Z
  return d.toISOString().replaceAll(":", "-");
}

function shouldOverrideEnv(key, nextValue, { preferDotenv }) {
  // Never accept a non-Postgres DATABASE_URL (this repo has seen sqlite-style values like "file:...").
  if (key === "DATABASE_URL" && !isPostgresUrl(nextValue)) return false;

  if (preferDotenv) return true;
  if (process.env[key] === undefined) return true;

  return false;
}

function loadEnvFileIfPresent(filePath, { preferDotenv }) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (!key) continue;

      // Remove surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (shouldOverrideEnv(key, value, { preferDotenv })) {
        process.env[key] = value;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function getStatusEnabledCounts() {
  const res = await db.query(
    `SELECT status, enabled, COUNT(*)::int AS count
     FROM product_assets
     GROUP BY status, enabled
     ORDER BY status ASC, enabled ASC`
  );
  return (res.rows ?? []).map((r) => ({
    status: String(r.status),
    enabled: Boolean(r.enabled),
    count: Number(r.count),
  }));
}

async function getPlannedChanges() {
  const enabledTrue = await db.query(
    `SELECT COUNT(*)::int AS count FROM product_assets WHERE enabled = true`
  );

  const readyWithImage = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM product_assets
     WHERE status = 'ready' AND prepared_image_url IS NOT NULL`
  );
  const readyNoImage = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM product_assets
     WHERE status = 'ready' AND prepared_image_url IS NULL`
  );

  const pendingProcessing = await db.query(
    `SELECT status, COUNT(*)::int AS count
     FROM product_assets
     WHERE status IN ('pending','processing')
     GROUP BY status
     ORDER BY status`
  );

  const staleOrphaned = await db.query(
    `SELECT status, COUNT(*)::int AS count
     FROM product_assets
     WHERE status IN ('stale','orphaned')
     GROUP BY status
     ORDER BY status`
  );

  const failedEnabledTrue = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM product_assets
     WHERE status = 'failed' AND enabled = true`
  );

  return {
    enabledTrue: Number(enabledTrue.rows?.[0]?.count ?? 0),
    readyWithImage: Number(readyWithImage.rows?.[0]?.count ?? 0),
    readyNoImage: Number(readyNoImage.rows?.[0]?.count ?? 0),
    pendingProcessing: (pendingProcessing.rows ?? []).map((r) => ({
      status: String(r.status),
      count: Number(r.count),
    })),
    staleOrphaned: (staleOrphaned.rows ?? []).map((r) => ({
      status: String(r.status),
      count: Number(r.count),
    })),
    failedEnabledTrue: Number(failedEnabledTrue.rows?.[0]?.count ?? 0),
  };
}

async function reportRows(whereSql, whereParams, reportStream) {
  // Stream IDs + previous status/enabled so rollback can be exact.
  // NOTE: No pagination; if you ever expect huge tables, add batching.
  const res = await db.query(
    `SELECT id, status, enabled
     FROM product_assets
     WHERE ${whereSql}`,
    whereParams
  );

  for (const r of res.rows ?? []) {
    reportStream.write(
      JSON.stringify({
        model: "ProductAsset",
        id: String(r.id),
        fromStatus: String(r.status),
        fromEnabled: Boolean(r.enabled),
      }) + "\n"
    );
  }

  return Number(res.rowCount ?? 0);
}

async function migrate({ dryRun, reportPath }) {
  const countsBefore = await getStatusEnabledCounts();
  const planned = await getPlannedChanges();

  console.log("\n== Current ProductAsset.status x enabled counts ==");
  for (const { status, enabled, count } of countsBefore) {
    console.log(`- ${status} (enabled=${enabled}): ${count}`);
  }

  console.log("\n== Planned changes (Phase 7) ==");
  console.log(`- enabled=true -> enabled=false: ${planned.enabledTrue} row(s)`);
  console.log(`- ready + prepared_image_url != null -> ready (enabled=false): ${planned.readyWithImage} row(s)`);
  console.log(`- ready + prepared_image_url == null -> unprepared (enabled=false): ${planned.readyNoImage} row(s)`);
  const ppTotal = planned.pendingProcessing.reduce((s, x) => s + x.count, 0);
  console.log(`- pending/processing -> preparing (enabled=false): ${ppTotal} row(s)`);
  for (const r of planned.pendingProcessing) console.log(`  - ${r.status}: ${r.count}`);
  const soTotal = planned.staleOrphaned.reduce((s, x) => s + x.count, 0);
  console.log(`- stale/orphaned -> unprepared (enabled=false): ${soTotal} row(s)`);
  for (const r of planned.staleOrphaned) console.log(`  - ${r.status}: ${r.count}`);
  console.log(`- failed (ensure enabled=false): ${planned.failedEnabledTrue} row(s) currently enabled=true`);

  const totalWould =
    planned.enabledTrue +
    planned.readyNoImage +
    ppTotal +
    soTotal +
    planned.failedEnabledTrue;
  if (dryRun) {
    console.log(`\nDRY RUN: would change up to ${totalWould} row(s) (some steps may overlap).`);
    return;
  }

  if (totalWould === 0) {
    console.log("\nNo rows to migrate. Nothing to do.");
    return;
  }

  ensureDirForFile(reportPath);
  const reportStream = fs.createWriteStream(reportPath, { flags: "wx" });
  reportStream.write(
    JSON.stringify({
      kind: "migrate-statuses-report",
      createdAt: new Date().toISOString(),
      phase: 7,
    }) + "\n"
  );

  let totalUpdated = 0;

  try {
    // Step 1: enabled=false for all enabled=true
    const rep1 = await reportRows("enabled = true", [], reportStream);
    if (rep1) {
      const res1 = await db.query(
        `UPDATE product_assets SET enabled = false, updated_at = NOW() WHERE enabled = true`
      );
      totalUpdated += Number(res1.rowCount ?? 0);
      console.log(`✅ Set enabled=false for ${Number(res1.rowCount ?? 0)} row(s)`);
    }

    // Step 3: ready WITHOUT image -> unprepared (and enabled=false)
    const rep3 = await reportRows("status = 'ready' AND prepared_image_url IS NULL", [], reportStream);
    if (rep3) {
      const res3 = await db.query(
        `UPDATE product_assets SET status = 'unprepared', enabled = false, updated_at = NOW()
         WHERE status = 'ready' AND prepared_image_url IS NULL`
      );
      totalUpdated += Number(res3.rowCount ?? 0);
      console.log(`✅ Reset invalid ready (no image) -> unprepared: ${Number(res3.rowCount ?? 0)} row(s)`);
    }

    // Step 4: pending/processing -> preparing (enabled=false)
    const rep4 = await reportRows("status IN ('pending','processing')", [], reportStream);
    if (rep4) {
      const res4 = await db.query(
        `UPDATE product_assets SET status = 'preparing', enabled = false, updated_at = NOW()
         WHERE status IN ('pending','processing')`
      );
      totalUpdated += Number(res4.rowCount ?? 0);
      console.log(`✅ pending/processing -> preparing: ${Number(res4.rowCount ?? 0)} row(s)`);
    }

    // Step 5: stale/orphaned -> unprepared (enabled=false)
    const rep5 = await reportRows("status IN ('stale','orphaned')", [], reportStream);
    if (rep5) {
      const res5 = await db.query(
        `UPDATE product_assets SET status = 'unprepared', enabled = false, updated_at = NOW()
         WHERE status IN ('stale','orphaned')`
      );
      totalUpdated += Number(res5.rowCount ?? 0);
      console.log(`✅ stale/orphaned -> unprepared: ${Number(res5.rowCount ?? 0)} row(s)`);
    }

    // Step 6: failed stays failed, but ensure enabled=false
    const rep6 = await reportRows("status = 'failed' AND enabled = true", [], reportStream);
    if (rep6) {
      const res6 = await db.query(
        `UPDATE product_assets SET enabled = false, updated_at = NOW()
         WHERE status = 'failed' AND enabled = true`
      );
      totalUpdated += Number(res6.rowCount ?? 0);
      console.log(`✅ Ensured enabled=false for failed: ${Number(res6.rowCount ?? 0)} row(s)`);
    }
  } finally {
    await new Promise((resolve) => reportStream.end(resolve));
  }

  console.log(`\nDone. Updated ${totalUpdated} row(s).`);
  console.log(`Rollback report written to: ${reportPath}`);

  const countsAfter = await getStatusEnabledCounts();
  console.log("\n== Final ProductAsset.status x enabled counts ==");
  for (const { status, enabled, count } of countsAfter) {
    console.log(`- ${status} (enabled=${enabled}): ${count}`);
  }
}

async function rollback({ reportPath, unsafe }) {
  if (!reportPath) {
    throw new Error("Rollback requires --report=PATH (a report generated by a prior migration run).");
  }
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}`);
  }

  console.log(`\n== Rollback using report ==\n${reportPath}\n`);

  const rl = readline.createInterface({
    input: fs.createReadStream(reportPath),
    crlfDelay: Infinity,
  });

  const batchesByKey = new Map(); // `${fromStatus}|${fromEnabled}` -> [id, id, ...]
  let totalReverted = 0;
  let sawHeader = false;

  async function flush(key) {
    const ids = batchesByKey.get(key);
    if (!ids?.length) return;

    const [fromStatus, fromEnabledRaw] = String(key).split("|", 2);
    const fromEnabled = fromEnabledRaw === "true";
    const res = await db.query(
      `UPDATE product_assets
       SET status = $1,
           enabled = $2,
           updated_at = NOW()
       WHERE id = ANY($3::text[])`,
      [fromStatus, fromEnabled, ids]
    );
    totalReverted += Number(res.rowCount ?? 0);
    batchesByKey.set(key, []);
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj?.kind === "migrate-statuses-report") {
      sawHeader = true;
      continue;
    }

    if (obj?.model !== "ProductAsset" || !obj?.id || !obj?.fromStatus) continue;
    const fromStatus = String(obj.fromStatus);
    const fromEnabled = Boolean(obj.fromEnabled);
    const id = String(obj.id);

    const key = `${fromStatus}|${fromEnabled}`;
    if (!batchesByKey.has(key)) batchesByKey.set(key, []);
    const batch = batchesByKey.get(key);
    batch.push(id);

    if (batch.length >= 500) {
      await flush(key);
      console.log(`↩️  Reverted 500 row(s) back to: status=${fromStatus} enabled=${fromEnabled}`);
    }
  }

  if (!sawHeader && !unsafe) {
    throw new Error(
      "Report header missing/invalid. Refusing rollback without --unsafe (to avoid reverting unrelated rows)."
    );
  }

  for (const key of batchesByKey.keys()) {
    await flush(key);
  }

  console.log(`\nRollback complete. Reverted ${totalReverted} row(s).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Load local env files if present (kept minimal to avoid extra deps like dotenv).
  // Order: least-specific -> most-specific.
  loadEnvFileIfPresent(path.join(process.cwd(), ".env"), { preferDotenv: args.preferDotenv });
  loadEnvFileIfPresent(path.join(process.cwd(), ".env.local"), { preferDotenv: args.preferDotenv });
  loadEnvFileIfPresent(path.join(process.cwd(), ".env.production"), { preferDotenv: args.preferDotenv });

  const defaultReportPath = path.join(
    process.cwd(),
    "tmp",
    `migrate-statuses-${timestampForFilename()}.ndjson`
  );
  const reportPath = args.reportPath ?? defaultReportPath;

  console.log("migrate-statuses");

  // Use shared DATABASE_URL resolver (handles Railway internal hosts, validation, etc.)
  const resolved = resolveDatabaseUrl({ checkPassword: true });
  logConnectionInfo(resolved);

  db = new Client({
    connectionString: resolved.url,
    ssl: getSslConfig(resolved.url),
  });

  await db.connect();

  if (args.rollback) {
    await rollback({ reportPath, unsafe: args.unsafe });
  } else {
    await migrate({ dryRun: args.dryRun, reportPath });
  }
}

main()
  .then(async () => {
    await db.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ migrate-statuses failed:", err?.message ?? err);
    try {
      await db.end();
    } catch {
      // ignore
    }
    process.exit(1);
  });

