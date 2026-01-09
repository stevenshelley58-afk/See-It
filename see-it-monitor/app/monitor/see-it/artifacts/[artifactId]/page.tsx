import { db } from '@/lib/db/client';
import { artifacts, artifactEdges } from '@/lib/db/schema';
import { eq, or } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import ArtifactCompare from '@/components/see-it/ArtifactCompare';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ artifactId: string }>;
  searchParams: Promise<{ mode?: 'image' | 'overlay' | 'diff' }>;
}

export default async function ArtifactViewerPage({ params, searchParams }: PageProps) {
  const { artifactId } = await params;
  const { mode = 'image' } = await searchParams;

  // Get artifact
  const artifactRecords = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.artifactId, artifactId))
    .limit(1);

  if (artifactRecords.length === 0) {
    notFound();
  }

  const artifact = artifactRecords[0];

  // Get parent artifacts (edges where this is child)
  const parentEdges = await db
    .select()
    .from(artifactEdges)
    .where(eq(artifactEdges.childArtifactId, artifactId));

  // Get child artifacts (edges where this is parent)
  const childEdges = await db
    .select()
    .from(artifactEdges)
    .where(eq(artifactEdges.parentArtifactId, artifactId));

  // Get parent artifacts
  const parentArtifacts = parentEdges.length > 0
    ? await db
        .select()
        .from(artifacts)
        .where(
          or(...parentEdges.map(e => eq(artifacts.artifactId, e.parentArtifactId)))!
        )
    : [];

  // Get child artifacts
  const childArtifacts = childEdges.length > 0
    ? await db
        .select()
        .from(artifacts)
        .where(
          or(...childEdges.map(e => eq(artifacts.artifactId, e.childArtifactId)))!
        )
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Artifact: {artifactId}</h1>
          <div className="mt-2 text-sm text-gray-600">
            Type: {artifact.type} | Node: {artifact.nodeKey || 'N/A'}
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href={`/monitor/see-it/artifacts/${artifactId}?mode=image`}
            className={`px-3 py-2 text-sm rounded ${
              mode === 'image' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
            }`}
          >
            Image
          </a>
          <a
            href={`/monitor/see-it/artifacts/${artifactId}?mode=overlay`}
            className={`px-3 py-2 text-sm rounded ${
              mode === 'overlay' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
            }`}
          >
            Overlay
          </a>
          <a
            href={`/monitor/see-it/artifacts/${artifactId}?mode=diff`}
            className={`px-3 py-2 text-sm rounded ${
              mode === 'diff' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
            }`}
          >
            Diff
          </a>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main viewer */}
        <div className="col-span-2 card p-4">
          {artifact.storageKey ? (
            <div className="space-y-4">
              {mode === 'image' && (
                <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden">
                  <Image
                    src={artifact.storageKey}
                    alt={artifactId}
                    fill
                    className="object-contain"
                    unoptimized
                  />
                </div>
              )}
              {mode === 'overlay' && (
                <div className="text-sm text-gray-500">
                  Overlay mode - select a parent artifact to overlay
                </div>
              )}
              {mode === 'diff' && parentArtifacts.length > 0 && (
                <ArtifactCompare
                  artifact1={parentArtifacts[0]}
                  artifact2={artifact}
                />
              )}
              {mode === 'diff' && parentArtifacts.length === 0 && (
                <div className="text-sm text-gray-500">
                  No parent artifact available for diff
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500 py-8 text-center">
              No storage key available
            </div>
          )}

          {/* Metadata */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h3 className="text-sm font-medium mb-2">Metadata</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-gray-500">Width</dt>
                <dd className="font-medium">{artifact.width || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Height</dt>
                <dd className="font-medium">{artifact.height || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">MIME</dt>
                <dd className="font-medium">{artifact.mime || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">SHA256</dt>
                <dd className="font-medium font-mono text-xs break-all">
                  {artifact.sha256 || 'N/A'}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Lineage panel */}
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-4">Lineage</h2>
          
          {parentArtifacts.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Parents</h3>
              <div className="space-y-2">
                {parentArtifacts.map((parent) => (
                  <a
                    key={parent.id}
                    href={`/monitor/see-it/artifacts/${parent.artifactId}`}
                    className="block p-2 border border-gray-200 rounded hover:bg-gray-50 text-sm"
                  >
                    <div className="font-medium">{parent.artifactId}</div>
                    <div className="text-xs text-gray-500">{parent.type}</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {childArtifacts.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Children</h3>
              <div className="space-y-2">
                {childArtifacts.map((child) => (
                  <a
                    key={child.id}
                    href={`/monitor/see-it/artifacts/${child.artifactId}`}
                    className="block p-2 border border-gray-200 rounded hover:bg-gray-50 text-sm"
                  >
                    <div className="font-medium">{child.artifactId}</div>
                    <div className="text-xs text-gray-500">{child.type}</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {parentArtifacts.length === 0 && childArtifacts.length === 0 && (
            <div className="text-sm text-gray-500">
              No lineage data available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
