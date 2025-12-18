/**
 * Card - White card container with neutral border
 * Mobile-first padding (p-4 md:p-6)
 */
export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-xl border border-neutral-200 p-4 md:p-6 ${className}`}>
      {children}
    </div>
  );
}

