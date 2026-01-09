'use client';

import { useState } from 'react';
import Link from 'next/link';

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

interface NodeInspectorProps {
  nodeKey: string | null;
  signals: Signal[];
  artifacts: Artifact[];
  modelCalls: ModelCall[];
}

export default function NodeInspector({
  nodeKey,
  signals,
  artifacts,
  modelCalls,
}: NodeInspectorProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'evidence' | 'artifacts' | 'modelCall' | 'tests'>('summary');

  if (!nodeKey) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center">
        Select a node to view details
      </div>
    );
  }

  const nodeSignals = signals.filter(s => s.nodeKey === nodeKey);
  const nodeArtifacts = artifacts.filter(a => a.nodeKey === nodeKey);
  const nodeModelCalls = modelCalls.filter(m => m.nodeKey === nodeKey);

  const intendedSignals = nodeSignals.filter(s => s.signalType === 'intended');
  const attemptedSignals = nodeSignals.filter(s => s.signalType === 'attempted');
  const producedSignals = nodeSignals.filter(s => s.signalType === 'produced');
  const observedSignals = nodeSignals.filter(s => s.signalType === 'observed');

  const tabs = [
    { id: 'summary' as const, label: 'Summary' },
    { id: 'evidence' as const, label: 'Evidence Timeline' },
    { id: 'artifacts' as const, label: 'Artifacts', count: nodeArtifacts.length },
    { id: 'modelCall' as const, label: 'Model Call', count: nodeModelCalls.length },
    { id: 'tests' as const, label: 'Tests' },
  ];

  return (
    <div className="space-y-4">
      <div className="border-b border-gray-200">
        <div className="flex gap-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {activeTab === 'summary' && (
          <div className="space-y-4">
            {/* 4 stacked cards */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm font-medium text-blue-900 mb-2">Intended</div>
              {intendedSignals.length > 0 ? (
                <div className="text-sm text-blue-700">
                  {intendedSignals.length} signal(s) - {new Date(intendedSignals[0].timestampMs).toLocaleString()}
                </div>
              ) : (
                <div className="text-sm text-blue-600">No intended signals</div>
              )}
            </div>

            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="text-sm font-medium text-yellow-900 mb-2">Attempted</div>
              {attemptedSignals.length > 0 ? (
                <div className="text-sm text-yellow-700">
                  {attemptedSignals.length} signal(s) - {new Date(attemptedSignals[0].timestampMs).toLocaleString()}
                </div>
              ) : (
                <div className="text-sm text-yellow-600">No attempted signals</div>
              )}
            </div>

            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="text-sm font-medium text-green-900 mb-2">Produced</div>
              {producedSignals.length > 0 ? (
                <div className="text-sm text-green-700">
                  {producedSignals.length} signal(s) - {new Date(producedSignals[0].timestampMs).toLocaleString()}
                </div>
              ) : (
                <div className="text-sm text-green-600">No produced signals</div>
              )}
            </div>

            <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="text-sm font-medium text-purple-900 mb-2">Observed</div>
              {observedSignals.length > 0 ? (
                <div className="text-sm text-purple-700">
                  {observedSignals.length} signal(s) - {new Date(observedSignals[0].timestampMs).toLocaleString()}
                </div>
              ) : (
                <div className="text-sm text-purple-600">No observed signals</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'evidence' && (
          <div className="space-y-2">
            {nodeSignals
              .sort((a, b) => a.timestampMs - b.timestampMs)
              .map((signal) => (
                <div
                  key={signal.id}
                  className="p-3 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{signal.signalType}</span>
                    <span className="text-xs text-gray-500">
                      {new Date(signal.timestampMs).toLocaleString()}
                    </span>
                  </div>
                  {signal.payload && (
                    <pre className="text-xs bg-gray-50 p-2 rounded mt-2 overflow-x-auto">
                      {JSON.stringify(signal.payload, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
          </div>
        )}

        {activeTab === 'artifacts' && (
          <div className="space-y-2">
            {nodeArtifacts.length > 0 ? (
              nodeArtifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="p-3 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Link
                      href={`/monitor/see-it/artifacts/${artifact.artifactId}`}
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      {artifact.artifactId}
                    </Link>
                    <span className="text-xs text-gray-500">{artifact.type}</span>
                  </div>
                  {artifact.storageKey && (
                    <div className="mb-2">
                      <img
                        src={artifact.storageKey}
                        alt={artifact.artifactId}
                        className="w-full max-h-56 object-contain bg-gray-50 rounded"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                  {artifact.storageKey && (
                    <div className="text-xs text-gray-600 break-all">
                      {artifact.storageKey}
                    </div>
                  )}
                  {artifact.width && artifact.height && (
                    <div className="text-xs text-gray-500 mt-1">
                      {artifact.width} × {artifact.height}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500 py-4 text-center">
                No artifacts for this node
              </div>
            )}
          </div>
        )}

        {activeTab === 'modelCall' && (
          <div className="space-y-2">
            {nodeModelCalls.length > 0 ? (
              nodeModelCalls.map((call) => (
                <div
                  key={call.id}
                  className="p-3 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Link
                      href={`/monitor/see-it/model-calls/${call.modelCallId}`}
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      {call.modelCallId}
                    </Link>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      call.status === 'success' ? 'bg-green-100 text-green-700' :
                      call.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {call.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {call.provider} / {call.model}
                  </div>
                  {call.latencyMs && (
                    <div className="text-xs text-gray-500 mt-1">
                      {call.latencyMs}ms
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500 py-4 text-center">
                No model calls for this node
              </div>
            )}
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="text-sm text-gray-500 py-4 text-center">
            Tests will be available here (TODO: arch-02)
          </div>
        )}
      </div>
    </div>
  );
}
