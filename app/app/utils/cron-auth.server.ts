/**
 * Consolidated cron job authentication utility.
 *
 * Validates that cron job requests have the correct CRON_SECRET.
 * In development (non-production), allows requests without a secret.
 */

/**
 * Validates cron job authorization.
 *
 * Checks for Bearer token in Authorization header against CRON_SECRET env var.
 * In development mode (NODE_ENV !== 'production'), allows requests if CRON_SECRET is not set.
 *
 * @param request - The incoming request
 * @param jobName - Name of the cron job for logging (e.g., "SessionCleanup", "MonitorPrune")
 * @returns Promise<boolean> - true if authorized, false otherwise
 */
export async function validateCronAuth(
  request: Request,
  jobName: string = "Cron"
): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;

  // If no CRON_SECRET is set, only allow in development
  if (!cronSecret) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[${jobName}] CRON_SECRET not set - allowing request in development`);
      return true;
    }
    console.error(`[${jobName}] CRON_SECRET not configured`);
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }

  // Support both "Bearer <token>" and raw token
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  return token === cronSecret;
}
