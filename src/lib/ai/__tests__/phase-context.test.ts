import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ phase: vi.fn(), round: vi.fn(), match: vi.fn(), matches: vi.fn(), season: vi.fn(),
  rules: vi.fn(), participants: vi.fn(), games: vi.fn(), stats: vi.fn(), team: vi.fn(), prep: vi.fn(), replay: vi.fn(), phases: vi.fn(),
  legacy: vi.fn(() => { throw new Error('Legacy reader invoked'); }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase, getPhasesBySeasonId: h.phases }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: h.match, getMatchesByPhase: h.matches }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: h.round }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseGamesByMatch: h.games, getPhaseBattleStatsByMatch: h.stats }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPlayerPhaseTeamForMatch: h.team }));
vi.mock('@/lib/supabase/queries/phase-ai-artifacts', () => ({ getPhasePlayerPrepTeam: h.prep }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: h.season, getPublicSeasonParticipants: h.participants, getSeasonParticipants: h.legacy }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: h.rules }));
vi.mock('@/lib/supabase/queries/aggregates', () => ({ getAggregates: vi.fn(async () => []), getTotalGamesInScope: vi.fn(async () => 0), getTotalGamesInMixedScope: vi.fn(async () => 0) }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: h.legacy }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: h.legacy }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: h.legacy }));
vi.mock('@/lib/pkmn/replay', () => ({ fetchReplay: h.replay }));

import { buildPhaseMatchAnalysisPrompt, buildPhaseMatchPrepPrompt, loadPhaseMatchScope } from '../phase-context';
const phaseId = '10000000-0000-0000-0000-000000000001';
const matchId = '10000000-0000-0000-0000-000000000002';
const roundId = '10000000-0000-0000-0000-000000000003';
const fixture = () => ({ id: matchId, phase_id: phaseId, round_id: roundId, status: 'scheduled',
  player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'Aster', player_2_name: 'Briar', winner_name: null });

beforeEach(() => {
  vi.clearAllMocks();
  h.phase.mockResolvedValue({ id: phaseId, season_id: 'league', ruleset_id: 'frozen-pin', name: 'Native stage', description: '', is_doubles: false, team_visibility: 'hidden_until_match' });
  h.round.mockResolvedValue({ id: roundId, phase_id: phaseId, name: 'Round 1', best_of: 1 });
  h.match.mockResolvedValue(fixture());
  h.season.mockResolvedValue({ id: 'league', name: 'Synthetic league', language: 'de' });
  h.rules.mockResolvedValue({ id: 'frozen-pin', base_format: 'gen9ou', clauses: [], bans: { pokemon: [], moves: [], items: [], abilities: [] },
    allow: { pokemon: null, moves: null, items: null, abilities: null }, additions: { pokemon: [] }, custom_rules_string: '', min_shared_type_pct: 0, team_constraints: null });
  h.participants.mockResolvedValue([]); h.matches.mockResolvedValue([]); h.games.mockResolvedValue([]); h.stats.mockResolvedValue({});
  h.team.mockImplementation(async (id: string) => ({ player_id: id, match_id: matchId, library_published_at: null,
    pokemon: [{ species: id === 'p1' ? 'OwnSecret' : 'OpponentSecret', moves: [], evs: {}, ivs: {} }] }));
  h.prep.mockResolvedValue(null);
  h.phases.mockResolvedValue([]);
});

describe('native phase context', () => {
  it('rejects cross-phase matches and rounds before reading rules or rosters', async () => {
    h.match.mockResolvedValueOnce({ ...fixture(), phase_id: 'other' });
    await expect(loadPhaseMatchScope(phaseId, matchId)).rejects.toThrow('Match not found in phase');
    expect(h.team).not.toHaveBeenCalled(); expect(h.rules).not.toHaveBeenCalled();
    h.round.mockResolvedValueOnce({ phase_id: 'other' });
    await expect(loadPhaseMatchScope(phaseId, matchId)).rejects.toThrow('Round not found in phase');
  });
  it('reads the frozen phase pin and never exposes hidden sheets in anonymous analysis', async () => {
    const prompt = await buildPhaseMatchAnalysisPrompt(phaseId, matchId);
    expect(prompt.userPrompt).toContain('Native stage');
    expect(prompt.userPrompt).not.toContain('Secret');
    expect(prompt.systemPrompt).toContain('German');
    expect(h.rules).toHaveBeenCalledWith('frozen-pin');
    expect(h.legacy).not.toHaveBeenCalled(); expect(h.replay).not.toHaveBeenCalled();
  });
  it('only loads the perspective prep and hides opponent preparation even for public phases', async () => {
    h.phase.mockResolvedValueOnce({ id: phaseId, season_id: 'league', ruleset_id: 'frozen-pin', name: 'Stage', team_visibility: 'always_public' });
    const prompt = await buildPhaseMatchPrepPrompt(phaseId, matchId, 'p1', { scheduledOnly: true });
    expect(prompt.systemPrompt).toContain('Write all prose in German');
    expect(prompt.userPrompt).toContain('OwnSecret');
    expect(prompt.userPrompt).not.toContain('OpponentSecret');
    expect(h.prep).toHaveBeenCalledWith(phaseId, matchId, 'p1');
    expect(h.team).toHaveBeenCalledTimes(1);
    expect(h.team).toHaveBeenCalledWith('p1', expect.objectContaining({ phase_id: phaseId }));
  });
  it('refuses scheduled-only generation if the match completed before prompt construction', async () => {
    h.match.mockResolvedValue({ ...fixture(), status: 'completed' });
    await expect(buildPhaseMatchPrepPrompt(phaseId, matchId, 'p1', { scheduledOnly: true }))
      .rejects.toMatchObject({ statusCode: 400, code: 'ai_scouting_scheduled_only' });
    expect(h.prep).not.toHaveBeenCalled();
    expect(h.team).not.toHaveBeenCalled();
  });
  it('shows the opponent sheet only after this match completes and rejects nonparticipants', async () => {
    h.match.mockResolvedValue({ ...fixture(), status: 'completed' });
    expect((await buildPhaseMatchPrepPrompt(phaseId, matchId, 'p1')).userPrompt).toContain('OpponentSecret');
    await expect(buildPhaseMatchPrepPrompt(phaseId, matchId, 'creator')).rejects.toThrow('perspective');
  });
  it('fails closed when the immutable pin cannot load', async () => {
    h.rules.mockResolvedValue(null);
    await expect(buildPhaseMatchAnalysisPrompt(phaseId, matchId)).rejects.toThrow('Pinned phase ruleset');
    expect(h.team).not.toHaveBeenCalled();
  });
  it('falls back only to native sibling history when the current phase has little scouting data', async () => {
    h.phases.mockResolvedValue([{ id: 'native-sibling' }]);
    h.matches.mockImplementation(async (id: string) => id === 'native-sibling'
      ? [{ id: 'past-native-match', phase_id: id, status: 'completed', player_1_id: 'p2', player_2_id: 'p3' }] : []);
    await buildPhaseMatchPrepPrompt(phaseId, matchId, 'p1');
    expect(h.phases).toHaveBeenCalledWith('league'); expect(h.matches).toHaveBeenCalledWith('native-sibling');
    expect(h.stats).toHaveBeenCalledWith('past-native-match'); expect(h.legacy).not.toHaveBeenCalled();
  });
});
