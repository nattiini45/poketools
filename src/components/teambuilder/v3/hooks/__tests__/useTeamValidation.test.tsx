/** @vitest-environment jsdom */
/**
 * useTeamValidation: the request names the match a team is built for (when the tournament is known too), so the API
 * checks the team by the rules of that match's round.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTeamValidation } from '../useTeamValidation';
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

const RULESET = '00000000-0000-4000-8000-000000000001';
const TOURNAMENT = '00000000-0000-4000-8000-000000000003';
const MATCH = '00000000-0000-4000-8000-000000000004';

function stateWith(over: Partial<EditorState>): EditorState {
  const base = createInitialState();
  const team = [...base.team];
  team[0] = SET;
  return { ...base, team, dirty: true, rulesetId: RULESET, ...over };
}

async function sentBody(state: EditorState): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { valid: true, issues: [], team_issues: [] } }) }));
  vi.stubGlobal('fetch', fetchMock);
  const dispatch = vi.fn<(action: EditorAction) => void>();
  renderHook(() => useTeamValidation(state, dispatch));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/validate-team');
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('useTeamValidation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends the match of the team together with its tournament', async () => {
    const body = await sentBody(stateWith({ tournamentId: TOURNAMENT, matchId: MATCH }));
    expect(body).toMatchObject({ ruleset_id: RULESET, tournament_id: TOURNAMENT, match_id: MATCH });
  });

  it('checks a match-prep (plan mode) team by the season, tournament and match it is built for', async () => {
    const SEASON = '00000000-0000-4000-8000-000000000002';
    const body = await sentBody(
      stateWith({ mode: 'plan', seasonId: SEASON, tournamentId: TOURNAMENT, matchId: MATCH }),
    );
    expect(body).toMatchObject({
      ruleset_id: RULESET,
      season_id: SEASON,
      tournament_id: TOURNAMENT,
      match_id: MATCH,
    });
  });

  it('sends no match for a team that is not built for one', async () => {
    const body = await sentBody(stateWith({ tournamentId: TOURNAMENT, matchId: null }));
    expect(body).not.toHaveProperty('match_id');
  });

  it('never sends a match without its tournament (the API refuses that)', async () => {
    const body = await sentBody(stateWith({ tournamentId: null, matchId: MATCH }));
    expect(body).not.toHaveProperty('match_id');
    expect(body).not.toHaveProperty('tournament_id');
  });
});
