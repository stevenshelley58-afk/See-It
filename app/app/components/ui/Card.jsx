/**
 * Card - White card container with subtle shadow
 * Mobile-first padding (p-4 md:p-6)
 */
export function Card({ children, className = "" }) {
  // Option A (Recommended): Surface + Radius + Border + Subtle Shadow
  // Mapping manual values to token variables defined in tailwind.css :root
  return (
    <div
      className={`
        bg-[var(--si-surface)] 
        rounded-[16px] 
        border border-[var(--si-border-soft)] 
        shadow-[var(--si-shadow-card)] 
        p-4 md:p-6 
        ${className}
      `}
    >
      {children}
    </div>
  );
}

