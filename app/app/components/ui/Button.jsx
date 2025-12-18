/**
 * Button - Primary and Secondary button variants
 * Mobile-first with active: states and md:hover: for desktop
 * Supports full-width on mobile (w-full md:w-auto)
 */
export function Button({ 
  children, 
  variant = "primary", 
  size = "md",
  className = "",
  ...props 
}) {
  const baseClasses = "font-medium rounded-lg transition-colors";
  
  const variantClasses = {
    primary: "bg-neutral-900 text-white active:bg-neutral-800 md:hover:bg-neutral-800",
    secondary: "bg-neutral-100 text-neutral-700 active:bg-neutral-200 md:hover:bg-neutral-200",
  };
  
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-3 py-2 md:px-4 text-sm",
    lg: "px-4 py-2.5 text-sm",
  };
  
  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

