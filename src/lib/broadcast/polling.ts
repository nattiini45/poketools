'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePollLoop } from './poll-loop';
import { pollResultFromResponse, type PollTickResult } from './poll-schedule';

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
 * - Error resilience: maintains last good data; failures back off exponentially
 *   (max 30 s) and a 429's `Retry-After` is honoured (`usePollLoop`)
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
  const visibleRef = useRef(true);

  const fetchData = useCallback(async (): Promise<PollTickResult> => {
    if (!visibleRef.current) return { ok: true };
    try {
      const res = await fetch(url);
      if (!res.ok) {
        setError(new Error(`Poll failed: ${res.status} ${res.statusText}`));
        setLoading(false);
        return pollResultFromResponse(res);
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
      return { ok: true };
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
      return { ok: false };
    }
  }, [url, transform, onUpdate]);

  // Visibility API: track tab visibility
  useEffect(() => {
    function handleVisibility() {
      visibleRef.current = !document.hidden;
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  usePollLoop(url, intervalMs, fetchData, enabled);

  return { data, loading, error, lastUpdated };
}
