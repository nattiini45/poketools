import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), match: vi.fn(), phase: vi.fn(), round: vi.fn(),
  member: vi.fn(), season: vi.fn(), ruleset: vi.fn(), team: vi.fn(), prep: vi.fn(), history: vi.fn(),
  conversation: vi.fn(), insert: vi.fn(), core: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: mocks.auth }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: mocks.match }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: mocks.phase, isPlayerPhaseParticipant: mocks.member }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: mocks.round }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: mocks.season, getParticipantCore: mocks.core }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: mocks.ruleset }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPlayerPhaseTeamForMatch: mocks.team }));
vi.mock('@/lib/supabase/queries/agent-player-context', () => ({ getAgentPhasePrep: mocks.prep, getAgentPhaseHistory: mocks.history }));
vi.mock('../memory', () => ({ conversationBelongsTo: mocks.conversation }));
vi.mock('@/lib/supabase/queries/agent-suggestions', () => ({ insertNativeAgentSuggestion: mocks.insert }));

import { buildNativePlayerContext, getNativePlayerTeams } from '../native-context';
import { createNativePlayerTools } from '../tools/native-player';
import { recordNativePlayerSuggestion } from '../native-memory';

const ids = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [seasonId, phaseId, matchId, roundId, playerId, opponentId, conversationId] = ids;
const context = { generation: 'native-phase-v1', match: { resource: 'match',
  owner: { kind: 'phase', seasonId, phaseId }, id: matchId } };
const match = { id: matchId, phase_id: phaseId, round_id: roundId, player_1_id: playerId,
  player_2_id: opponentId, player_1_name: 'Player One', player_2_name: 'Player Two', status: 'scheduled',
  notes: 'PRIVATE ADMIN NOTE', submitter_id: 'PRIVATE SUBMITTER' };
const phase = { id: phaseId, season_id: seasonId, ruleset_id: 'pin', team_visibility: 'hidden_until_match' };
const suggestion = { context, conversationId, persona: 'linden_match_prep', proposedTeam: { pokemon: ['Pikachu'] },
  reasoning: null, topicTags: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ playerId, isAdmin: false, isCreator: false, isResourceAdmin: false });
  mocks.match.mockResolvedValue(match);
  mocks.phase.mockResolvedValue(phase);
  mocks.round.mockResolvedValue({ id: roundId, phase_id: phaseId });
  mocks.member.mockResolvedValue(true);
  mocks.season.mockResolvedValue({ id: seasonId, name: 'Example League', description: '' });
  mocks.ruleset.mockResolvedValue({ id: 'pin', base_format: 'gen9ou' });
  mocks.core.mockResolvedValue(null);
  mocks.prep.mockResolvedValue([{ species: 'Own prep' }]);
  mocks.team.mockImplementation(async (id: string) => ({ id: 'team', player_id: id, phase_id: phaseId,
    season_id: seasonId, match_id: null, library_published_at: null, pokemon: [{ species: id === playerId ? 'Own plan' : 'OPPONENT SECRET' }] }));
  mocks.history.mockResolvedValue({ matches: [{ id: matchId, result: 'win' }], total: 21, truncated: true });
  mocks.conversation.mockResolvedValue(true);
  mocks.insert.mockResolvedValue({ id: 'suggestion' });
});

