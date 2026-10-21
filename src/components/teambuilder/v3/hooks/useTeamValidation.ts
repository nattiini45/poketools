'use client';

import { useEffect, useRef } from 'react';
import type { EditorState, EditorAction } from '../editor/state';
import type { PokemonSet, TeamValidationResult } from '@/types/team';

const DEBOUNCE_MS = 600;

/**
 * Auto-validates the team against the ruleset whenever the team changes.
 * Debounced to avoid hammering /api/validate-team on every keystroke.
 * Skips when no rulesetId or team is empty.
 */
export function useTeamValidation(
  state: EditorState,
  dispatch: React.Dispatch<EditorAction>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref to rulesetId/seasonId/tournamentId so the effect only re-runs on team/dirty changes
  const rulesetIdRef = useRef(state.rulesetId);
  const seasonIdRef = useRef(state.seasonId);
  const tournamentIdRef = useRef(state.tournamentId);
  useEffect(() => { rulesetIdRef.current = state.rulesetId; }, [state.rulesetId]);
  useEffect(() => { seasonIdRef.current = state.seasonId; }, [state.seasonId]);
  useEffect(() => { tournamentIdRef.current = state.tournamentId; }, [state.tournamentId]);

  useEffect(() => {
    if (!state.dirty || !state.rulesetId) return;

    const pokemon = state.team.filter((s): s is PokemonSet => s !== null);
    if (pokemon.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        // tournament_id is sent so the API can resolve the EFFECTIVE ruleset
        // (custom-league-over-base-tier) AND look up the player's assigned
        // core triple for `type_quotas.source === 'player_core'` validation.
        const res = await fetch('/api/validate-team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pokemon,
            ruleset_id: rulesetIdRef.current,
            ...(seasonIdRef.current ? { season_id: seasonIdRef.current } : {}),
            ...(tournamentIdRef.current ? { tournament_id: tournamentIdRef.current } : {}),
          }),
          signal: abortRef.current.signal,
        });
        // A failed check (e.g. 404 `ruleset_not_found`) keeps the last result and
        // renders nothing: the API's English error text never reaches the UI.
        if (!res.ok) return;
        const json = (await res.json()) as { success: boolean; data?: TeamValidationResult };
        if (json.success && json.data) {
          dispatch({ type: 'SET_VALIDATION', result: json.data });
        }
      } catch (err) {
        // AbortError is expected on rapid changes — ignore
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Re-run when team content or dirty flag changes; rulesetId/seasonId/tournamentId via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.team, state.dirty, dispatch]);
}
