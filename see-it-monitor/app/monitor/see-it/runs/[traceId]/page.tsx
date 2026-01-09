import { db } from '@/lib/db/client';
import { sessions, runNodes, runSignals, artifacts, modelCalls, archetypeMatches, archetypes, archetypeTests } from '@/lib/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import RunDetailClient from './RunDetailClient';
import { matchSessionToArchetypes } from '@/lib/see-it/archetypes/matcher';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ traceId: string }>;
}

export default async function RunDetailPage({ params }: PageProps) {
  const { traceId } = await params;

  function normalizeSignalType(signalType: string): 'intended' | 'attempted' | 'produced' | 'observed' {
    if (signalType === 'intended') return 'intended';
    if (signalType === 'attempted') return 'attempted';
    if (signalType === 'produced') return 'produced';
    return 'observed';
  }

  // Get session by sessionId (traceId)
  const sessionRecords = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, traceId))
    .limit(1);

  if (sessionRecords.length === 0) {
    notFound();
  }

  const session = sessionRecords[0];

  // Ensure archetype matches are computed (idempotent)
  await matchSessionToArchetypes(traceId);

  // Get all nodes for this run
  const nodes = await db
    .select()
    .from(runNodes)
    .where(eq(runNodes.sessionId, session.id))
    .orderBy(asc(runNodes.orderIndex));

  // Get all signals for this run
  const signals = await db
    .select()
    .from(runSignals)
    .where(eq(runSignals.sessionId, session.id))
    .orderBy(asc(runSignals.timestamp));

  // Get all artifacts for this run
  const runArtifacts = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.sessionId, session.id));

  // Get all model calls for this run
  const calls = await db
    .select()
    .from(modelCalls)
    .where(eq(modelCalls.sessionId, session.id));

  // Get archetype matches for this session
  const matches = await db
    .select()
    .from(archetypeMatches)
    .where(eq(archetypeMatches.sessionId, session.id))
    .orderBy(desc(archetypeMatches.confidence))
    .limit(3);

  const archetypeMatchesForClient = await Promise.all(
    matches.map(async (m) => {
      const archetype = await db
        .select()
        .from(archetypes)
        .where(eq(archetypes.id, m.archetypeId))
        .limit(1)
        .then((r) => r[0] || null);

      const tests = await db
        .select()
        .from(archetypeTests)
        .where(eq(archetypeTests.archetypeId, m.archetypeId));

      return {
        archetypeId: m.archetypeId,
        title: archetype?.title || 'Unknown archetype',
        severity: archetype?.severity || null,
        confidence: m.confidence,
        matchedTokens: (Array.isArray(m.matchedTokens) ? (m.matchedTokens as string[]) : []) || [],
        tests: tests.map((t) => ({ id: t.id, testName: t.testName })),
      };
    })
  );

  return (
    <RunDetailClient
      session={{
        id: session.id,
        sessionId: session.sessionId,
        flow: session.flow,
        env: session.env,
        outcome: session.outcome,
        firstDivergenceNodeKey: session.firstDivergenceNodeKey,
        startedAtMs: session.startedAt.getTime(),
      }}
      nodes={nodes.map((n) => ({
        id: n.id,
        nodeKey: n.nodeKey,
        lane: n.lane,
        orderIndex: n.orderIndex,
      }))}
      signals={signals.map((s) => ({
        id: s.id,
        nodeKey: s.nodeKey,
        signalType: normalizeSignalType(s.signalType),
        timestampMs: s.timestamp.getTime(),
        payload: (s.payload as Record<string, unknown> | null) ?? null,
      }))}
      artifacts={runArtifacts.map((a) => ({
        id: a.id,
        artifactId: a.artifactId,
        nodeKey: a.nodeKey,
        type: a.type,
        storageKey: a.storageKey,
        width: a.width,
        height: a.height,
      }))}
      modelCalls={calls.map((c) => ({
        id: c.id,
        modelCallId: c.modelCallId,
        nodeKey: c.nodeKey,
        provider: c.provider,
        model: c.model,
        status: c.status,
        latencyMs: c.latencyMs,
      }))}
      archetypeMatches={archetypeMatchesForClient}
    />
  );
}
