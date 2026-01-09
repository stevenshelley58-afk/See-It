import { db } from '@/lib/db/client';
import { sessions, runSignals, artifacts } from '@/lib/db/schema';
import { eq, desc, and, or, like, sql } from 'drizzle-orm';
import Link from 'next/link';
import Image from 'next/image';
import RunsFilters from './RunsFilters';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

interface PageProps {
  searchParams: Promise<{
    flow?: string;
    env?: string;
    status?: string;
    search?: string;
  }>;
}

export default async function RunsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const flow = params.flow;
  const env = params.env;
  const status = params.status;
  const search = params.search;

  // Build query conditions
  const conditions = [];
  if (flow && flow !== 'all') {
    conditions.push(eq(sessions.flow, flow));
  }
  if (env && env !== 'all') {
    conditions.push(eq(sessions.env, env));
  }
  if (status && status !== 'all') {
    if (status === 'divergent') {
      conditions.push(eq(sessions.outcome, 'divergent'));
    } else if (status === 'error') {
      conditions.push(eq(sessions.outcome, 'error'));
    } else if (status === 'validator_fail') {
      conditions.push(eq(sessions.outcome, 'validator_fail'));
    } else if (status === 'ui_mismatch') {
      conditions.push(eq(sessions.outcome, 'ui_mismatch'));
    } else if (status === 'ok') {
      conditions.push(eq(sessions.outcome, 'ok'));
    }
  }
  if (search) {
    conditions.push(
      or(
        like(sessions.sessionId, `%${search}%`),
        like(sessions.shopDomain, `%${search}%`),
        like(sessions.productTitle || sql`''`, `%${search}%`)
      )!
    );
  }

  // Get runs (sessions) with pagination
  const runs = await db
    .select()
    .from(sessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sessions.startedAt))
    .limit(100);

  // Get user-saw and produced artifacts for each run
  const runsWithArtifacts = await Promise.all(
    runs.map(async (run) => {
      // Get user-saw artifact (from ui_render_observed signals)
      const userSawSignals = await db
        .select()
        .from(runSignals)
        .where(
          and(
            eq(runSignals.sessionId, run.id),
            eq(runSignals.signalType, 'observed'),
            eq(runSignals.nodeKey, 'ui:render_final')
          )
        )
        .orderBy(desc(runSignals.timestamp))
        .limit(1);

      let userSawArtifactId: string | null = null;
      if (userSawSignals.length > 0 && userSawSignals[0].payload) {
        const payload = userSawSignals[0].payload as { displayedArtifactId?: string; artifactId?: string };
        userSawArtifactId = payload.displayedArtifactId || payload.artifactId || null;
      }

      // Get latest produced artifact (from produced signals)
      const producedSignals = await db
        .select()
        .from(runSignals)
        .where(
          and(
            eq(runSignals.sessionId, run.id),
            eq(runSignals.signalType, 'produced'),
            eq(runSignals.nodeKey, 'ui:render_final')
          )
        )
        .orderBy(desc(runSignals.timestamp))
        .limit(1);

      let producedArtifactId: string | null = null;
      if (producedSignals.length > 0 && producedSignals[0].payload) {
        const payload = producedSignals[0].payload as { artifactId?: string };
        producedArtifactId = payload.artifactId || null;
      }

      // Get artifact URLs if available
      let userSawUrl: string | null = null;
      let producedUrl: string | null = null;

      if (userSawArtifactId) {
        const artifact = await db
          .select()
          .from(artifacts)
          .where(eq(artifacts.artifactId, userSawArtifactId))
          .limit(1);
        if (artifact.length > 0) {
          userSawUrl = artifact[0].storageKey || null;
        }
      }

      if (producedArtifactId) {
        const artifact = await db
          .select()
          .from(artifacts)
          .where(eq(artifacts.artifactId, producedArtifactId))
          .limit(1);
        if (artifact.length > 0) {
          producedUrl = artifact[0].storageKey || null;
        }
      }

      return {
        ...run,
        userSawUrl,
        producedUrl,
      };
    })
  );

  const getOutcomeBadge = (outcome: string | null) => {
    if (!outcome || outcome === 'unknown') return { text: 'Unknown', bg: 'bg-gray-100 text-gray-700' };
    if (outcome === 'ok') return { text: 'OK', bg: 'bg-green-100 text-green-700' };
    if (outcome === 'divergent') return { text: 'Divergent', bg: 'bg-yellow-100 text-yellow-700' };
    if (outcome === 'error') return { text: 'Error', bg: 'bg-red-100 text-red-700' };
    if (outcome === 'ui_mismatch') return { text: 'UI Mismatch', bg: 'bg-orange-100 text-orange-700' };
    return { text: outcome, bg: 'bg-gray-100 text-gray-700' };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Runs</h1>
      </div>

      {/* Filters */}
      <RunsFilters flow={flow} env={env} status={status} search={search} />

      {/* Runs Table */}
      <div className="card divide-y divide-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Flow</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Env</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Outcome</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">First Divergence</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shop</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runsWithArtifacts.map((run) => {
                const outcomeBadge = getOutcomeBadge(run.outcome);
                return (
                  <tr
                    key={run.id}
                    className="hover:bg-gray-50 group"
                  >
                    <td className="px-4 py-3 text-sm">
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">{run.flow || 'unknown'}</td>
                    <td className="px-4 py-3 text-sm">{run.env || 'unknown'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${outcomeBadge.bg}`}>
                        {outcomeBadge.text}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {run.firstDivergenceNodeKey || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">{run.shopDomain}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {/* Hover preview */}
                        <div className="hidden group-hover:flex gap-2 absolute bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-10">
                          {run.userSawUrl && (
                            <div className="w-32 h-20 relative">
                              <Image
                                src={run.userSawUrl}
                                alt="User saw"
                                fill
                                className="object-cover rounded"
                                unoptimized
                              />
                              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 text-center">
                                User saw
                              </div>
                            </div>
                          )}
                          {run.producedUrl && run.producedUrl !== run.userSawUrl && (
                            <div className="w-32 h-20 relative">
                              <Image
                                src={run.producedUrl}
                                alt="Produced"
                                fill
                                className="object-cover rounded"
                                unoptimized
                              />
                              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 text-center">
                                Produced
                              </div>
                            </div>
                          )}
                        </div>
                        <Link
                          href={`/monitor/see-it/runs/${run.sessionId}`}
                          className="text-blue-600 hover:underline text-sm"
                        >
                          Open
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {runsWithArtifacts.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            No runs found
          </div>
        )}
      </div>
    </div>
  );
}
