'use client';

import { useState } from 'react';
import TimelineScrubber from '@/components/see-it/TimelineScrubber';
import FlowMap from '@/components/see-it/FlowMap';
import NodeInspector from '@/components/see-it/NodeInspector';
import Link from 'next/link';

interface Session {
  id: string;
  sessionId: string;
  flow: string | null;
  env: string | null;
  outcome: string | null;
  firstDivergenceNodeKey: string | null;
  startedAtMs: number;
}

interface Node {
  id: string;
  nodeKey: string;
  lane: string;
  orderIndex: number;
}

interface Signal {
  id: string;
  nodeKey: string;
  signalType: 'intended' | 'attempted' | 'produced' | 'observed';
  timestampMs: number;
  payload: Record<string, unknown> | null;
}

interface Artifact {
  id: string;
  artifactId: string;
  nodeKey: string | null;
  type: string;
  storageKey: string | null;
  width: number | null;
  height: number | null;
}

interface ModelCall {
  id: string;
  modelCallId: string;
  nodeKey: string | null;
  provider: string;
  model: string;
  status: string;
  latencyMs: number | null;
}

interface ArchetypeTest {
  id: string;
  testName: string;
}

interface ArchetypeMatch {
  archetypeId: string;
  title: string;
  severity: string | null;
  confidence: number;
  matchedTokens: string[];
  tests: ArchetypeTest[];
}

interface RunDetailClientProps {
  session: Session;
  nodes: Node[];
  signals: Signal[];
  artifacts: Artifact[];
  modelCalls: ModelCall[];
  archetypeMatches: ArchetypeMatch[];
}

export default function RunDetailClient({
  session,
  nodes,
  signals,
  artifacts,
  modelCalls,
  archetypeMatches,
}: RunDetailClientProps) {
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(
    session.firstDivergenceNodeKey
  );
  const [selectedTimestampMs, setSelectedTimestampMs] = useState<number | null>(null);
  const [runningTestId, setRunningTestId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ passed: boolean; evidence: unknown } | null>(null);

  const getOutcomeBadge = (outcome: string | null) => {
    if (!outcome || outcome === 'unknown') return { text: 'Unknown', bg: 'bg-gray-100 text-gray-700' };
    if (outcome === 'ok') return { text: 'OK', bg: 'bg-green-100 text-green-700' };
    if (outcome === 'divergent') return { text: 'Divergent', bg: 'bg-yellow-100 text-yellow-700' };
    if (outcome === 'error') return { text: 'Error', bg: 'bg-red-100 text-red-700' };
    if (outcome === 'ui_mismatch') return { text: 'UI Mismatch', bg: 'bg-orange-100 text-orange-700' };
    return { text: outcome, bg: 'bg-gray-100 text-gray-700' };
  };

  const outcomeBadge = getOutcomeBadge(session.outcome);
  const topMatch = archetypeMatches[0] || null;

  async function runTest(archetypeId: string, testId: string) {
    setRunningTestId(testId);
    setTestResult(null);
    try {
      const res = await fetch('/api/monitor/see-it/tests/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archetypeId,
          testId,
          sessionId: session.sessionId,
        }),
      });

      const json = (await res.json()) as
        | { success: true; passed: boolean; evidence: unknown }
        | { error: string; details?: string };

      if (!res.ok || 'error' in json) {
        throw new Error('error' in json ? json.error : 'Failed to run test');
      }

      setTestResult({ passed: json.passed, evidence: json.evidence });
    } catch (e) {
      setTestResult({ passed: false, evidence: { error: e instanceof Error ? e.message : String(e) } });
    } finally {
      setRunningTestId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">Run: {session.sessionId}</h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
              <span>Flow: {session.flow || 'unknown'}</span>
              <span>Env: {session.env || 'unknown'}</span>
              <span className={`badge ${outcomeBadge.bg}`}>
                {outcomeBadge.text}
              </span>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            {new Date(session.startedAtMs).toLocaleString()}
          </div>
        </div>

        {/* Timeline Scrubber */}
        <div className="border-t border-gray-200 pt-4">
          <TimelineScrubber
            signals={signals}
            selectedTimestampMs={selectedTimestampMs}
            onTimestampChange={setSelectedTimestampMs}
          />
        </div>
      </div>

      {/* 3-Pane Layout */}
      <div className="grid grid-cols-3 gap-4 h-[calc(100vh-300px)]">
        {/* Left Pane: Flow Map (Swimlanes) */}
        <div className="card p-4 overflow-auto">
          <FlowMap
            nodes={nodes}
            signals={signals}
            firstDivergenceNodeKey={session.firstDivergenceNodeKey}
            selectedNodeKey={selectedNodeKey}
            onNodeSelect={setSelectedNodeKey}
          />
        </div>

        {/* Middle Pane: Node Inspector */}
        <div className="card p-4 overflow-auto">
          <NodeInspector
            nodeKey={selectedNodeKey}
            signals={signals}
            artifacts={artifacts}
            modelCalls={modelCalls}
          />
        </div>

        {/* Right Pane: Archetype + Tests */}
        <div className="card p-4 overflow-auto">
          <h2 className="text-lg font-semibold mb-4">Archetype + Tests</h2>
          {session.firstDivergenceNodeKey ? (
            <div className="space-y-4">
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
                <div className="text-sm font-medium text-yellow-800">First Divergence</div>
                <div className="text-sm text-yellow-700 mt-1">{session.firstDivergenceNodeKey}</div>
              </div>

              {topMatch ? (
                <div className="p-3 border border-gray-200 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/monitor/see-it/archetypes/${topMatch.archetypeId}`}
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      {topMatch.title}
                    </Link>
                    <div className="text-xs text-gray-500">
                      Confidence: {(topMatch.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                  {topMatch.matchedTokens.length > 0 && (
                    <div className="text-xs text-gray-600">
                      Matched: {topMatch.matchedTokens.join(', ')}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-gray-500">No archetype match yet</div>
              )}

              {topMatch?.tests?.length ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-700">Confirmation Tests</div>
                  {topMatch.tests.map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-2 border border-gray-200 rounded">
                      <div className="text-sm">{t.testName}</div>
                      <button
                        className="text-sm px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                        disabled={runningTestId === t.id}
                        onClick={() => runTest(topMatch.archetypeId, t.id)}
                      >
                        {runningTestId === t.id ? 'Running…' : 'Run'}
                      </button>
                    </div>
                  ))}

                  {testResult && (
                    <div className={`p-3 rounded border ${testResult.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                      <div className={`text-sm font-medium ${testResult.passed ? 'text-green-800' : 'text-red-800'}`}>
                        {testResult.passed ? 'Passed' : 'Failed'}
                      </div>
                      <pre className="text-xs mt-2 bg-white/60 p-2 rounded overflow-x-auto">
                        {JSON.stringify(testResult.evidence, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-gray-500">No tests defined for matched archetype</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500">No divergence detected</div>
          )}
        </div>
      </div>
    </div>
  );
}
