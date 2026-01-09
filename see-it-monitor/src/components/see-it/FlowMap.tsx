'use client';

import { useEffect } from 'react';

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
}

interface FlowMapProps {
  nodes: Node[];
  signals: Signal[];
  firstDivergenceNodeKey: string | null;
  selectedNodeKey: string | null;
  onNodeSelect: (nodeKey: string | null) => void;
}

export default function FlowMap({
  nodes,
  signals,
  firstDivergenceNodeKey,
  selectedNodeKey,
  onNodeSelect,
}: FlowMapProps) {
  // Auto-select first divergence on mount
  useEffect(() => {
    if (firstDivergenceNodeKey && !selectedNodeKey) {
      onNodeSelect(firstDivergenceNodeKey);
    }
  }, [firstDivergenceNodeKey, selectedNodeKey, onNodeSelect]);

  // Group nodes by lane
  const lanes = ['UI', 'API', 'Worker', 'Model', 'Storage', 'DB'];
  const nodesByLane = lanes.reduce((acc, lane) => {
    acc[lane] = nodes
      .filter(n => n.lane === lane)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    return acc;
  }, {} as Record<string, Node[]>);

  // Get signal states for a node
  const getNodeState = (nodeKey: string) => {
    const nodeSignals = signals.filter(s => s.nodeKey === nodeKey);
    return {
      intended: nodeSignals.some(s => s.signalType === 'intended'),
      attempted: nodeSignals.some(s => s.signalType === 'attempted'),
      produced: nodeSignals.some(s => s.signalType === 'produced'),
      observed: nodeSignals.some(s => s.signalType === 'observed'),
    };
  };

  const getStateColor = (hasSignal: boolean) => {
    return hasSignal ? 'bg-current' : 'bg-gray-300';
  };

  return (
    <div className="space-y-6">
      {lanes.map((lane) => {
        const laneNodes = nodesByLane[lane];
        if (laneNodes.length === 0) return null;

        return (
          <div key={lane} className="border-b border-gray-200 pb-4 last:border-b-0">
            <h3 className="text-sm font-medium text-gray-700 mb-3 sticky top-0 bg-white py-1">
              {lane}
            </h3>
            <div className="space-y-2">
              {laneNodes.map((node) => {
                const state = getNodeState(node.nodeKey);
                const isDivergence = firstDivergenceNodeKey === node.nodeKey;
                const isSelected = selectedNodeKey === node.nodeKey;

                return (
                  <div
                    key={node.id}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      isDivergence
                        ? 'border-red-500 bg-red-50'
                        : isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                    onClick={() => onNodeSelect(isSelected ? null : node.nodeKey)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900">
                        {node.nodeKey}
                      </span>
                      {isDivergence && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                          First Divergence
                        </span>
                      )}
                    </div>
                    {/* 4-state dots */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <div
                          className={`w-2 h-2 rounded-full ${getStateColor(state.intended)} text-blue-500`}
                          title="Intended"
                        />
                        <span className="text-xs text-gray-500">I</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div
                          className={`w-2 h-2 rounded-full ${getStateColor(state.attempted)} text-yellow-500`}
                          title="Attempted"
                        />
                        <span className="text-xs text-gray-500">A</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div
                          className={`w-2 h-2 rounded-full ${getStateColor(state.produced)} text-green-500`}
                          title="Produced"
                        />
                        <span className="text-xs text-gray-500">P</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div
                          className={`w-2 h-2 rounded-full ${getStateColor(state.observed)} text-purple-500`}
                          title="Observed"
                        />
                        <span className="text-xs text-gray-500">O</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
