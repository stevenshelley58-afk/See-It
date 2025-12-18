/**
 * Card - White card container with subtle shadow
 * Mobile-first padding (p-4 md:p-6)
 */
export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm p-4 md:p-6 ${className}`}>
      {children}
    </div>
  );
}

