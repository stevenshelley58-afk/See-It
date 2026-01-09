import { db } from '@/lib/db/client';
import { archetypes, archetypeMatches, sessions } from '@/lib/db/schema';
import { eq, sql, desc, gte } from 'drizzle-orm';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export default async function ArchetypesPage() {
  // Get all archetypes
  const allArchetypes = await db
    .select()
    .from(archetypes)
    .orderBy(archetypes.title);

  // Get match counts for each archetype
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const archetypesWithCounts = await Promise.all(
    allArchetypes.map(async (archetype) => {
      // Count matches in last 24h
      const matches24h = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(archetypeMatches)
        .where(
          sql`${archetypeMatches.archetypeId} = ${archetype.id} AND ${archetypeMatches.createdAt} >= ${last24h}`
        );

      // Count matches in last 7d
      const matches7d = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(archetypeMatches)
        .where(
          sql`${archetypeMatches.archetypeId} = ${archetype.id} AND ${archetypeMatches.createdAt} >= ${last7d}`
        );

      return {
        ...archetype,
        count24h: Number(matches24h[0]?.count || 0),
        count7d: Number(matches7d[0]?.count || 0),
      };
    })
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Archetypes</h1>
      </div>

      <div className="card divide-y divide-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Severity
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Last 24h
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Last 7d
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {archetypesWithCounts.map((archetype) => (
                <tr key={archetype.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/monitor/see-it/archetypes/${archetype.id}`}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {archetype.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {archetype.severity && (
                      <span
                        className={`text-xs px-2 py-1 rounded ${
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
                  </td>
                  <td className="px-4 py-3 text-sm">{archetype.count24h}</td>
                  <td className="px-4 py-3 text-sm">{archetype.count7d}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/monitor/see-it/archetypes/${archetype.id}`}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {archetypesWithCounts.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            No archetypes defined yet
          </div>
        )}
      </div>
    </div>
  );
}
