/**
 * useTeamSave: a failed save (e.g. 404 `tournament_not_found`) only flips the
 * generic `saveStatus: 'error'`; the API's English text is never carried into
 * state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Runs the hook outside React: useCallback is the identity.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useCallback: <F,>(fn: F) => fn };
});

import { useTeamSave } from '../useTeamSave';
import { createInitialState, type EditorAction, type EditorState } from '../../editor/state';
import type { PokemonSet } from '@/types/team';

const SET: PokemonSet = {
  name: '',
  species: 'Garchomp',
  gender: '',
  item: '',
  ability: '',
  evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Jolly',
  level: 100,
  moves: ['Earthquake'],
};

function stateWithTeam(): EditorState {
  const base = createInitialState();
  const team = [...base.team];
  team[0] = SET;
  return { ...base, team, tournamentId: 't-missing' };
}

afterEach(() => vi.unstubAllGlobals());

describe('useTeamSave', () => {
  it('marks the save as failed without storing the API error text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ success: false, error: 'Tournament not found', code: 'tournament_not_found' }),
      })),
    );
    const actions: EditorAction[] = [];
    const onSaveSuccess = vi.fn();
    const { save } = useTeamSave(stateWithTeam(), (a) => actions.push(a), onSaveSuccess);

    await save();

    expect(actions).toEqual([
      { type: 'SET_SAVE_STATUS', status: 'saving' },
      { type: 'SET_SAVE_STATUS', status: 'error' },
    ]);
    expect(JSON.stringify(actions)).not.toContain('Tournament not found');
    expect(onSaveSuccess).not.toHaveBeenCalled();
  });

  it('marks a network failure as failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const actions: EditorAction[] = [];
    const { save } = useTeamSave(stateWithTeam(), (a) => actions.push(a));

    await save();

    expect(actions.at(-1)).toEqual({ type: 'SET_SAVE_STATUS', status: 'error' });
  });

  it('the library save of a team of a completed match (409 team_match_completed) locks the editor and fails the save', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        error: 'This team belongs to a completed match and can no longer be changed',
        code: 'team_match_completed',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const actions: EditorAction[] = [];
    const onSaveSuccess = vi.fn();
    const { save } = useTeamSave({ ...stateWithTeam(), teamId: 'team-1' }, (a) => actions.push(a), onSaveSuccess);

    await save();

    expect(fetchMock).toHaveBeenCalledWith('/api/teams/team-1', expect.objectContaining({ method: 'PATCH' }));
    expect(actions).toEqual([
      { type: 'SET_SAVE_STATUS', status: 'saving' },
      { type: 'SET_META', patch: { locked: true } },
      { type: 'SET_SAVE_STATUS', status: 'error' },
    ]);
    expect(JSON.stringify(actions)).not.toContain('completed match');
    expect(onSaveSuccess).not.toHaveBeenCalled();
  });

  it('another 409 (team_locked) only fails the save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ success: false, code: 'team_locked' }) })),
    );
    const actions: EditorAction[] = [];
    const { save } = useTeamSave({ ...stateWithTeam(), teamId: 'team-1' }, (a) => actions.push(a));

    await save();

    expect(actions).toEqual([
      { type: 'SET_SAVE_STATUS', status: 'saving' },
      { type: 'SET_SAVE_STATUS', status: 'error' },
    ]);
  });

  it('plan mode: a completed match (409 match_prep_match_completed) locks the editor too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ success: false, code: 'match_prep_match_completed' }),
      })),
    );
    const actions: EditorAction[] = [];
    const { save } = useTeamSave({ ...stateWithTeam(), mode: 'plan', matchId: 'match-1' }, (a) => actions.push(a));

    await save();

    expect(actions).toEqual([
      { type: 'SET_SAVE_STATUS', status: 'saving' },
      { type: 'SET_META', patch: { locked: true } },
      { type: 'SET_SAVE_STATUS', status: 'error' },
    ]);
  });
});
