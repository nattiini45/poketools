import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseReportStandingsInput } from '@/lib/ai/kale/phase-fact-pack';
import type { SeasonStandingsContext } from '@/lib/tournament/season-standings';
import type { KitStandingsData } from '@/lib/format-engine/context';
import { effectiveMatchPoints } from '@/lib/tournament/standings-rules';
import { makeRuleset } from '@/test/ruleset-fixtures';

const h = vi.hoisted(() => ({ context: vi.fn(), rounds: vi.fn(), stats: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../standings-context', () => ({ loadNativeSeasonStandingsContext: h.context }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getByeRoundsByPhaseIds: h.rounds }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseStandingsBattleStats: h.stats }));

import { loadPhaseReportStandings } from '../report-standings';

function input(): PhaseReportStandingsInput {
  return {
    phase: { id: 'phase', season_id: 'league', bracket_type: 'swiss', name: 'Synthetic phase', description: '',
      ruleset_id: 'version', best_of_default: 1, bo_overrides: {}, is_doubles: false,
      team_visibility: 'hidden_until_match', status: 'active', current_round: 2, stage_order: 1,
      advancement_rule: null, enrollment_source: null, archived: false, legacy: false,
      bracket_reset_enabled: false, third_place_enabled: false, format_stage_key: null, format_group: 0,
      stage_spec: null, created_at: '', updated_at: '' },
    round: { id: 'round', phase_id: 'phase', round_number: 2, name: 'Round 2', best_of: 1,
      status: 'active', pairings_generated: true, deadline: null, bracket_side: null,
      bye_player_ids: [], created_at: '', updated_at: '' },
    season: { id: 'league', format_type: 'singles', name: 'Synthetic league', description: '',
      ruleset_id: 'version', start_date: null, end_date: null, status: 'active', archived: false, legacy: false,
      is_test_season: true, core_pool: null, point_buy_list_id: null, language: 'en', created_at: '', updated_at: '' },
    ruleset: makeRuleset(), gen: 9,
    matches: [], reportType: 'round_recap',
    participants: [{ id: 'p1', name: 'Aster', avatar_url: null }, { id: 'p2', name: 'Briar', avatar_url: null }],
    leagueParticipants: [],
  };
}

function match(round: number, winner = 'p1'): PhaseReportStandingsInput['matches'][number] {
  return { id: `match-${round}`, phase_id: 'phase', round_id: `round-${round}`, round_number: round,
    status: 'completed', player_1_id: 'p1', player_2_id: 'p2', winner_id: winner,
    bracket_side: null, bracket_pos: null, player_1_name: 'Aster', player_2_name: 'Briar',
    player_1_avatar_url: null, player_2_avatar_url: null, winner_name: winner, games: [], round_status: 'completed',
    submitter_id: null, date_played: null, scheduled_at: null, auto_confirm_at: null, confirmed_at: null,
    notes: '', social_image_url: null, created_at: '', updated_at: '' };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.context.mockResolvedValue({ formatType: 'singles' } satisfies SeasonStandingsContext);
  h.rounds.mockResolvedValue(new Map([['phase', [
    { round_number: 1, bye_player_ids: ['p2'] }, { round_number: 3, bye_player_ids: ['p1'] },
  ]]]));
  h.stats.mockResolvedValue([]);
});

describe('native report standings assembly', () => {
  it('uses native completed matches and Swiss byes only through the recap round', async () => {
    const scope = input();
    scope.matches = [match(1), match(2), match(3), { ...match(2), id: 'pending', status: 'pending_confirmation' }];
    const result = await loadPhaseReportStandings(scope);
    expect(result.current.find(p => p.player_id === 'p1')).toMatchObject({ wins: 2, points: 2 });
    expect(result.current.find(p => p.player_id === 'p2')).toMatchObject({ wins: 1, points: 1 });
    expect(result.previous?.find(p => p.player_id === 'p1')?.wins).toBe(1);
    expect(result.currentByes).toEqual([{ player_id: 'p2', round_number: 1 }]);
    expect(h.context).toHaveBeenCalledExactlyOnceWith('league');
    expect(h.rounds).toHaveBeenCalledExactlyOnceWith(['phase']);
    expect(h.stats).toHaveBeenCalledExactlyOnceWith('phase');
  });

  it('excludes the forecast round and future stats without turning round zero into an unbounded table', async () => {
    const scope = input();
    scope.reportType = 'round_forecast'; scope.matches = [match(1), match(2)];
    h.stats.mockResolvedValue([
      { player_id: 'p1', round_number: 1, kos_dealt: 2, was_koed: false, game_id: 'first' },
      { player_id: 'p1', round_number: 2, kos_dealt: 99, was_koed: false, game_id: 'future' },
    ]);
    const result = await loadPhaseReportStandings(scope);
    expect(result.current.find(p => p.player_id === 'p1')).toMatchObject({ wins: 1, kill_differential: 2 });
    scope.round.round_number = 1;
    const first = await loadPhaseReportStandings(scope);
    expect(first.current.every(p => p.points === 0 && p.kill_differential === 0)).toBe(true);
    expect(first.currentByes).toEqual([]); expect(first.previous).toBeNull();
  });

  it('does not score round robin rest byes and describes the actual points', async () => {
    const scope = input(); scope.phase.bracket_type = 'round_robin'; scope.matches = [match(1)];
    const result = await loadPhaseReportStandings(scope);
    expect(result.current.find(p => p.player_id === 'p1')?.points).toBe(3);
    expect(result.currentByes).toEqual([]);
    expect(JSON.parse(result.scoring)).toEqual({ win: 3, draw: 0, loss: 0 });
    expect(h.rounds).not.toHaveBeenCalled();
  });

  it('uses the stored EPB tiebreaker chain, narrow native kills and pack points without scoring byes', async () => {
    h.context.mockResolvedValue({ formatType: 'evolution_point_buy', evolutionPoints: { p1: 0, p2: 100 },
      tiebreakerOrder: ['kill_difference', 'evolution_points', 'match_points'] } satisfies SeasonStandingsContext);
    h.stats.mockResolvedValue([{ player_id: 'p1', round_number: 1, kos_dealt: 5, was_koed: false }]);
    const scope = input(); scope.matches = [match(1), match(2, 'p2')];
    const result = await loadPhaseReportStandings(scope);
    expect(result.current[0].player_id).toBe('p1');
    expect(result.current[0].points).toBe(effectiveMatchPoints('evolution_point_buy').pointsPerWin);
    expect(result.currentByes).toEqual([]);
    expect(JSON.parse(result.scoring).win).toBe(effectiveMatchPoints('evolution_point_buy').pointsPerWin);
    expect(h.rounds).not.toHaveBeenCalled();
  });

  it('selects the actual kit phase even when it has no matches yet', async () => {
    const scoring = { win: 7, loss: 0, bye: 2 };
    const kit: KitStandingsData = { engine: 'kit',
      stages: {
        other: { key: 'other', scoring: { win: 99, loss: 0, bye: 99 }, rank: [{ kind: 'manual' }] },
        phase: { key: 'actual', scoring, rank: [{ kind: 'manual' }] },
      }, stageOfMatch: {}, outcomes: {}, coinFlips: {},
      manualOrder: { other: ['p1', 'p2'], phase: ['p2', 'p1'] }, adjustments: { other: { p1: 500 } },
    };
    h.context.mockResolvedValue({ formatType: 'custom', kit } satisfies SeasonStandingsContext);
    const result = await loadPhaseReportStandings(input());
    expect(result.current[0].player_id).toBe('p2');
    expect(result.current.every(p => p.points < 500)).toBe(true);
    expect(JSON.parse(result.scoring)).toEqual(scoring);
    expect(h.stats).not.toHaveBeenCalled();
  });

  it('keeps double-elimination grand-finals metadata for final placement', async () => {
    const scope = input(); scope.phase.bracket_type = 'double_elim';
    scope.phase.bracket_reset_enabled = false;
    scope.matches = [match(1), { ...match(2, 'p2'), bracket_side: 'grand_finals', bracket_pos: 0 }];
    const result = await loadPhaseReportStandings(scope);
    expect(result.current.map(p => p.player_id)).toEqual(['p2', 'p1']);
  });

  it('fails on mismatched ownership or missing native round facts before reads', async () => {
    const scope = input(); scope.matches = [{ ...match(1), phase_id: 'foreign' }];
    await expect(loadPhaseReportStandings(scope)).rejects.toThrow('native phase matches');
    scope.matches = [{ ...match(1), round_number: undefined }];
    await expect(loadPhaseReportStandings(scope)).rejects.toThrow('native phase matches');
    scope.matches = []; scope.round.phase_id = 'foreign';
    await expect(loadPhaseReportStandings(scope)).rejects.toThrow('scope mismatch');
    expect(h.context).not.toHaveBeenCalled();
  });

  it('does not turn a failed native stats read into a successful empty standings table', async () => {
    const error = new Error('Native standings stats unavailable'); h.stats.mockRejectedValue(error);
    await expect(loadPhaseReportStandings(input())).rejects.toBe(error);
  });
});
