import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { makeSet } from '@/test/team-fixtures';

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamById: vi.fn(),
  updateTeamPokemon: vi.fn(),
  deleteTeam: vi.fn(),
  getTeamVisibilityFacts: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/team/item-usage-cache', () => ({ expireItemUsageReads: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/team-server', () => ({ evaluateTeam: vi.fn(), currentPhaseRound: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn() }));

import { PATCH } from '@/app/api/teams/[id]/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getTeamById, getTeamVisibilityFacts, updateTeamPokemon } from '@/lib/supabase/queries/teams';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { currentPhaseRound, evaluateTeam } from '@/lib/format-engine/runtime/team-server';
import { expectNoPrivateTeamData, teamRowWithShareSecrets } from '@/lib/team/__tests__/private-team-fields';

const TEAM_ID = 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed';
const routeParams = { params: Promise.resolve({ id: TEAM_ID }) };
const pokemon = [makeSet('Garchomp')];
const request = () => ({ json: () => Promise.resolve({ pokemon, import_source: 'manual' }) }) as unknown as NextRequest;

const owner = { playerId: 'player-1', name: 'Ash', isAdmin: false };
const admin = { playerId: 'admin-1', name: 'Admin', isAdmin: true };
const team = (over: Record<string, unknown> = {}) => ({ id: TEAM_ID, player_id: 'player-1', tournament_id: 'tourney-1', match_id: null, locked: false, pokemon, ...over });
const tournament = (format: string) => ({ id: 'tourney-1', season_id: 'season-1', season_format_type: format });

const REFUSED = {
  applies: true,
  result: {
    valid: false,
    issues: [{ pokemon_index: 0, species: 'Garchomp', issue: 'Terastallization is not allowed in this league', severity: 'error', code: 'kit_tera_banned' }],
    team_issues: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(owner as never);
  vi.mocked(getTeamById).mockResolvedValue(team() as never);
  vi.mocked(getTournamentById).mockResolvedValue(tournament('custom') as never);
  vi.mocked(currentPhaseRound).mockResolvedValue(3);
  vi.mocked(evaluateTeam).mockResolvedValue(REFUSED as never);
  vi.mocked(getMatchById).mockResolvedValue({ id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-2', player_1_id: 'player-1', player_2_id: 'player-2' } as never);
  vi.mocked(getRoundById).mockResolvedValue({ id: 'round-2', round_number: 2 } as never);
  vi.mocked(updateTeamPokemon).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'player-1', tournament_id: 'tourney-1' }));
});

describe('PATCH /api/teams/[id] in a kit league', () => {
  it('writes a roster that breaks the phase rules and answers 200 with team_check.status unmet', async () => {
    const response = await PATCH(request(), routeParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, team_check: { status: 'unmet', verdict: { valid: false } } });
    expect(body.team_check.verdict.issues[0].code).toBe('kit_tera_banned');
    expect(evaluateTeam).toHaveBeenCalledWith({ seasonId: 'season-1', phaseId: 'tourney-1', playerId: 'player-1', roundNumber: 3, pokemon });
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
    expectNoPrivateTeamData(body);
  });

  it('writes the roster and answers team_check.status unavailable when the check itself fails', async () => {
    vi.mocked(evaluateTeam).mockRejectedValue(new Error('runtime read failed'));
    const response = await PATCH(request(), routeParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, team_check: { status: 'unavailable' } });
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
  });

  it('gives an admin who edits a planned team of another player no verdict (it would read the owner private gifts)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(admin as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('team_check');
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
  });

  it('still advises an admin who edits their own planned team', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...admin, playerId: 'player-1' } as never);
    const response = await PATCH(request(), routeParams);

    expect((await response.json()).team_check.status).toBe('unmet');
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'player-1' }));
  });

  it('writes a roster that passes, and no private team data leaves', async () => {
    vi.mocked(evaluateTeam).mockResolvedValue({ applies: true, result: { valid: true, issues: [], team_issues: [] } } as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).not.toHaveProperty('team_check');
    expectNoPrivateTeamData(body);
  });

  it('treats an admin rewrite of a match-linked roster as a correction without an advisory', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(admin as never);
    vi.mocked(getTeamById).mockResolvedValue(team({ match_id: 'match-1' }) as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('team_check');
    expect(evaluateTeam).not.toHaveBeenCalled();
  });

  it('advises the owner about a match-linked roster', async () => {
    vi.mocked(getTeamById).mockResolvedValue(team({ match_id: 'match-1' }) as never);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(new Map([[TEAM_ID, { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }]]) as never);
    const response = await PATCH(request(), routeParams);
    expect(response.status).toBe(200);
    expect((await response.json()).team_check.status).toBe('unmet');
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
  });

  it('judges a match-linked roster by the round of its match, not the latest round of the phase', async () => {
    vi.mocked(getTeamById).mockResolvedValue(team({ match_id: 'match-1' }) as never);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(new Map([[TEAM_ID, { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }]]) as never);
    await PATCH(request(), routeParams);

    expect(getMatchById).toHaveBeenCalledWith('match-1');
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 2 }));
    expect(currentPhaseRound).not.toHaveBeenCalled();
  });

  it('judges a planned team, which has no match, by the current round of the phase', async () => {
    await PATCH(request(), routeParams);

    expect(getMatchById).not.toHaveBeenCalled();
    expect(currentPhaseRound).toHaveBeenCalledWith('tourney-1');
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 3 }));
  });

  it('answers team_check.status unavailable, not the current round, when the linked match belongs to another tournament', async () => {
    vi.mocked(getTeamById).mockResolvedValue(team({ match_id: 'match-1' }) as never);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(new Map([[TEAM_ID, { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }]]) as never);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'match-1', tournament_id: 'tourney-other', round_id: 'round-2', player_1_id: 'player-1', player_2_id: 'player-2' } as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, team_check: { status: 'unavailable' } });
    expect(getRoundById).not.toHaveBeenCalled();
    expect(currentPhaseRound).not.toHaveBeenCalled();
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
  });

  it('answers team_check.status unavailable, not the current round, when the match round row is gone', async () => {
    vi.mocked(getTeamById).mockResolvedValue(team({ match_id: 'match-1' }) as never);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(new Map([[TEAM_ID, { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }]]) as never);
    vi.mocked(getRoundById).mockResolvedValue(null as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, team_check: { status: 'unavailable' } });
    expect(currentPhaseRound).not.toHaveBeenCalled();
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
  });

  it('writes the roster and answers team_check.status unavailable when the match round cannot be read', async () => {
    vi.mocked(getTeamById).mockResolvedValue(team({ match_id: 'match-1' }) as never);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(new Map([[TEAM_ID, { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }]]) as never);
    vi.mocked(getMatchById).mockRejectedValue(new Error('matches read failed'));
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, team_check: { status: 'unavailable' } });
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
  });

  it('does not look at a team without a tournament', async () => {
    vi.mocked(getTeamById).mockResolvedValue(team({ tournament_id: null }) as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(evaluateTeam).not.toHaveBeenCalled();
  });

  it.each(['singles', 'evolution_point_buy'])('leaves a %s league untouched', async (format) => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament(format) as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(evaluateTeam).not.toHaveBeenCalled();
  });
});
