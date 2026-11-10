'use client';

import { useCallback } from 'react';
import type { EditorState, EditorAction } from '../editor/state';
import type { PokemonSet, TeamValidationResult } from '@/types/team';
import type { TeamCheckAdvisory } from '@/types/api';
import { teamSaveMachine } from '@/lib/team/editor-save-state';

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

/** The JSON body of a response, or null when it is not JSON. */
async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A verdict as `TeamValidationResult`: enough shape to render, nothing is trusted beyond it. */
function isVerdict(value: unknown): value is TeamValidationResult {
  return isRecord(value) && typeof value.valid === 'boolean' && Array.isArray(value.issues) && Array.isArray(value.team_issues);
}

/**
 * The league-rules advisory a team write carries (`team_check` of the success body), or null when the body has none or
 * not a well-formed one: a save never fails because of its advisory.
 */
function advisoryOf(body: unknown): TeamCheckAdvisory | null {
  if (!isRecord(body) || !isRecord(body.team_check)) return null;
  const advisory = body.team_check;
  if (advisory.status === 'unavailable') return { status: 'unavailable' };
  if (advisory.status === 'unmet' && isVerdict(advisory.verdict)) return { status: 'unmet', verdict: advisory.verdict };
  return null;
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
    // The team is saved. When the league's rules are not met (or could not be checked) the editor says so: the verdict
    // goes to the validation panel, rendered by code like the live check.
    const saved = (advisory: TeamCheckAdvisory | null) => {
      dispatch({ type: 'MARK_SAVED' });
      if (advisory?.status === 'unmet') {
        dispatch({ type: 'SET_VALIDATION', result: advisory.verdict });
        dispatch({ type: 'SET_SAVE_STATUS', status: 'warned' });
      } else if (advisory?.status === 'unavailable') {
        dispatch({ type: 'SET_SAVE_STATUS', status: 'unchecked' });
      }
      onSaveSuccess?.();
    };
    const pokemon = state.team.filter((s): s is PokemonSet => s !== null);
    // An empty team has nothing to save, and a save never overlaps another one.
    if (pokemon.length === 0 || !teamSaveMachine.can(state.saveStatus, 'saving', 'player')) return;

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
        return saved(advisoryOf(await readBody(res)));
      }

      // teambuilder / library mode
      const trimmedName = state.teamName.trim();
      let advisory: TeamCheckAdvisory | null;
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
        advisory = advisoryOf(await readBody(res));
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
        const json = await readBody(res);
        if (isRecord(json) && json.success === true && isRecord(json.data) && typeof json.data.id === 'string') {
          dispatch({ type: 'SET_META', patch: { teamId: json.data.id } });
        }
        advisory = advisoryOf(json);
      }

      saved(advisory);
    } catch {
      fail();
    }
  }, [state, dispatch, onSaveSuccess]);

  return { save };
}
