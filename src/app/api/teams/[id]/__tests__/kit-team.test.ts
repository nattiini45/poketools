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

import { PATCH } from '@/app/api/teams/[id]/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getTeamById, getTeamVisibilityFacts, updateTeamPokemon } from '@/lib/supabase/queries/teams';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
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
  vi.mocked(updateTeamPokemon).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'player-1', tournament_id: 'tourney-1' }));
});

describe('PATCH /api/teams/[id] in a kit league', () => {
  it('refuses a roster that breaks the phase rules: 400 team_check_failed, nothing written', async () => {
    const response = await PATCH(request(), routeParams);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: 'team_check_failed', team_check: { valid: false } });
    expect(evaluateTeam).toHaveBeenCalledWith({ seasonId: 'season-1', phaseId: 'tourney-1', playerId: 'player-1', roundNumber: 3, pokemon });
    expect(updateTeamPokemon).not.toHaveBeenCalled();
  });

  it('checks the rules of the team owner when an admin edits it', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(admin as never);
    await PATCH(request(), routeParams);
    expect(evaluateTeam).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'player-1' }));
  });

  it('writes a roster that passes, and no private team data leaves', async () => {
    vi.mocked(evaluateTeam).mockResolvedValue({ applies: true, result: { valid: true, issues: [], team_issues: [] } } as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(updateTeamPokemon).toHaveBeenCalledTimes(1);
    expectNoPrivateTeamData(await response.json());
  });

  it('treats an admin rewrite of a match-linked roster as a correction', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(admin as never);
    vi.mocked(getTeamById).mockResolvedValue(team({ match_id: 'match-1' }) as never);
    const response = await PATCH(request(), routeParams);

    expect(response.status).toBe(200);
    expect(evaluateTeam).not.toHaveBeenCalled();
  });

  it('holds the owner to the rules even for a match-linked roster', async () => {
    vi.mocked(getTeamById).mockResolvedValue(team({ match_id: 'match-1' }) as never);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(new Map([[TEAM_ID, { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }]]) as never);
    expect((await PATCH(request(), routeParams)).status).toBe(400);
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
