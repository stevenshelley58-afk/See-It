/**
 * PageShell - Wrapper for page content with consistent spacing
 * Mobile-first: p-4 md:p-8, space-y-4 md:space-y-8
 */
export function PageShell({ children, className = "" }) {
  return (
    <div className={`p-4 md:p-8 bg-neutral-50 min-h-screen ${className}`}>
      <div className="max-w-5xl space-y-4 md:space-y-8">
        {children}
      </div>
    </div>
  );
}

