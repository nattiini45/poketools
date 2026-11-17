import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ scope: vi.fn(), matches: vi.fn(), participants: vi.fn(), leagueParticipants: vi.fn(),
  stats: vi.fn(), team: vi.fn(), legacy: vi.fn(() => { throw new Error('Legacy reader called'); }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../../phase-context', () => ({ loadPhaseRoundScope: h.scope }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getMatchesByPhase: h.matches }));
vi.mock('@/lib/supabase/queries/phase-ai-artifacts', () => ({ getPhaseAiParticipants: h.participants }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseBattleStatsByMatch: h.stats }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPlayerPhaseTeamForMatch: h.team }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getPublicSeasonParticipants: h.leagueParticipants,
  getSeasonById: h.legacy, getSeasonParticipants: h.legacy }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: h.legacy, getParticipants: h.legacy }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: h.legacy }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByRound: h.legacy, getCompletedMatchRecords: h.legacy }));
vi.mock('@/lib/supabase/queries/games', () => ({ getBattleStatsByMatch: h.legacy }));
import { buildPhaseRecapFactPack, buildPhaseForecastFactPack } from '../phase-fact-pack';
const standings = vi.fn(async () => ({ current: [], previous: null, currentByes: [], previousByes: [], scoring: 'Frozen scoring rules' }));
const match = (id: string, round: string, status = 'completed') => ({ id, phase_id: 'phase', round_id: round, status,
  player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'Aster', player_2_name: 'Briar', winner_id: 'p1', round_number: 2 });
beforeEach(() => {
  vi.clearAllMocks();
  h.scope.mockResolvedValue({ phase: { id: 'phase', season_id: 'league', name: 'Stage', team_visibility: 'hidden_until_match' },
    round: { id: 'round', name: 'Second round', round_number: 2, best_of: 3 }, season: { name: 'League' }, ruleset: { base_format: 'gen9ou' }, gen: 9 });
  h.matches.mockResolvedValue([match('included', 'round'), match('excluded', 'other-round')]);
  h.participants.mockResolvedValue([{ id: 'p1', name: 'Aster', avatar_url: null }, { id: 'p2', name: 'Briar', avatar_url: null }]);
  h.leagueParticipants.mockResolvedValue([]); h.stats.mockResolvedValue({});
  h.team.mockImplementation(async (id: string) => ({ player_id: id, match_id: 'upcoming', library_published_at: null, pokemon: [{ species: 'HiddenSecret' }] }));
});
describe('native Kale facts', () => {
  it('scopes recap stats to the actual phase round and reuses deterministic facts', async () => {
    const facts = await buildPhaseRecapFactPack('phase', 'round', standings);
    expect(h.stats).toHaveBeenCalledTimes(1); expect(h.stats).toHaveBeenCalledWith('included');
    expect(facts.matches).toHaveLength(1); expect(facts.matches[0].matchId).toBe('included');
    expect(facts.matchData[0].match_id).toBe('included'); expect(facts.scoring).toBe('Frozen scoring rules');
    expect(facts.bestOf).toBe(3); expect(h.legacy).not.toHaveBeenCalled();
    expect(standings).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'round_recap', phase: expect.objectContaining({ id: 'phase' }) }));
    expect(JSON.stringify(facts)).not.toContain('tournament_id');
  });
  it('excludes hidden rosters from forecasts, including validation allowlists', async () => {
    h.matches.mockResolvedValue([match('upcoming', 'round', 'scheduled')]);
    const facts = await buildPhaseForecastFactPack('phase', 'round', standings);
    expect(facts.matchups[0].player1Team).toEqual([]); expect(facts.validPokemonNames).toEqual([]);
    expect(JSON.stringify(facts)).not.toContain('HiddenSecret'); expect(h.legacy).not.toHaveBeenCalled();
  });
  it('rejects a foreign match before standings or stats are read', async () => {
    h.matches.mockResolvedValue([{ ...match('foreign', 'round'), phase_id: 'other' }]);
    await expect(buildPhaseRecapFactPack('phase', 'round', standings)).rejects.toThrow('does not belong');
    expect(standings).not.toHaveBeenCalled(); expect(h.stats).not.toHaveBeenCalled();
  });
  it('fails rather than substituting an empty pack on stats or standings failure', async () => {
    const error = new Error('Native stats unavailable'); h.stats.mockRejectedValueOnce(error);
    await expect(buildPhaseRecapFactPack('phase', 'round', standings)).rejects.toBe(error);
    standings.mockRejectedValueOnce(new Error('Standings unavailable'));
    await expect(buildPhaseForecastFactPack('phase', 'round', standings)).rejects.toThrow('Standings unavailable');
  });
});
