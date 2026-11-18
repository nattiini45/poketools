import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadNativePhasePageData } from '../public-page-data';

const reads = vi.hoisted(() => ({
  phase: {
    rounds: vi.fn(), matches: vi.fn(), participants: vi.fn(), battleStats: vi.fn(), reports: vi.fn(),
    seasonKitStandings: vi.fn(),
  },
  league: {
    seasonGymTypes: vi.fn(), aggregatesSummary: vi.fn(), totalGames: vi.fn(), seasonRow: vi.fn(),
    seasonEvolutionPoints: vi.fn(), seasonFormatRules: vi.fn(), seasonKitStandings: vi.fn(),
    tournamentMatches: vi.fn(), tournamentMatchRecords: vi.fn(),
  },
  ruleset: vi.fn(),
}));

vi.mock('@/lib/cache/phase-public-reads', () => ({ phasePublicReads: reads.phase }));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: reads.league }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: reads.ruleset }));

const phase = { id: 'phase-id', season_id: 'league-id', season_format_type: null, ruleset_id: 'ruleset-id' };
const match = {
  id: 'match-id', phase_id: phase.id, round_number: 2, status: 'completed', player_1_id: 'player-a',
  player_2_id: 'player-b', winner_id: 'player-a', bracket_side: null, bracket_pos: null,
};

beforeEach(() => {
  reads.league.seasonRow.mockResolvedValue({ id: phase.season_id });
  reads.phase.matches.mockResolvedValue([match, { ...match, id: 'unplayed', status: 'scheduled' }]);
});

afterEach(() => vi.resetAllMocks());

it('loads the native page with nine read calls and derives records from the matches it already owns', async () => {
  const data = await loadNativePhasePageData(phase, false);
  expect(data?.matchRecords).toEqual([{
    match_id: 'match-id', round_number: 2, player_1_id: 'player-a', player_2_id: 'player-b',
    winner_id: 'player-a', bracket_side: null, bracket_pos: null,
  }]);
  expect(reads.league.aggregatesSummary).toHaveBeenCalledExactlyOnceWith('phase', phase.id);
  expect(reads.league.totalGames).toHaveBeenCalledExactlyOnceWith('phase', phase.id);
  const calls = [...Object.values(reads.phase), ...Object.values(reads.league), reads.ruleset]
    .reduce((sum, read) => sum + read.mock.calls.length, 0);
  expect(calls).toBe(9);
  expect(reads.league.tournamentMatches).not.toHaveBeenCalled();
  expect(reads.league.tournamentMatchRecords).not.toHaveBeenCalled();
  expect(reads.phase.reports).not.toHaveBeenCalled();
});

it('loads the league’s EPB points and stored order without the Kit reader', async () => {
  reads.league.seasonEvolutionPoints.mockResolvedValue({ 'player-a': 5 });
  reads.league.seasonFormatRules.mockResolvedValue({ tiebreaker_order: ['wins'] });
  const data = await loadNativePhasePageData({ ...phase, season_format_type: 'evolution_point_buy' }, true);
  expect(data?.evolutionPoints).toEqual({ 'player-a': 5 });
  expect(data?.tiebreakerOrder).toEqual(['wins']);
  expect(reads.phase.reports).toHaveBeenCalledExactlyOnceWith(phase.id);
  expect(reads.phase.seasonKitStandings).not.toHaveBeenCalled();
});

it('loads the selected native Kit ranking and never the legacy Kit ranking', async () => {
  reads.phase.seasonKitStandings.mockResolvedValue(null);
  await loadNativePhasePageData({ ...phase, season_format_type: 'custom' }, false);
  expect(reads.phase.seasonKitStandings).toHaveBeenCalledExactlyOnceWith(phase.season_id);
  expect(reads.league.seasonKitStandings).not.toHaveBeenCalled();
  expect(reads.league.seasonEvolutionPoints).not.toHaveBeenCalled();
});

it('refuses an incoherent completed match without substituting the legacy records', async () => {
  reads.phase.matches.mockResolvedValue([{ ...match, round_number: undefined }]);
  await expect(loadNativePhasePageData(phase, false)).rejects.toThrow('Completed phase match has no round number');
  expect(reads.league.tournamentMatchRecords).not.toHaveBeenCalled();
});
