import { db } from '@/lib/db/client';
import { archetypes, archetypeMatches, archetypeTests, sessions } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ archetypeId: string }>;
}

export default async function ArchetypeDetailPage({ params }: PageProps) {
  const { archetypeId } = await params;

  // Get archetype
  const archetypeRecords = await db
    .select()
    .from(archetypes)
    .where(eq(archetypes.id, archetypeId))
    .limit(1);

  if (archetypeRecords.length === 0) {
    notFound();
  }

  const archetype = archetypeRecords[0];

  // Get recent matches
  const matches = await db
    .select()
    .from(archetypeMatches)
    .where(eq(archetypeMatches.archetypeId, archetype.id))
    .orderBy(desc(archetypeMatches.createdAt))
    .limit(20);

  // Get tests
  const tests = await db
    .select()
    .from(archetypeTests)
    .where(eq(archetypeTests.archetypeId, archetype.id));

  // Get sessions for matches
  const matchSessions = await Promise.all(
    matches.map(async (match) => {
      const sessionRecords = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, match.sessionId))
        .limit(1);
      return sessionRecords[0] || null;
    })
  );

  const signatureRules = archetype.signatureRules as unknown;
  const hasSignatureRules = signatureRules !== null && signatureRules !== undefined;
  const tags = Array.isArray(archetype.tags) ? (archetype.tags as string[]) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{archetype.title}</h1>
        {archetype.severity && (
          <span
            className={`mt-2 inline-block text-xs px-2 py-1 rounded ${
              archetype.severity === 'critical'
                ? 'bg-red-100 text-red-700'
                : archetype.severity === 'error'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {archetype.severity}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Signature & Symptoms */}
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-4">Signature & Symptoms</h2>
          {hasSignatureRules && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">Signature Rules</div>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                {JSON.stringify(signatureRules, null, 2)}
              </pre>
            </div>
          )}
          {tags.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium text-gray-700 mb-2">Tags</div>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Fix Playbook */}
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-4">Fix Playbook</h2>
          {archetype.fixPlaybook ? (
            <div className="text-sm whitespace-pre-wrap">{archetype.fixPlaybook}</div>
          ) : (
            <div className="text-sm text-gray-500">No playbook defined</div>
          )}
        </div>
      </div>

      {/* Tests */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-4">Confirmation Tests</h2>
        {tests.length > 0 ? (
          <div className="space-y-2">
            {tests.map((test) => (
              <div key={test.id} className="p-3 border border-gray-200 rounded-lg">
                <div className="text-sm font-medium">{test.testName}</div>
                {test.testDefinition !== null && test.testDefinition !== undefined && (
                  <pre className="text-xs bg-gray-50 p-2 rounded mt-2 overflow-x-auto">
                    {JSON.stringify(test.testDefinition, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No tests defined</div>
        )}
      </div>

      {/* Example Traces */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-4">Example Traces</h2>
        {matches.length > 0 ? (
          <div className="space-y-2">
            {matches.map((match, i) => {
              const session = matchSessions[i];
              return (
                <div
                  key={match.id}
                  className="p-3 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-2">
                    {session ? (
                      <Link
                        href={`/monitor/see-it/runs/${session.sessionId}`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {session.sessionId}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">Session not found</span>
                    )}
                    <div className="text-xs text-gray-500">
                      Confidence: {(match.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                  {Array.isArray(match.matchedTokens) && (
                    <div className="text-xs text-gray-600">
                      Matched: {(match.matchedTokens as string[]).join(', ')}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">
                    {match.createdAt ? new Date(match.createdAt).toLocaleString() : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No matches yet</div>
        )}
      </div>
    </div>
  );
}
