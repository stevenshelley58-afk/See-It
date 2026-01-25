import { Client } from "pg";

/**
 * Prints end-to-end timing deltas for the most recent composite run.
 *
 * Requires:
 * - DATABASE_URL pointing at the DB containing `composite_runs` + `monitor_events`
 *
 * Notes:
 * - Some "sf.*" events are emitted before `composite_runs` exists (no run_id), so we
 *   associate them to the run via `payload.roomSessionId` and choose the latest.
 */
function iso(v) {
  return v ? new Date(v).toISOString() : null;
}

function diffMs(a, b) {
  if (!a || !b) return null;
  return new Date(b).getTime() - new Date(a).getTime();
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const runRes = await client.query(
      `select
         id,
         shop_id,
         room_session_id,
         trace_id,
         created_at,
         completed_at,
         total_duration_ms
       from composite_runs
       order by created_at desc
       limit 1`
    );

    if (runRes.rowCount === 0) {
      console.log("No composite_runs rows found.");
      return;
    }

    const run = runRes.rows[0];

    const eventsRes = await client.query(
      `select ts, type, source, payload
       from monitor_events
       where shop_id = $1 and run_id = $2
       order by ts asc`,
      [run.shop_id, run.id]
    );

    const events = eventsRes.rows;

    const firstOf = (type) => events.find((e) => e.type === type)?.ts ?? null;
    const lastOf = (type) => {
      const arr = events.filter((e) => e.type === type);
      return arr.length ? arr[arr.length - 1].ts : null;
    };

    const runCreatedEvt = firstOf("composite.run.created");
    const runCompletedEvt = lastOf("composite.run.completed");
    const completedTs = runCompletedEvt || run.completed_at || null;

    // These events are emitted before a run exists, so they won't have run_id.
    // We link them to the run via the roomSessionId in payload (and pick the latest one).
    const uploadCompletedRes = await client.query(
      `select ts
       from monitor_events
       where shop_id = $1
         and type = $2
         and payload->>'roomSessionId' = $3
       order by ts desc
       limit 1`,
      [run.shop_id, "sf.upload.completed", run.room_session_id]
    );
    const uploadCompleted =
      uploadCompletedRes.rowCount > 0 ? uploadCompletedRes.rows[0].ts : null;

    const renderRequestedRes = await client.query(
      `select ts
       from monitor_events
       where shop_id = $1
         and type = $2
         and payload->>'roomSessionId' = $3
       order by ts desc
       limit 1`,
      [run.shop_id, "sf.render.requested", run.room_session_id]
    );
    const renderRequested =
      renderRequestedRes.rowCount > 0 ? renderRequestedRes.rows[0].ts : null;

    const out = {
      runId: run.id,
      shopId: run.shop_id,
      roomSessionId: run.room_session_id,
      traceId: run.trace_id,
      totalDurationMs: run.total_duration_ms,
      ts: {
        uploadCompleted: iso(uploadCompleted),
        renderRequested: iso(renderRequested),
        runCreatedEvent: iso(runCreatedEvt),
        runCompletedEvent: iso(runCompletedEvt),
        runTableCreatedAt: iso(run.created_at),
        runTableCompletedAt: iso(run.completed_at),
      },
      deltasMs: {
        // Closest available proxy for “user hit upload” in backend telemetry
        // (note: actual file bytes upload happens client->GCS after this)
        uploadCompleted_to_runCompleted: diffMs(uploadCompleted, completedTs),
        renderRequested_to_runCompleted: diffMs(renderRequested, completedTs),
        runCreatedEvent_to_runCompletedEvent: diffMs(runCreatedEvt, runCompletedEvt),
      },
      counts: {
        runEvents: events.length,
      },
    };

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

