/**
 * usePolling Hook
 * Polls an API endpoint at regular intervals for real-time updates
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface PollingOptions {
  url: string;
  interval?: number; // Poll interval in milliseconds (default: 3000)
  enabled?: boolean; // Whether polling is enabled (default: true)
  onUpdate?: (data: unknown) => void; // Callback when new data arrives
}

interface PollingState {
  data: unknown | null;
  error: Error | null;
  isPolling: boolean;
  lastUpdate: Date | null;
}

export function usePolling<T = unknown>(options: PollingOptions) {
  const { url, interval = 3000, enabled = true, onUpdate } = options;
  
  const [state, setState] = useState<PollingState>({
    data: null,
    error: null,
    isPolling: false,
    lastUpdate: null,
  });

  const sinceRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const poll = useCallback(async () => {
    if (!enabled || !isMountedRef.current) return;

    setState((prev) => ({ ...prev, isPolling: true, error: null }));

    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      const urlWithSince = sinceRef.current
        ? `${url}?since=${encodeURIComponent(sinceRef.current)}`
        : url;

      const response = await fetch(urlWithSince, {
        signal: abortControllerRef.current.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as T & { latestTimestamp?: string };

      // Update since timestamp for next poll
      if (data && typeof data === 'object' && 'latestTimestamp' in data) {
        sinceRef.current = data.latestTimestamp as string;
      }

      if (isMountedRef.current) {
        setState((prev) => ({
          ...prev,
          data,
          error: null,
          isPolling: false,
          lastUpdate: new Date(),
        }));

        // Call onUpdate callback if provided
        if (onUpdate) {
          onUpdate(data);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was aborted, ignore
        return;
      }

      if (isMountedRef.current) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error : new Error('Unknown error'),
          isPolling: false,
        }));
      }
    }
  }, [url, enabled, onUpdate]);

  // Start polling
  useEffect(() => {
    if (!enabled) {
      return;
    }

    isMountedRef.current = true;

    // Initial poll
    poll();

    // Set up interval
    intervalRef.current = setInterval(() => {
      if (isMountedRef.current && enabled) {
        poll();
      }
    }, interval);

    // Cleanup
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [poll, interval, enabled]);

  // Pause polling when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden, pause polling
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        // Tab is visible, resume polling
        if (enabled && !intervalRef.current) {
          poll();
          intervalRef.current = setInterval(() => {
            if (isMountedRef.current && enabled) {
              poll();
            }
          }, interval);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [poll, interval, enabled]);

  // Manual refresh function
  const refresh = useCallback(() => {
    poll();
  }, [poll]);

  return {
    data: state.data as T | null,
    error: state.error,
    isPolling: state.isPolling,
    lastUpdate: state.lastUpdate,
    refresh,
  };
}
