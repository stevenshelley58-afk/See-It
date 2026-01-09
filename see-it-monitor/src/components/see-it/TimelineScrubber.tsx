'use client';

import { useState } from 'react';

interface Signal {
  id: string;
  timestampMs: number;
  signalType: 'intended' | 'attempted' | 'produced' | 'observed';
  nodeKey: string;
}

interface TimelineScrubberProps {
  signals: Signal[];
  selectedTimestampMs: number | null;
  onTimestampChange: (timestampMs: number | null) => void;
}

export default function TimelineScrubber({
  signals,
  selectedTimestampMs,
  onTimestampChange,
}: TimelineScrubberProps) {
  const [hoveredTick, setHoveredTick] = useState<number | null>(null);

  if (signals.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4">
        No signals to display
      </div>
    );
  }

  // Sort signals by timestamp
  const sortedSignals = [...signals].sort(
    (a, b) => a.timestampMs - b.timestampMs
  );

  const startTime = sortedSignals[0].timestampMs;
  const endTime = sortedSignals[sortedSignals.length - 1].timestampMs;
  const duration = endTime - startTime;

  const getSignalColor = (signalType: string) => {
    switch (signalType) {
      case 'intended': return 'bg-blue-500';
      case 'attempted': return 'bg-yellow-500';
      case 'produced': return 'bg-green-500';
      case 'observed': return 'bg-purple-500';
      default: return 'bg-gray-500';
    }
  };

  const getPosition = (timestampMs: number) => {
    return ((timestampMs - startTime) / duration) * 100;
  };

  const handleTickClick = (signal: Signal) => {
    onTimestampChange(signal.timestampMs);
  };

  const selectedPosition = selectedTimestampMs
    ? getPosition(selectedTimestampMs)
    : null;

  return (
    <div className="relative w-full py-4">
      {/* Timeline track */}
      <div className="relative h-2 bg-gray-200 rounded-full">
        {/* Selected indicator */}
        {selectedPosition !== null && (
          <div
            className="absolute top-0 h-2 w-0.5 bg-blue-600 z-10"
            style={{ left: `${selectedPosition}%` }}
          >
            <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-blue-600" />
          </div>
        )}

        {/* Signal ticks */}
        {sortedSignals.map((signal, index) => {
          const position = getPosition(signal.timestampMs);
          const isSelected =
            selectedTimestampMs !== null &&
            Math.abs(signal.timestampMs - selectedTimestampMs) < 1000;

          return (
            <div
              key={signal.id}
              className={`absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2 cursor-pointer transition-all ${
                isSelected ? 'z-20' : 'z-0'
              }`}
              style={{ left: `${position}%` }}
              onClick={() => handleTickClick(signal)}
              onMouseEnter={() => setHoveredTick(index)}
              onMouseLeave={() => setHoveredTick(null)}
            >
              <div
                className={`w-3 h-3 rounded-full border-2 border-white shadow ${
                  getSignalColor(signal.signalType)
                } ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
                title={`${signal.signalType} - ${signal.nodeKey} - ${new Date(signal.timestampMs).toLocaleTimeString()}`}
              />
              {hoveredTick === index && (
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap">
                  <div className="font-medium">{signal.nodeKey}</div>
                  <div className="text-gray-300">{signal.signalType}</div>
                  <div className="text-gray-400">{new Date(signal.timestampMs).toLocaleTimeString()}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time labels */}
      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <span>{new Date(startTime).toLocaleTimeString()}</span>
        <span>{new Date(endTime).toLocaleTimeString()}</span>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span>Intended</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <span>Attempted</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>Produced</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-purple-500" />
          <span>Observed</span>
        </div>
      </div>
    </div>
  );
}
