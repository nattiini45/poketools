'use client';

import { useEffect, useState } from 'react';
import type { ThreatEntry } from '@/types/calc';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';

export interface OpponentPokemonSummary {
  species: string;
  games: number;
  bring_rate: number;
  ko_rate: number;
  lead_rate: number;
  win_rate: number;
  sample_moves: string[];
  default_set: ThreatEntry['default_set'] | null;
  types: string[];
}

export interface OpponentSummaryData {
  match_id: string;
  opponent_id: string;
  opponent_name: string;
  pokemon: OpponentPokemonSummary[];
  data_scope: 'tournament' | 'season';
  total_games: number;
}

// Module-level cache per match
const cache = new Map<string, OpponentSummaryData>();

/**
 * Opponent scouting summary for a match (plan mode). Shared by the
 * OpponentPanel and the Calc tab's "vs opponent" source.
 */
export function useOpponentSummary(matchId: string | null) {
  const [summary, setSummary] = useState<OpponentSummaryData | null>(() =>
    matchId ? (cache.get(matchId) ?? null) : null,
  );
  const [loading, setLoading] = useState<boolean>(() => !!matchId && !cache.has(matchId));
  const [apiError, setApiError] = useState<ApiErrorLike | null>(null);
  const [trackedMatchId, setTrackedMatchId] = useState(matchId);

  // Adjust state during render on match change (avoids setState in effect body)
  if (matchId !== trackedMatchId) {
    setTrackedMatchId(matchId);
    setSummary(matchId ? (cache.get(matchId) ?? null) : null);
    setLoading(!!matchId && !cache.has(matchId));
    setApiError(null);
  }

  useEffect(() => {
    if (!matchId || cache.has(matchId)) return;
    const controller = new AbortController();

    fetch(`/api/match-prep/opponent-summary?match_id=${encodeURIComponent(matchId)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          cache.set(matchId, j.data);
          setSummary(j.data);
        } else {
          setApiError(toApiErrorLike(j));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [matchId]);

  /**
   * `apiError` is the error object (or null) to render with
   * `useApiErrorText(errorsTeams, errorsMatches)` (i18n-core §4.3), which falls
   * back to `unknown_error` when the payload carries no code.
   */
  return { summary, loading, apiError };
}
