import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, rpc, rows } = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(),
  rows: {} as Record<string, unknown[]>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from, rpc,
  },
}));

import {
  getPhaseRegisteredSpeciesByMatches, loadPhaseEpbSeasonMatches, syncMixedEpbGameKillCredit,
} from '../phase-epb';
import { creditPhaseGameKills, uncreditPhaseGameKills } from '../evolutions';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(rows)) delete rows[key];
  from.mockImplementation((table: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn((start: number, end: number) => Promise.resolve({
        data: (rows[table] ?? []).slice(start, end + 1), error: null,
      })),
    };
    return builder;
  });
});

describe('phase EPB persistence', () => {
  it('reads registration only from native prep rows and rejects malformed teams', async () => {
    rows.phase_match_prep_teams = [{
      id: 'prep', match_id: 'match', player_id: 'player', pokemon: [{ species: 'Dreepy' }],
    }];
    expect((await getPhaseRegisteredSpeciesByMatches(['match'])).get('match')?.get('player'))
      .toEqual(['Dreepy']);
    expect([...new Set(from.mock.calls.map(([table]) => table))]).toEqual(['phase_match_prep_teams']);
    rows.phase_match_prep_teams = [{
      id: 'prep', match_id: 'match', player_id: 'player', pokemon: [{ nickname: 'not a species' }],
    }];
    await expect(getPhaseRegisteredSpeciesByMatches(['match'])).rejects.toThrow();
  });

  it('loads phase rounds, games, stats and registration without legacy fallback', async () => {
    rows.league_phases = [{ id: 'phase' }];
    const match = {
      id: 'match', phase_id: 'phase', rounds: { round_number: 2 },
      player_1_id: 'p1', player_2_id: 'p2', status: 'completed', winner_id: 'p1',
      bracket_side: null,
    };
    rows.phase_matches = [match];
    rows.phase_games = [{ id: 'game', match_id: 'match' }];
    const stat = { id: 'stat', game_id: 'game', player_id: 'p1', kos_dealt: 2, moves_used: ['Tackle'] };
    rows.phase_battle_stats = [stat];
    const loaded = await loadPhaseEpbSeasonMatches('season');
    expect(loaded).toEqual([expect.objectContaining({
      source: 'phase', matchday: 2, gameIds: ['game'],
      match: expect.objectContaining({ phase_id: 'phase' }),
      battleStats: rows.phase_battle_stats,
    })]);
    expect([...new Set(from.mock.calls.map(([table]) => table))]).toEqual([
      'league_phases', 'phase_matches', 'phase_games', 'phase_battle_stats', 'phase_match_prep_teams',
    ]);
    expect(loaded[0].battleStats[0].moves_used).toEqual(['Tackle']);
    rows.phase_matches = [{ ...match, bracket_side: 'invalid-side' }];
    await expect(loadPhaseEpbSeasonMatches('season')).rejects.toThrow();
    rows.phase_matches = [match];
    rows.phase_battle_stats = [{ ...stat, moves_used: ['Tackle', 7] }];
    await expect(loadPhaseEpbSeasonMatches('season')).rejects.toThrow();
  });

  it('uses real native credit and marker-fenced debit RPCs', async () => {
    rpc.mockResolvedValueOnce({ data: 'applied', error: null })
      .mockResolvedValueOnce({ data: 'marker_changed', error: null });
    expect(await creditPhaseGameKills('game', [{ tracker_id: 'tracker', amount: 2 }])).toBe('applied');
    expect(await uncreditPhaseGameKills('game', 'marker', [])).toBe('marker_changed');
    expect(rpc).toHaveBeenNthCalledWith(1, 'phase_epb_credit_game_kills', {
      p_game_id: 'game', p_credits: [{ tracker_id: 'tracker', amount: 2 }],
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'phase_epb_uncredit_game_kills', {
      p_game_id: 'game', p_expected_applied_at: 'marker', p_debits: [],
    });
  });

  it('submits both ledgers in one fenced call and preserves stale/error outcomes', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'stale', reason: 'match_changed' }, error: null });
    expect(await syncMixedEpbGameKillCredit('season', 8, ['legacy'], {}, ['native'], {}))
      .toEqual({ status: 'stale', reason: 'match_changed' });
    expect(rpc).toHaveBeenCalledWith('epb_sync_mixed_game_kill_credit', {
      p_season_id: 'season', p_expected_epoch: 8,
      p_legacy_match_ids: ['legacy'], p_legacy_game_credits: {},
      p_phase_match_ids: ['native'], p_phase_game_credits: {},
    });
    const error = new Error('sync unavailable');
    rpc.mockResolvedValueOnce({ data: null, error });
    await expect(syncMixedEpbGameKillCredit('season', 8, [], {}, [], {})).rejects.toBe(error);
  });
});
