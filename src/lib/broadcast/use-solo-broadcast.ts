'use client';

import { useEffect, useState } from 'react';
import type { PublicSoloBroadcastState } from '@/types/broadcast';

/**
 * useSoloBroadcastPoll — shared hook for solo OBS overlay components.
 * Polls `/api/broadcast/solo/[sessionId]` at the given interval and returns
 * the latest public broadcast state.
 */
export function useSoloBroadcastPoll(
  sessionId: string,
  pollInterval: number = 5000,
): PublicSoloBroadcastState | null {
  const [state, setState] = useState<PublicSoloBroadcastState | null>(null);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/broadcast/solo/${sessionId}`);
        const json = await res.json();
        if (json.success && active) setState(json.data);
      } catch {
        // Polling failure — continue silently
      }
    };

    poll();
    const interval = setInterval(poll, pollInterval);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [sessionId, pollInterval]);

  return state;
}
