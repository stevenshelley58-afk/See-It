import { db } from '@/lib/db/client';
import { aiRequests } from '@/lib/db/schema';
import { sql, gte, eq } from 'drizzle-orm';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export const dynamic = 'force-dynamic';

export default async function CostsPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const requests = await db
    .select()
    .from(aiRequests)
    .where(gte(aiRequests.createdAt, thirtyDaysAgo));

  const totalCost = requests.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0);
  const regenerationCost = requests
    .filter(r => r.isRegeneration)
    .reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0);

  // By provider
  const byProvider = requests.reduce((acc, r) => {
    const provider = r.provider;
    acc[provider] = (acc[provider] || 0) + (Number(r.costUsd) || 0);
    return acc;
  }, {} as Record<string, number>);

  // By operation
  const byOperation = requests.reduce((acc, r) => {
    const op = r.operation;
    acc[op] = (acc[op] || 0) + (Number(r.costUsd) || 0);
    return acc;
  }, {} as Record<string, number>);

  const providerData = Object.entries(byProvider).map(([name, value]) => ({ name, value }));
  const operationData = Object.entries(byOperation).map(([name, value]) => ({ name, value }));

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Cost Analysis (Last 30 Days)</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-sm text-secondary mb-1">Total AI Spend</div>
          <div className="text-2xl font-semibold">${totalCost.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-secondary mb-1">Regeneration Waste</div>
          <div className="text-2xl font-semibold">${regenerationCost.toFixed(2)}</div>
          <div className="text-xs text-secondary mt-1">
            {totalCost > 0 ? Math.round((regenerationCost / totalCost) * 100) : 0}% of total
          </div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-secondary mb-1">Total Requests</div>
          <div className="text-2xl font-semibold">{requests.length}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="font-semibold mb-4">By Provider</h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={providerData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                {providerData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold mb-4">By Operation</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={operationData}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