describe('dormant native player assembly', () => {
  it('projects explicit native owners, pin, own prep and native-only history without private fields', async () => {
    const result = await buildNativePlayerContext(context);
    expect(result.match_ref).toEqual(context.match);
    expect(result.history.matches[0].ref.owner).toEqual(context.match.owner);
    expect(result.history.truncated).toBe(true);
    expect(result.teams.own).toEqual([{ species: 'Own prep' }]);
    expect(result.teams.opponent).toBeNull();
    expect(mocks.history).toHaveBeenCalledWith(phaseId, playerId, opponentId);
    expect(mocks.history).toHaveBeenCalledWith(phaseId, playerId, undefined);
    expect(mocks.prep).toHaveBeenCalledExactlyOnceWith(matchId, playerId);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET|tournament_id|submitter_id|notes/);
  });

  it.each([
    { upcoming_match_id: matchId },
    { ...context, match: { ...context.match, tournament_id: phaseId } },
    { ...context, match: { ...context.match, owner: { kind: 'tournament', tournamentId: phaseId } } },
    { ...context, generation: 'legacy' },
  ])('rejects ambiguous or legacy input before effects %#', async input => {
    await expect(buildNativePlayerContext(input)).rejects.toThrow();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.match).not.toHaveBeenCalled();
  });

  it.each(['match', 'phase', 'round', 'season'])('rejects missing %s with no context reads', async key => {
    mocks[key as 'match' | 'phase' | 'round' | 'season'].mockResolvedValue(null);
    await expect(buildNativePlayerContext(context)).rejects.toThrow();
    expect(mocks.prep).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it.each([
    ['match', { ...match, phase_id: opponentId }],
    ['phase', { ...phase, season_id: opponentId }],
    ['round', { id: roundId, phase_id: opponentId }],
  ] as const)('refuses cross-owner %s without fallback', async (key, value) => {
    mocks[key].mockResolvedValue(value);
    await expect(buildNativePlayerContext(context)).rejects.toThrow();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it.each(['isCreator', 'isResourceAdmin', 'isAdmin'])('does not grant nonparticipants player prep through %s', async role => {
    mocks.auth.mockResolvedValue({ playerId: conversationId, [role]: true });
    await expect(buildNativePlayerContext(context)).rejects.toThrow('unavailable');
    expect(mocks.team).not.toHaveBeenCalled();
  });

  it('requires live phase membership and propagates auth/read failure', async () => {
    mocks.member.mockResolvedValue(false);
    await expect(buildNativePlayerContext(context)).rejects.toThrow('phase unavailable');
    mocks.auth.mockRejectedValue(new Error('revoked'));
    await expect(buildNativePlayerContext(context)).rejects.toThrow('revoked');
    mocks.auth.mockResolvedValue({ playerId });
    mocks.match.mockRejectedValue(new Error('read failed'));
    await expect(buildNativePlayerContext(context)).rejects.toThrow('read failed');
  });

  it.each(['isCreator', 'isResourceAdmin', 'isAdmin'])('never uses %s to expose hidden opponent plans', async role => {
    mocks.auth.mockResolvedValue({ playerId, [role]: true });
    expect((await getNativePlayerTeams(context)).opponent).toBeNull();
  });

  it.each(['completed', 'always_public', 'library'])('shows only publicly visible opponent rosters: %s', async mode => {
    if (mode === 'completed') mocks.match.mockResolvedValue({ ...match, status: 'completed' });
    if (mode === 'always_public') mocks.phase.mockResolvedValue({ ...phase, team_visibility: 'always_public' });
    if (mode === 'library') mocks.team.mockResolvedValue({ player_id: opponentId, phase_id: phaseId, season_id: seasonId,
      match_id: null, library_published_at: 'published', pokemon: [{ species: 'Public roster' }] });
    expect((await getNativePlayerTeams(context)).opponent).not.toBeNull();
    expect(mocks.prep).toHaveBeenCalledExactlyOnceWith(matchId, playerId);
  });

  it('refuses incoherent team ownership and uses own plan only without prep', async () => {
    mocks.prep.mockResolvedValue(null);
    expect((await getNativePlayerTeams(context)).own).toEqual([{ species: 'Own plan' }]);
    mocks.team.mockResolvedValue({ player_id: playerId, phase_id: opponentId, pokemon: [{ species: 'Bad owner' }] });
    expect(await getNativePlayerTeams(context)).toEqual({ own: null, opponent: null });
  });

  it('rechecks identity and membership on every reused tool call and rejects model overrides', async () => {
    const tools = createNativePlayerTools(context);
    await tools.getPhaseMatchHistory.execute({});
    mocks.member.mockResolvedValue(false);
    await expect(tools.getPhaseMatchHistory.execute({})).rejects.toThrow('unavailable');
    expect(mocks.auth).toHaveBeenCalledTimes(2);
    await expect(tools.getPhaseMatchTeams.execute({ requesterId: opponentId })).rejects.toThrow();
    expect(mocks.auth).toHaveBeenCalledTimes(2);
  });
});

describe('native suggestion boundary', () => {
  it('uses the live identity and native pointer without changing opaque payloads', async () => {
    const original = JSON.stringify(suggestion);
    await recordNativePlayerSuggestion(suggestion);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith({ playerId, conversationId, phaseMatchId: matchId,
      contextFormat: 'gen9ou', proposedTeam: suggestion.proposedTeam, reasoning: null, topicTags: [] });
    expect(JSON.stringify(suggestion)).toBe(original);
    expect(mocks.conversation).toHaveBeenCalledWith(conversationId, playerId, 'linden_match_prep');
  });

  it.each([{ ...suggestion, context: { upcoming_match_id: matchId } },
    { ...suggestion, matchId }, { ...suggestion, playerId: opponentId }])('requires fresh explicit native input %#', async input => {
    await expect(recordNativePlayerSuggestion(input)).rejects.toThrow('fresh generation');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it('rejects foreign or archived conversations and missing pins', async () => {
    mocks.conversation.mockResolvedValue(false);
    await expect(recordNativePlayerSuggestion(suggestion)).rejects.toThrow('conversation unavailable');
    mocks.conversation.mockResolvedValue(true);
    mocks.ruleset.mockResolvedValue(null);
    await expect(recordNativePlayerSuggestion(suggestion)).rejects.toThrow('ruleset unavailable');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
