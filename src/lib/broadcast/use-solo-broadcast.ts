'use client';

import { useState } from 'react';
import { usePollLoop } from './poll-loop';
import { pollResultFromResponse, type PollTickResult } from './poll-schedule';
import type { PublicSoloBroadcastState } from '@/types/broadcast';

/**
 * useSoloBroadcastPoll — shared hook for solo OBS overlay components.
 * Polls `/api/broadcast/solo/[sessionId]` at the given interval and returns
 * the latest public broadcast state. A failed or rate-limited poll keeps the
 * last state and waits longer before the next one (`usePollLoop`).
 */
export function useSoloBroadcastPoll(
  sessionId: string,
  pollInterval: number = 5000,
): PublicSoloBroadcastState | null {
  const [state, setState] = useState<PublicSoloBroadcastState | null>(null);

  usePollLoop(sessionId, pollInterval, async (signal): Promise<PollTickResult> => {
    const res = await fetch(`/api/broadcast/solo/${sessionId}`, { signal });
    if (!res.ok) return pollResultFromResponse(res);
    const json = await res.json();
    if (signal.aborted) return { ok: true };
    if (!json.success) return { ok: false };
    setState(json.data);
    return { ok: true };
  });

  return state;
}
