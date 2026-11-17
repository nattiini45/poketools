import { beforeEach, describe, expect, it, vi } from 'vitest';
import { phaseTeam } from '@/lib/team/__tests__/phase-team-fixture';
import { makeSet } from '@/test/team-fixtures';

const q = vi.hoisted(() => ({
  getPhaseMatchById: vi.fn(), getPhaseById: vi.fn(), getPhaseRoundById: vi.fn(),
  getPlayerPhaseTeamForMatch: vi.fn(), getPhaseBattleStatsByMatch: vi.fn(), getRulesetById: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => q);
vi.mock('@/lib/supabase/queries/league-phases', () => q);
vi.mock('@/lib/supabase/queries/phase-rounds', () => q);
vi.mock('@/lib/supabase/queries/phase-teams', () => q);
vi.mock('@/lib/supabase/queries/phase-games', () => q);
vi.mock('@/lib/supabase/queries/rulesets', () => q);

import { loadPhaseCastMatch } from '../phase-populate';

const match = {
  id: 'match', phase_id: 'phase', round_id: 'round', status: 'scheduled',
  player_1_id: 'p1', player_1_name: 'Fixture one', player_1_avatar_url: null,
  player_2_id: 'p2', player_2_name: 'Fixture two', player_2_avatar_url: null, games: [], notes: 'private',
};
const phase = { id: 'phase', season_id: 'league', ruleset_id: 'version', team_visibility: 'hidden_until_match' };
const team1 = phaseTeam({ player_id: 'p1', phase_id: 'phase', match_id: 'match', pokemon: [makeSet()] });
const team2 = phaseTeam({ player_id: 'p2', phase_id: 'phase', match_id: 'match', pokemon: [makeSet('Dragonite')] });

beforeEach(() => {
  vi.resetAllMocks();
  q.getPhaseMatchById.mockResolvedValue(match);
  q.getPhaseById.mockResolvedValue(phase);
  q.getPhaseRoundById.mockResolvedValue({ id: 'round', phase_id: 'phase', name: 'Round 1', best_of: 3 });
  q.getPlayerPhaseTeamForMatch.mockImplementation(async (playerId: string) => playerId === 'p1' ? team1 : team2);
  q.getPhaseBattleStatsByMatch.mockResolvedValue({});
  q.getRulesetById.mockResolvedValue({ base_format: 'gen9ou' });
});

describe('native phase cast population', () => {
  it('keeps creator ownership distinct from roster authority', async () => {
    const result = await loadPhaseCastMatch('phase', 'match', { playerId: 'creator', isAdmin: false });
    expect(result.player1_team).toEqual([]);
    expect(result.player2_team).toEqual([]);
    expect(result.match).toEqual({ id: 'match', phase_id: 'phase', season_id: 'league', round_name: 'Round 1', best_of: 3, status: 'scheduled' });
    expect(result).not.toHaveProperty('notes');
    expect(result.match).not.toHaveProperty('tournament_id');
    expect(q.getRulesetById).toHaveBeenCalledWith('version');
  });

  it('gives a participant only their own preparation and a live site admin both', async () => {
    const participant = await loadPhaseCastMatch('phase', 'match', { playerId: 'p1', isAdmin: false });
    expect(participant.player1_team).toEqual(team1.pokemon);
    expect(participant.player2_team).toEqual([]);
    const admin = await loadPhaseCastMatch('phase', 'match', { playerId: 'admin', isAdmin: true });
    expect(admin.player1_team).toEqual(team1.pokemon);
    expect(admin.player2_team).toEqual(team2.pokemon);
  });

  it('shows completed and explicitly always-public phase rosters without granting an admin role', async () => {
    q.getPhaseMatchById.mockResolvedValue({ ...match, status: 'completed' });
    expect((await loadPhaseCastMatch('phase', 'match', { playerId: 'creator', isAdmin: false })).player2_team).toEqual(team2.pokemon);
    q.getPhaseMatchById.mockResolvedValue(match);
    q.getPhaseById.mockResolvedValue({ ...phase, team_visibility: 'always_public' });
    expect((await loadPhaseCastMatch('phase', 'match', { playerId: 'creator', isAdmin: false })).player1_team).toEqual(team1.pokemon);
  });

  it('refuses cross-phase match IDs before loading any team sets', async () => {
    await expect(loadPhaseCastMatch('other-phase', 'match', { playerId: 'creator', isAdmin: false }))
      .rejects.toMatchObject({ code: 'match_not_found', statusCode: 404 });
    expect(q.getPlayerPhaseTeamForMatch).not.toHaveBeenCalled();
  });

  it('fails rather than replacing a storage outage with empty rosters', async () => {
    q.getPlayerPhaseTeamForMatch.mockRejectedValue(new Error('sets unavailable'));
    await expect(loadPhaseCastMatch('phase', 'match', { playerId: 'creator', isAdmin: false })).rejects.toThrow('sets unavailable');
  });

  it('keeps the planned fallback when game rows contain no actual roster for that player', async () => {
    q.getPhaseBattleStatsByMatch.mockResolvedValue({ 1: [] });
    const result = await loadPhaseCastMatch('phase', 'match', { playerId: 'p1', isAdmin: false });
    expect(result.player1_team).toEqual(team1.pokemon);
    expect(result.player2_team).toEqual([]);
  });
});
