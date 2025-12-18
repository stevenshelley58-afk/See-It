/**
 * UsageBar - Progress bar showing used/limit with label
 * Mobile-first spacing
 */
export function UsageBar({ used, limit, label }) {
  const percentage = (used / limit) * 100;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-neutral-600">{label}</span>
        <span className="text-neutral-900 font-medium">{used} / {limit}</span>
      </div>
      <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all duration-500 ${
            percentage > 80 ? 'bg-amber-500' : 'bg-neutral-900'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

