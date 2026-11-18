import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getOpponentBattleStatsInTournament } from '@/lib/supabase/queries/games';
import { getOpponentBattleStatsInPhase, getPhaseScoutingMatch } from '@/lib/supabase/queries/phase-opponent-summary';
import { findLegacyPhaseAliasOwner, findNativePhaseAliasOwner, standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import { readPhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { buildThreatEntry } from '@/lib/pkmn/threat-list';
import type { CompetitionOwner } from '@/types/competition-owner';

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/games', () => ({ getOpponentBattleStatsInTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-opponent-summary', () => ({
  getPhaseScoutingMatch: vi.fn(),
  getOpponentBattleStatsInPhase: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findLegacyPhaseAliasOwner: vi.fn(),
  findNativePhaseAliasOwner: vi.fn(),
  standaloneMatchAliasExists: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/pkmn/threat-list', () => ({ buildThreatEntry: vi.fn() }));

const matchId = '00000000-0000-4000-8000-00000000000a';
const owner = { kind: 'phase', phase_id: 'phase-id', season_id: 'league-id' } satisfies CompetitionOwner;
const phaseMatch = {
  phase_id: owner.phase_id, player_1_id: 'opponent', player_2_id: 'viewer',
  player_1_name: 'Rival', player_2_name: 'Scout', ruleset_id: 'phase-pin',
};
const battleRows = [
  { game_id: 'one', pokemon_name: 'Pikachu', was_brought: true, was_lead: true, kos_dealt: 2, match_won: true, moves_used: ['Thunderbolt', 'Protect'] },
  { game_id: 'two', pokemon_name: 'Pikachu', was_brought: true, was_lead: false, kos_dealt: 1, match_won: false, moves_used: ['Protect', 'Surf', 'Encore', 'Volt Switch'] },
  { game_id: 'two', pokemon_name: 'Bulbasaur', was_brought: false, was_lead: false, kos_dealt: 0, match_won: false, moves_used: [] },
];

function request(query = `match_id=${matchId}`) {
  return new NextRequest(`http://localhost/api/match-prep/opponent-summary?${query}`);
}

describe('opponent summary by storage generation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'viewer', isAdmin: false } as never);
    vi.mocked(readPhaseStorageMode).mockResolvedValue('phase');
    vi.mocked(findNativePhaseAliasOwner).mockResolvedValue(owner);
    vi.mocked(getPhaseScoutingMatch).mockResolvedValue(phaseMatch);
    vi.mocked(getRulesetById).mockResolvedValue({ id: 'phase-pin', base_format: 'gen9doublesou' } as never);
    vi.mocked(getOpponentBattleStatsInPhase).mockResolvedValue(battleRows);
    vi.mocked(buildThreatEntry).mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses only the actual phase and selected opponent, preserving rate math and known-move priority', async () => {
    const submittedId = matchId.toUpperCase();
    vi.mocked(buildThreatEntry).mockResolvedValueOnce({
      species: 'Pikachu', types: ['Electric'], usage_pct: 2,
      default_set: { species: 'Pikachu', item: 'Light Ball', level: 100 },
    });
    const response = await GET(request(`match_id=${submittedId}&player_id=opponent&season_id=not-the-owner`));
    expect(response.status).toBe(200);
    expect(findNativePhaseAliasOwner).toHaveBeenCalledExactlyOnceWith({ matchId });
    expect(getPhaseScoutingMatch).toHaveBeenCalledExactlyOnceWith(matchId, owner);
    expect(getOpponentBattleStatsInPhase).toHaveBeenCalledExactlyOnceWith('opponent', owner.phase_id);
    expect(getRulesetById).toHaveBeenCalledExactlyOnceWith('phase-pin');
    expect(buildThreatEntry).toHaveBeenNthCalledWith(1, 'Pikachu', 'gen9doublesou', ['Thunderbolt', 'Protect', 'Surf', 'Encore']);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        match_id: submittedId, opponent_id: 'opponent', opponent_name: 'Rival',
        data_scope: 'phase', total_games: 2,
        pokemon: [
          {
            species: 'Pikachu', games: 2, bring_rate: 100, lead_rate: 50, ko_rate: 150, win_rate: 50,
            sample_moves: ['Thunderbolt', 'Protect', 'Surf', 'Encore'], types: ['Electric'],
            default_set: { species: 'Pikachu', item: 'Light Ball', level: 100 },
          },
          {
            species: 'Bulbasaur', games: 1, bring_rate: 0, lead_rate: 0, ko_rate: 0, win_rate: 0,
            sample_moves: [], types: [], default_set: null,
          },
        ],
      },
    });
    expect(standaloneMatchAliasExists).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(getOpponentBattleStatsInTournament).not.toHaveBeenCalled();
  });

  it('selects the second seat as opponent when the viewer is in the first, including an admin playing in the match', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'opponent', isAdmin: true } as never);
    vi.mocked(getOpponentBattleStatsInPhase).mockResolvedValue([]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(getOpponentBattleStatsInPhase).toHaveBeenCalledExactlyOnceWith('viewer', owner.phase_id);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { opponent_id: 'viewer', opponent_name: 'Scout', data_scope: 'phase', pokemon: [], total_games: 0 },
    });
    expect(buildThreatEntry).not.toHaveBeenCalled();
  });

  it.each([false, true])('refuses a nonparticipant even when isAdmin is %s', async isAdmin => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'spectator', isAdmin } as never);
    const response = await GET(request('match_id=' + matchId + '&player_id=viewer'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: 'Forbidden', code: 'forbidden' });
    expect(getRulesetById).not.toHaveBeenCalled();
    expect(getOpponentBattleStatsInPhase).not.toHaveBeenCalled();
  });

  it('refuses a vanished or mismatched native match instead of using the legacy path', async () => {
    vi.mocked(getPhaseScoutingMatch).mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, code: 'match_not_found' });
    expect(getMatchById).not.toHaveBeenCalled();
    expect(getOpponentBattleStatsInPhase).not.toHaveBeenCalled();
  });

  it.each([null, { id: 'other-pin', base_format: 'gen9ou' }])('refuses an unusable native ruleset pin without guessing the meta: %j', async ruleset => {
    vi.mocked(getRulesetById).mockResolvedValue(ruleset as never);
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, code: 'ruleset_not_found' });
    expect(getOpponentBattleStatsInPhase).not.toHaveBeenCalled();
    expect(buildThreatEntry).not.toHaveBeenCalled();
  });

  it('does not pretend a history read failure was an empty sample', async () => {
    vi.mocked(getOpponentBattleStatsInPhase).mockRejectedValue(new Error('hidden backend detail'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to fetch opponent summary' });
    expect(getOpponentBattleStatsInTournament).not.toHaveBeenCalled();
  });

  it.each(['frozen_legacy', 'frozen_phase'] as const)('returns the existing maintenance error in %s for a phase match', async mode => {
    vi.mocked(readPhaseStorageMode).mockResolvedValue(mode);
    vi.mocked(findLegacyPhaseAliasOwner).mockResolvedValue(mode === 'frozen_legacy'
      ? { tournament_id: 'legacy-phase', season_id: owner.season_id } : null);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'phase_storage_unavailable' });
    expect(getPhaseScoutingMatch).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it('fails closed on a missing native and standalone owner', async () => {
    vi.mocked(findNativePhaseAliasOwner).mockResolvedValue(null);
    vi.mocked(standaloneMatchAliasExists).mockResolvedValue(false);
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'match_not_found' });
    expect(findLegacyPhaseAliasOwner).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it('does not probe either match store for a malformed id in phase mode', async () => {
    const response = await GET(request('match_id=invalid'));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'match_not_found' });
    expect(findNativePhaseAliasOwner).not.toHaveBeenCalled();
    expect(standaloneMatchAliasExists).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it('fails closed on an unrecognized or failed generation read', async () => {
    vi.mocked(readPhaseStorageMode).mockRejectedValue(new Error('Invalid phase storage mode'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(findNativePhaseAliasOwner).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it.each(['default', 'standalone'] as const)('keeps the exact legacy statistic read and protocol for %s', async mode => {
    if (mode === 'default') vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
    vi.mocked(findNativePhaseAliasOwner).mockResolvedValue(null);
    vi.mocked(standaloneMatchAliasExists).mockResolvedValue(true);
    vi.mocked(getMatchById).mockResolvedValue({
      player_1_id: 'opponent', player_2_id: 'viewer', player_1_name: 'Rival', player_2_name: 'Scout',
      tournament_id: 'legacy-tournament',
    } as never);
    vi.mocked(getOpponentBattleStatsInTournament).mockResolvedValue(battleRows.slice(0, 1).map(row => ({
      ...row, id: 'stat-id', player_id: 'opponent', was_koed: false, turns_active: 3, created_at: '2026-11-01',
    })));
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        match_id: matchId, opponent_id: 'opponent', opponent_name: 'Rival', data_scope: 'tournament', total_games: 1,
        pokemon: [{
          species: 'Pikachu', games: 1, bring_rate: 100, lead_rate: 100, ko_rate: 200, win_rate: 100,
          sample_moves: ['Thunderbolt', 'Protect'], types: [], default_set: null,
        }],
      },
    });
    expect(getMatchById).toHaveBeenCalledExactlyOnceWith(matchId);
    expect(getOpponentBattleStatsInTournament).toHaveBeenCalledExactlyOnceWith('opponent', 'legacy-tournament');
    expect(getTournamentById).toHaveBeenCalledExactlyOnceWith('legacy-tournament');
    expect(buildThreatEntry).toHaveBeenCalledExactlyOnceWith('Pikachu', 'gen9ou', ['Thunderbolt', 'Protect']);
    expect(getPhaseScoutingMatch).not.toHaveBeenCalled();
    expect(getOpponentBattleStatsInPhase).not.toHaveBeenCalled();
    if (mode === 'default') {
      expect(readPhaseStorageMode).not.toHaveBeenCalled();
      expect(findNativePhaseAliasOwner).not.toHaveBeenCalled();
      expect(standaloneMatchAliasExists).not.toHaveBeenCalled();
    } else {
      expect(standaloneMatchAliasExists).toHaveBeenCalledExactlyOnceWith(matchId);
    }
  });
});
