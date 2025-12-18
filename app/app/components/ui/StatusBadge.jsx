/**
 * StatusBadge - Displays status with colored dot and text
 * Status can be: 'ready', 'error', 'pending'
 * On small screens, text can be hidden (use hidden sm:inline)
 */
export function StatusBadge({ status }) {
  const styles = {
    ready: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    error: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
    pending: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    processing: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  };
  
  const style = styles[status] || styles.pending;
  
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${style.bg} ${style.text}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {status}
    </div>
  );
}

