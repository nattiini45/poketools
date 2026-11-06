import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { makeSet } from '@/test/team-fixtures';

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForTournament: vi.fn(),
  createTeam: vi.fn(),
  listTeamsByTournament: vi.fn(),
  listTeamsByPlayerWithContext: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  isPlayerTournamentParticipant: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/team-server', () => ({ evaluateTeam: vi.fn(), currentPhaseRound: vi.fn() }));

import { POST } from '@/app/api/teams/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { createTeam, getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { getTournamentById, isPlayerTournamentParticipant } from '@/lib/supabase/queries/tournaments';
import { currentPhaseRound, evaluateTeam } from '@/lib/format-engine/runtime/team-server';
import { expectNoPrivateTeamData, teamRowWithShareSecrets } from '@/lib/team/__tests__/private-team-fields';

const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000001';
const SEASON_ID = '00000000-0000-4000-8000-000000000002';
const PLAYER_ID = '00000000-0000-4000-8000-000000000011';
const pokemon = [makeSet('Garchomp')];

const request = () => ({ json: vi.fn().mockResolvedValue({ tournament_id: TOURNAMENT_ID, pokemon, import_source: 'manual' }) }) as unknown as NextRequest;
const tournament = (format: string) => ({ id: TOURNAMENT_ID, season_id: SEASON_ID, season_format_type: format, status: 'active' });

const REFUSED = {
  applies: true,
  result: {
    valid: false,
    issues: [],
    team_issues: ['Team size: this league needs 6 to 6 Pokémon, found 1'],
    team_issue_details: [{ issue: 'Team size: this league needs 6 to 6 Pokémon, found 1', code: 'kit_roster_size', params: { min: 6, max: 6, have: 1 } }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: PLAYER_ID, name: 'Ash', isAdmin: false } as never);
  vi.mocked(isPlayerTournamentParticipant).mockResolvedValue(true);
  vi.mocked(getPlayerTeamForTournament).mockResolvedValue(null as never);
  vi.mocked(currentPhaseRound).mockResolvedValue(2);
  vi.mocked(createTeam).mockResolvedValue(teamRowWithShareSecrets({ player_id: PLAYER_ID, tournament_id: TOURNAMENT_ID, pokemon }));
  vi.mocked(getTournamentById).mockResolvedValue(tournament('custom') as never);
  vi.mocked(evaluateTeam).mockResolvedValue(REFUSED as never);
});

describe('POST /api/teams in a kit league', () => {
  it('stores a team that breaks the phase rules and answers 201 with the verdict as team_check.status unmet', async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ success: true, team_check: { status: 'unmet', verdict: { valid: false } } });
    expect(body.team_check.verdict.team_issue_details[0].code).toBe('kit_roster_size');
    expect(evaluateTeam).toHaveBeenCalledWith({
      seasonId: SEASON_ID,
      phaseId: TOURNAMENT_ID,
      playerId: PLAYER_ID,
      roundNumber: 2,
      pokemon,
    });
    expect(createTeam).toHaveBeenCalledTimes(1);
    expectNoPrivateTeamData(body);
  });

  it('stores a team that passes, and no private team data leaves', async () => {
    vi.mocked(evaluateTeam).mockResolvedValue({ applies: true, result: { valid: true, issues: [], team_issues: [] } } as never);
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(createTeam).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).not.toHaveProperty('team_check');
    expectNoPrivateTeamData(body);
  });

  it('stores a team when the phase has no kit rules, with no team_check', async () => {
    vi.mocked(evaluateTeam).mockResolvedValue({ applies: false, result: { valid: true, issues: [], team_issues: [] } } as never);
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).not.toHaveProperty('team_check');
  });

  it.each(['singles', 'evolution_point_buy', 'round_robin'])('leaves a %s league untouched', async (format) => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament(format) as never);
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).not.toHaveProperty('team_check');
    expect(evaluateTeam).not.toHaveBeenCalled();
    expect(currentPhaseRound).not.toHaveBeenCalled();
  });

  it('stores the team and answers team_check.status unavailable when the check itself fails', async () => {
    vi.mocked(evaluateTeam).mockRejectedValue(new Error('runtime read failed'));
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ success: true, team_check: { status: 'unavailable' } });
    expect(createTeam).toHaveBeenCalledTimes(1);
    expectNoPrivateTeamData(body);
  });
});
