/**
 * StatCard - Displays a stat with label, value, and optional subtitle
 * Mobile-first: smaller padding/text on mobile, subtitle hidden on mobile
 * Supports highlight mode (dark background)
 */
export function StatCard({ label, value, subtitle, highlight = false, compact = false }) {
  return (
    <div className={`p-4 md:p-6 rounded-xl border ${
      highlight 
        ? 'bg-neutral-900 text-white border-neutral-900' 
        : 'bg-white border-neutral-200'
    }`}>
      <div className={`text-xs md:text-sm mb-0.5 md:mb-1 ${
        highlight ? 'text-neutral-400' : 'text-neutral-500'
      }`}>
        {label}
      </div>
      <div className={`${compact ? 'text-2xl' : 'text-2xl md:text-3xl'} font-semibold tracking-tight`}>
        {value}
      </div>
      {subtitle && !compact && (
        <div className={`text-xs md:text-sm mt-1 ${highlight ? 'text-neutral-400' : 'text-neutral-500'} hidden md:block`}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

