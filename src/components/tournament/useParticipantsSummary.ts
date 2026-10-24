'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '@/types/api';
import {
  subscribeParticipantsChanged,
  summarizeParticipants,
  type ParticipantsSummary,
} from './participants-events';

/**
 * The tournament's roster reduced to what the start-up checklist needs
 * (`GET /api/tournaments/[id]/participants`; `seed` is on both the public and
 * the admin shape). `null` when the request fails, so a failed load is never
 * mistaken for an empty roster.
 */
export async function fetchParticipantsSummary(
  tournamentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParticipantsSummary | null> {
  try {
    const res = await fetchImpl(`/api/tournaments/${tournamentId}/participants`);
    const result = (await res.json()) as ApiResult<{ id: string; seed: number | null }[]>;
    if (!result.success) return null;
    return summarizeParticipants(result.data.map((row) => ({ id: row.id, seed: row.seed ?? null })));
  } catch {
    return null;
  }
}

export type ParticipantsSummaryStatus = 'loading' | 'ready' | 'error';

export interface ParticipantsSummaryState {
  /** `null` until a load has succeeded (and after a first load failed). */
  summary: ParticipantsSummary | null;
  status: ParticipantsSummaryStatus;
  reload: () => void;
}

/**
 * Live participant summary for a tournament. Loaded on mount (unless `initial`
 * is given), replaced by the roster the participant manager announces after
 * every change, and re-read when the tab becomes visible again, so a count
 * changed in another tab cannot block Generate for long. An error state is
 * informational: the generate routes stay the authority.
 */
export function useParticipantsSummary(
  tournamentId: string,
  initial?: ParticipantsSummary | null,
): ParticipantsSummaryState {
  const [summary, setSummary] = useState<ParticipantsSummary | null>(initial ?? null);
  const [status, setStatus] = useState<ParticipantsSummaryStatus>(initial ? 'ready' : 'loading');
  // Bumped by every request and every announced summary: a response that is no longer the newest is dropped.
  const generation = useRef(0);
  const hasSummary = useRef(Boolean(initial));

  const load = useCallback(
    async (showLoading: boolean) => {
      const mine = ++generation.current;
      if (showLoading) setStatus('loading');
      const next = await fetchParticipantsSummary(tournamentId);
      if (mine !== generation.current) return;
      if (next) {
        hasSummary.current = true;
        setSummary(next);
        setStatus('ready');
      } else if (!hasSummary.current) {
        setStatus('error');
      }
      // A failed re-read keeps the summary we already have.
    },
    [tournamentId],
  );

  useEffect(() => {
    if (!initial) void load(false);
    // `initial` seeds the first render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(
    () =>
      subscribeParticipantsChanged(tournamentId, (next) => {
        generation.current++;
        hasSummary.current = true;
        setSummary(next);
        setStatus('ready');
      }),
    [tournamentId],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { summary, status, reload };
}
