import { db } from '@/lib/db/client';
import { modelCalls, artifacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Image from 'next/image';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ modelCallId: string }>;
}

export default async function ModelCallViewerPage({ params }: PageProps) {
  const { modelCallId } = await params;

  // Get model call
  const callRecords = await db
    .select()
    .from(modelCalls)
    .where(eq(modelCalls.modelCallId, modelCallId))
    .limit(1);

  if (callRecords.length === 0) {
    notFound();
  }

  const call = callRecords[0];

  // Get prompt artifact if available
  let promptArtifact = null;
  if (call.promptArtifactId) {
    const artifactRecords = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.artifactId, call.promptArtifactId))
      .limit(1);
    promptArtifact = artifactRecords[0] || null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Model Call: {modelCallId}</h1>
        <div className="mt-2 text-sm text-gray-600">
          {call.provider} / {call.model}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-4">Inputs</h2>
          
          {promptArtifact && promptArtifact.storageKey && (
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-700 mb-2">Prompt Image</div>
              <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden">
                <Image
                  src={promptArtifact.storageKey}
                  alt="Prompt"
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
            </div>
          )}

          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-500">Prompt Hash:</span>
              <span className="ml-2 font-mono text-xs break-all">
                {call.promptHash || 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Config Hash:</span>
              <span className="ml-2 font-mono text-xs break-all">
                {call.configHash || 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Outputs */}
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-4">Outputs</h2>
          
          <div className="space-y-4">
            <div>
              <span className={`text-sm px-2 py-1 rounded ${
                call.status === 'success' ? 'bg-green-100 text-green-700' :
                call.status === 'failed' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {call.status}
              </span>
            </div>

            {call.latencyMs && (
              <div className="text-sm">
                <span className="text-gray-500">Latency:</span>
                <span className="ml-2 font-medium">{call.latencyMs}ms</span>
              </div>
            )}

            {call.failureClass && (
              <div className="text-sm">
                <span className="text-gray-500">Failure Class:</span>
                <span className="ml-2 font-medium">{call.failureClass}</span>
              </div>
            )}

            {/* Output artifacts would be linked here */}
            <div className="text-sm text-gray-500">
              Output artifacts (TODO: link from artifacts table)
            </div>
          </div>
        </div>
      </div>

      {/* Replay controls placeholder */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-4">Replay</h2>
        <div className="text-sm text-gray-500">
          Replay controls (TODO: implement replay functionality)
        </div>
      </div>
    </div>
  );
}
