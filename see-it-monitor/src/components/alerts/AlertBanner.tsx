'use client';

import { useEffect, useState } from 'react';

interface Alert {
  id: string;
  ruleId: string;
  message: string;
  severity: 'critical' | 'error' | 'warning';
  affectedShops?: string[];
  createdAt: string;
}

export function AlertBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await fetch('/api/alerts/active');
        if (res.ok) {
          const data = await res.json();
          setAlerts(data);
        }
      } catch (err) {
        console.error('Failed to fetch alerts:', err);
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000); // Every minute
    return () => clearInterval(interval);
  }, []);

  const activeAlerts = alerts.filter(a => !dismissed.has(a.id));

  if (activeAlerts.length === 0) return null;

  return (
    <div className="bg-red-50 border-b border-red-200">
      <div className="max-w-7xl mx-auto px-4 py-3">
        {activeAlerts.map((alert) => (
          <div key={alert.id} className="flex items-center justify-between mb-2 last:mb-0">
            <div className="flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full ${
                alert.severity === 'critical' ? 'bg-red-500' :
                alert.severity === 'error' ? 'bg-orange-500' : 'bg-yellow-500'
              }`} />
              <span className="font-medium text-red-900">{alert.message}</span>
              {alert.affectedShops && alert.affectedShops.length > 0 && (
                <span className="text-sm text-red-700">
                  ({alert.affectedShops.length} shop{alert.affectedShops.length !== 1 ? 's' : ''})
                </span>
              )}
            </div>
            <button
              onClick={() => setDismissed(prev => new Set([...prev, alert.id]))}
              className="text-red-700 hover:text-red-900 text-sm"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
