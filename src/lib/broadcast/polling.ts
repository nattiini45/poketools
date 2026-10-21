'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseBroadcastPollOptions<T> {
  /** Pause polling (e.g., when tab hidden or overlay inactive). */
  enabled?: boolean;
  /** Fires only when data actually changes (deep compare). */
  onUpdate?: (prev: T, next: T) => void;
  /** Transform raw JSON response before storing. */
  transform?: (raw: unknown) => T;
}

interface UseBroadcastPollResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
}

/**
 * Polling hook for broadcast overlays.
 *
 * Features:
 * - Change detection: only re-renders when data actually changes
 * - Visibility API: pauses when tab is hidden (OBS sources are always "visible")
 * - Error resilience: maintains last good data, exponential backoff on failure
 */
export function useBroadcastPoll<T>(
  url: string,
  intervalMs: number,
  options?: UseBroadcastPollOptions<T>
): UseBroadcastPollResult<T> {
  const { enabled = true, onUpdate, transform } = options ?? {};

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const dataRef = useRef<T | null>(null);
  const backoffRef = useRef(intervalMs);
  const visibleRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Poll failed: ${res.status} ${res.statusText}`);
      }
      const raw = await res.json();
      const next = transform ? transform(raw) : (raw as T);

      // Change detection via JSON comparison
      const prevJson = JSON.stringify(dataRef.current);
      const nextJson = JSON.stringify(next);

      if (prevJson !== nextJson) {
        const prev = dataRef.current;
        dataRef.current = next;
        setData(next);
        setLastUpdated(new Date());

        if (prev !== null && onUpdate) {
          onUpdate(prev, next);
        }
      }

      setError(null);
      setLoading(false);
      // Reset backoff on success
      backoffRef.current = intervalMs;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
      // Exponential backoff: double interval, max 30s
      backoffRef.current = Math.min(backoffRef.current * 2, 30000);
    }
  }, [url, intervalMs, transform, onUpdate]);

  // Visibility API: track tab visibility
  useEffect(() => {
    function handleVisibility() {
      visibleRef.current = !document.hidden;
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Polling loop
  useEffect(() => {
    if (!enabled) return;

    // Initial fetch
    void fetchData();

    const id = setInterval(() => {
      if (visibleRef.current && enabled) {
        void fetchData();
      }
    }, backoffRef.current);

    return () => clearInterval(id);
  }, [enabled, fetchData]);

  return { data, loading, error, lastUpdated };
}
