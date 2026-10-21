'use client';

import { useCallback } from 'react';
import type { EditorState, EditorAction } from '../editor/state';
import type { PokemonSet } from '@/types/team';

/**
 * The `code` of a failed response body, if it has one (never its English text).
 * A body that is not JSON has none.
 */
async function failureCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Mode-aware save logic for TeamsEditor.
 * - teambuilder: POST /api/teams (new) or PATCH /api/teams/[id] (existing)
 * - plan: POST /api/match-prep
 */
export function useTeamSave(
  state: EditorState,
  dispatch: React.Dispatch<EditorAction>,
  onSaveSuccess?: () => void,
) {
  const save = useCallback(async () => {
    // A failed save shows the generic `saveStatus: 'error'` label; the API's
    // error text (English, e.g. `tournament_not_found`) is never rendered here.
    const fail = () => dispatch({ type: 'SET_SAVE_STATUS', status: 'error' });
    const pokemon = state.team.filter((s): s is PokemonSet => s !== null);
    if (pokemon.length === 0) return;

    dispatch({ type: 'SET_SAVE_STATUS', status: 'saving' });

    try {
      if (state.mode === 'plan' && state.matchId) {
        const res = await fetch('/api/match-prep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            match_id: state.matchId,
            pokemon,
            import_source: state.importSource ?? 'manual',
          }),
        });
        if (!res.ok) {
          // The match is completed: its registered team is final (409 match_prep_match_completed).
          if (res.status === 409 && (await failureCode(res)) === 'match_prep_match_completed') {
            dispatch({ type: 'SET_META', patch: { locked: true } });
          }
          return fail();
        }
        dispatch({ type: 'MARK_SAVED' });
        onSaveSuccess?.();
        return;
      }

      // teambuilder / library mode
      const trimmedName = state.teamName.trim();
      if (state.teamId) {
        const res = await fetch(`/api/teams/${state.teamId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pokemon,
            import_source: state.importSource ?? 'manual',
            ...(trimmedName ? { name: trimmedName } : {}),
          }),
        });
        if (!res.ok) {
          // A team of a completed match is final (409 team_match_completed, lead
          // ruling round 5): lock the editor so no further edit is offered.
          if (res.status === 409 && (await failureCode(res)) === 'team_match_completed') {
            dispatch({ type: 'SET_META', patch: { locked: true } });
          }
          return fail();
        }
      } else {
        const res = await fetch('/api/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournament_id: state.tournamentId ?? null,
            season_id: state.seasonId ?? null,
            pokemon,
            import_source: state.importSource ?? 'manual',
            ...(trimmedName ? { name: trimmedName } : {}),
          }),
        });
        if (!res.ok) return fail();
        const json = (await res.json()) as { success: boolean; data?: { id: string } };
        if (json.success && json.data?.id) {
          dispatch({ type: 'SET_META', patch: { teamId: json.data.id } });
        }
      }

      dispatch({ type: 'MARK_SAVED' });
      onSaveSuccess?.();
    } catch {
      fail();
    }
  }, [state, dispatch, onSaveSuccess]);

  return { save };
}
