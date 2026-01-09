'use client';

import { useState } from 'react';
import Image from 'next/image';

interface Artifact {
  id: string;
  artifactId: string;
  storageKey: string | null;
  width: number | null;
  height: number | null;
}

interface ArtifactCompareProps {
  artifact1: Artifact;
  artifact2: Artifact;
}

export default function ArtifactCompare({ artifact1, artifact2 }: ArtifactCompareProps) {
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);

  if (!artifact1.storageKey || !artifact2.storageKey) {
    return (
      <div className="text-sm text-gray-500 py-4 text-center">
        One or both artifacts missing storage keys
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(e) => setShowOverlay(e.target.checked)}
            className="rounded"
          />
          Show overlay
        </label>
        {showOverlay && (
          <div className="flex items-center gap-2 text-sm">
            <label>Opacity:</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="text-gray-500">{(overlayOpacity * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>

      {/* Side-by-side view */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-700">Artifact 1</div>
          <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden">
            <Image
              src={artifact1.storageKey}
              alt={artifact1.artifactId}
              fill
              className="object-contain"
              unoptimized
            />
          </div>
          <div className="text-xs text-gray-500">{artifact1.artifactId}</div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-700">Artifact 2</div>
          <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden">
            {showOverlay ? (
              <>
                <Image
                  src={artifact1.storageKey}
                  alt={artifact1.artifactId}
                  fill
                  className="object-contain"
                  unoptimized
                />
                <div
                  className="absolute inset-0"
                  style={{ opacity: overlayOpacity }}
                >
                  <Image
                    src={artifact2.storageKey}
                    alt={artifact2.artifactId}
                    fill
                    className="object-contain"
                    unoptimized
                  />
                </div>
              </>
            ) : (
              <Image
                src={artifact2.storageKey}
                alt={artifact2.artifactId}
                fill
                className="object-contain"
                unoptimized
              />
            )}
          </div>
          <div className="text-xs text-gray-500">{artifact2.artifactId}</div>
        </div>
      </div>

      {/* Diff placeholder */}
      <div className="border-t border-gray-200 pt-4">
        <div className="text-sm text-gray-500">
          Pixel diff view (TODO: implement image diff algorithm)
        </div>
      </div>
    </div>
  );
}
