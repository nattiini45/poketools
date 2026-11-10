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

describe('useTeamSave: the league-rules advisory of a successful save', () => {
  const VERDICT = {
    valid: false,
    issues: [],
    team_issues: ['Team size: this league needs 6 to 6 Pokémon, found 1'],
    team_issue_details: [{ issue: 'Team size: this league needs 6 to 6 Pokémon, found 1', code: 'kit_roster_size', params: { min: 6, max: 6, have: 1 } }],
  };
  const respond = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
    );
  const notJson = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      })),
    );

  const routes = [
    { name: 'POST /api/teams', state: () => stateWithTeam(), data: { id: 'team-new' }, url: '/api/teams' },
    { name: 'PATCH /api/teams/[id]', state: () => ({ ...stateWithTeam(), teamId: 'team-1' }), data: { id: 'team-1' }, url: '/api/teams/team-1' },
    { name: 'POST /api/match-prep', state: () => ({ ...stateWithTeam(), mode: 'plan' as const, matchId: 'match-1' }), data: { match_id: 'match-1' }, url: '/api/match-prep' },
  ];

  it.each(routes)('$name: unmet marks the save, shows the verdict and flags the save as warned', async ({ state, data, url }) => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data, team_check: { status: 'unmet', verdict: VERDICT } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const actions: EditorAction[] = [];
    const onSaveSuccess = vi.fn();
    const { save } = useTeamSave(state(), (a) => actions.push(a), onSaveSuccess);

    await save();

    expect(fetchMock).toHaveBeenCalledWith(url, expect.anything());
    expect(actions.filter((a) => a.type !== 'SET_META')).toEqual([
      { type: 'SET_SAVE_STATUS', status: 'saving' },
      { type: 'MARK_SAVED' },
      { type: 'SET_VALIDATION', result: VERDICT },
      { type: 'SET_SAVE_STATUS', status: 'warned' },
    ]);
    expect(onSaveSuccess).toHaveBeenCalledTimes(1);
  });

  it.each(routes)('$name: unavailable flags the save as unchecked and shows no verdict', async ({ state, data }) => {
    respond({ success: true, data, team_check: { status: 'unavailable' } });
    const actions: EditorAction[] = [];
    const { save } = useTeamSave(state(), (a) => actions.push(a));

    await save();

    expect(actions.filter((a) => a.type !== 'SET_META')).toEqual([
      { type: 'SET_SAVE_STATUS', status: 'saving' },
      { type: 'MARK_SAVED' },
      { type: 'SET_SAVE_STATUS', status: 'unchecked' },
    ]);
  });

  it.each(routes)('$name: a success without an advisory is a plain save', async ({ state, data }) => {
    respond({ success: true, data });
    const actions: EditorAction[] = [];
    const { save } = useTeamSave(state(), (a) => actions.push(a));

    await save();

    expect(actions.filter((a) => a.type !== 'SET_META')).toEqual([{ type: 'SET_SAVE_STATUS', status: 'saving' }, { type: 'MARK_SAVED' }]);
  });

  it.each(routes)('$name: a success body that is not JSON is a plain save', async ({ state }) => {
    notJson();
    const actions: EditorAction[] = [];
    const onSaveSuccess = vi.fn();
    const { save } = useTeamSave(state(), (a) => actions.push(a), onSaveSuccess);

    await save();

    expect(actions.filter((a) => a.type !== 'SET_META')).toEqual([{ type: 'SET_SAVE_STATUS', status: 'saving' }, { type: 'MARK_SAVED' }]);
    expect(onSaveSuccess).toHaveBeenCalledTimes(1);
  });

  it('ignores an advisory that is not well formed', async () => {
    respond({ success: true, data: { id: 'team-new' }, team_check: { status: 'unmet', verdict: 'nope' } });
    const actions: EditorAction[] = [];
    const { save } = useTeamSave(stateWithTeam(), (a) => actions.push(a));

    await save();

    expect(actions.at(-1)).toEqual({ type: 'MARK_SAVED' });
  });

  it('a new team keeps its id from the response next to the advisory', async () => {
    respond({ success: true, data: { id: 'team-new' }, team_check: { status: 'unavailable' } });
    const actions: EditorAction[] = [];
    const { save } = useTeamSave(stateWithTeam(), (a) => actions.push(a));

    await save();

    expect(actions).toContainEqual({ type: 'SET_META', patch: { teamId: 'team-new' } });
  });

  it('starts no save while one is in flight (teamSaveMachine)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const actions: EditorAction[] = [];
    const { save } = useTeamSave({ ...stateWithTeam(), saveStatus: 'saving' }, (a) => actions.push(a));

    await save();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
});
