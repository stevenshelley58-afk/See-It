/**
 * Button - Primary and Secondary button variants
 * Mobile-first with active: states and md:hover: for desktop
 * Supports full-width on mobile (w-full md:w-auto)
 */
export function Button({ 
  children, 
  variant = "primary", 
  size = "md",
  shape = "default", // "default" | "pill"
  className = "",
  ...props 
}) {
  // Base: font, transition, center content
  const baseClasses = "font-medium inline-flex items-center justify-center transition-all duration-200 active:scale-[0.98]";
  
  // Radius: Default (12px) vs Pill (9999px)
  // Mapping to tokens: rounded-[12px] or rounded-full
  const radiusClass = shape === "pill" ? "rounded-full" : "rounded-xl"; // rounded-xl ~ 12px

  const variantClasses = {
    // Primary: Dark bg, white text, subtle shadow
    primary: "bg-[#171717] text-white hover:bg-[#262626] shadow-sm hover:shadow-md border border-transparent",
    // Secondary: White bg, dark text, border
    secondary: "bg-white text-[#1A1A1A] border border-[#E5E5E5] hover:border-[#A3A3A3] hover:bg-[#FAFAFA]",
    // Tertiary: Text only
    tertiary: "bg-transparent text-[#737373] hover:text-[#1A1A1A] hover:bg-black/5",
    // Destructive
    destructive: "bg-[#DC2626] text-white hover:bg-[#B91C1C] shadow-sm",
  };
  
  const sizeClasses = {
    sm: "h-9 px-4 text-xs tracking-wide",
    md: "h-[44px] px-5 text-[14px]", // Minimum touch target mapping
    lg: "h-[48px] px-6 text-[15px] font-semibold",
    icon: "h-[44px] w-[44px] p-0", // Fixed square/circle
  };
  
  const finalClass = `
    ${baseClasses} 
    ${radiusClass} 
    ${variantClasses[variant] || variantClasses.primary} 
    ${sizeClasses[size] || sizeClasses.md} 
    ${className}
  `.replace(/\s+/g, ' ').trim();
  
  return (
    <button className={finalClass} {...props}>
      {children}
    </button>
  );
}

