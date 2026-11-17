import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phase, PhaseParticipant, PhaseRound } from '@/types/league-phase';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { Game, BattleStat } from '@/types/game';
import type { NativeGamePipelineEffects } from '../game-pipeline-storage';
import type { GamePipelineAggregates } from '../game-pipeline-types';

const forbidden = vi.hoisted(() => vi.fn<(...args: unknown[]) => never>(() => { throw new Error('Unexpected database access outside native fixture'); }));
const nativeWrite = vi.hoisted(() => vi.fn<(table: string) => unknown>());
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: nativeWrite, rpc: forbidden } }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({
  getPhaseMatchById: vi.fn(), getMatchesByPhase: vi.fn(), getPhaseMatchesByRound: vi.fn(),
  updatePhaseMatchStatus: vi.fn(), transitionPhaseMatchStatus: vi.fn(), resetPhaseMatchFields: vi.fn(),
  clearPhaseMatchSocialImage: vi.fn(), hasDownstreamPhaseMatches: vi.fn(), createPhaseMatchBatch: vi.fn(),
  updatePhaseMatchPlayers: vi.fn(), deletePhaseMatchesByIds: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-games', () => ({
  createPhaseGame: vi.fn(), createPhaseBattleStats: vi.fn(), getNextPhaseGameNumber: vi.fn(),
  getPhaseGameWinCounts: vi.fn(), getPhaseGameById: vi.fn(), getPhaseGamesByMatch: vi.fn(),
  getPhaseBattleStatsByGame: vi.fn(), deletePhaseBattleStatsByGame: vi.fn(), deleteUncountedPhaseGameRow: vi.fn(),
  updatePhaseGameWinner: vi.fn(), setPhaseGameStatsLocked: vi.fn(), claimPhaseGameEditLease: vi.fn(),
  releasePhaseGameEditLease: vi.fn(), findPhaseGameIdByReplayHash: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn(), getPhaseParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({
  getPhaseRoundById: vi.fn(), getRoundsByPhase: vi.fn(), updatePhaseRoundStatus: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-match-outcomes', () => ({ recordPhaseMatchOutcome: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-match-snapshots', () => ({ deletePhaseMatchSnapshots: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-match-children', () => ({
  cleanPhaseMatchChildren: vi.fn(), deletePhaseMatchAnalyses: vi.fn(), deletePhaseMatchPrepAnalyses: vi.fn(),
}));

import * as games from '@/lib/supabase/queries/phase-games';
import * as matches from '@/lib/supabase/queries/phase-matches';
import * as rounds from '@/lib/supabase/queries/phase-rounds';
import * as phases from '@/lib/supabase/queries/league-phases';
import { cleanPhaseMatchChildren } from '@/lib/supabase/queries/phase-match-children';
import { recordPhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { bindReplay } from '@/lib/pkmn/replay-binding';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import { createBracketPropagation } from '@/lib/tournament/bracket-propagation';
import { phaseMatchMachine } from '../phase-match-state';
import { GameChangedConcurrentlyError, GameRecountedConcurrentlyError, MatchReplayUnresolvedError } from '@/lib/pkmn/game-pipeline';
import { createNativeGamePipeline, createNativeBracketPropagationStorage } from '../game-pipeline-storage';

const phase: Phase = {
  id: 'phase', season_id: 'league', name: 'Fixture phase', description: '', bracket_type: 'round_robin',
  ruleset_id: 'rules', best_of_default: 3, bo_overrides: {}, is_doubles: false, team_visibility: 'hidden_until_match',
  status: 'active', current_round: 1, stage_order: 1, advancement_rule: null, enrollment_source: null,
  archived: false, legacy: false, bracket_reset_enabled: true, third_place_enabled: false,
  format_stage_key: null, format_group: 0, stage_spec: null, season_format_type: 'custom', created_at: '', updated_at: '',
};
function match(overrides: Partial<PhaseMatchWithPlayers> = {}): PhaseMatchWithPlayers {
  return {
    id: 'match', phase_id: 'phase', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2', winner_id: null,
    status: 'in_progress', submitter_id: null, date_played: null, scheduled_at: null, auto_confirm_at: null,
    confirmed_at: null, notes: '', social_image_url: null, bracket_side: null, bracket_pos: null,
    created_at: '', updated_at: '', player_1_name: 'Player One', player_2_name: 'Player Two',
    player_1_avatar_url: null, player_2_avatar_url: null, winner_name: null, round_status: 'active', games: [], ...overrides,
  };
}
const game: Game = {
  id: 'game', match_id: 'match', game_number: 1, winner_id: 'p1', replay_url: '', replay_hash: null,
  source: 'manual', parsed: true, stats_locked: false, aggregate_applied_at: 'marker', exclude_all_time: false,
  created_at: '', updated_at: 'version',
};
const stat: BattleStat = {
  id: 'stat', game_id: 'game', player_id: 'p1', pokemon_name: 'Pikachu', was_brought: true, was_lead: true,
  kos_dealt: 1, was_koed: false, moves_used: [], turns_active: 1, match_won: true, created_at: '',
};
function bracketFixture() {
  const participants: PhaseParticipant[] = [1, 2, 3, 4].map((seed) => ({
    id: `p${seed}`, name: `Player ${seed}`, seed, starting_bracket: 'winners',
    discord_id: null, auth_user_id: null, ps_username: '', champions_username: '', is_admin: false,
    is_creator: false, is_guest: false, is_test_account: false, joined_date: null, avatar_url: null,
    avatar_config: null, status: 'active', suspended_until: null, ban_reason: null, created_at: '', updated_at: '',
  }));
  const competition: Phase = { ...phase, bracket_type: 'single_elim' };
  const structure = buildBracketStructureForParticipants('single_elim', participants);
  if (!structure) throw new Error('Fixture requires an elimination bracket');
  const semifinals = structure.slots.filter((slot) => slot.global_round_number === 1);
  const final = structure.slots.find((slot) => slot.global_round_number === 2);
  if (!final || semifinals.length !== 2) throw new Error('Unexpected fixture structure');
  const roundRows: PhaseRound[] = [1, 2].map((round_number) => ({
    id: `round-${round_number}`, phase_id: 'phase', name: `Round ${round_number}`, round_number, best_of: 3,
    status: 'active', pairings_generated: true, deadline: null, bracket_side: null, bye_player_ids: [], created_at: '', updated_at: '',
  }));
  const origin = match({ id: 'match', round_id: 'round-1', player_2_id: 'p4', status: 'completed', winner_id: 'p1', bracket_side: semifinals[0].bracket_side, bracket_pos: semifinals[0].bracket_pos });
  const sibling = match({ id: 'sibling', round_id: 'round-1', player_1_id: 'p2', player_2_id: 'p3', status: 'completed', winner_id: 'p2', bracket_side: semifinals[1].bracket_side, bracket_pos: semifinals[1].bracket_pos });
  const downstream = match({ id: 'final', round_id: 'round-2', status: 'completed', winner_id: 'p1', bracket_side: final.bracket_side, bracket_pos: final.bracket_pos });
  vi.mocked(phases.getPhaseById).mockResolvedValue(competition);
  vi.mocked(phases.getPhaseParticipants).mockResolvedValue(participants);
  vi.mocked(matches.getPhaseMatchById).mockResolvedValue(origin);
  vi.mocked(matches.getMatchesByPhase).mockResolvedValue([origin, sibling, downstream]);
  vi.mocked(rounds.getRoundsByPhase).mockResolvedValue(roundRows);
  return { competition, participants, origin, sibling, downstream };
}
function fixture() {
  const effects: NativeGamePipelineEffects = {
    shouldExcludeFromAllTime: vi.fn(async () => false), checkPlayerEvolutions: vi.fn(async () => []),
    planRatingRebuild: vi.fn(), rebuildRatingsForPlayers: vi.fn(async () => []),
    recomputeStreaks: vi.fn(), updateSignatures: vi.fn(), repairSeasonEvolution: vi.fn(),
    recheckEpbAfterEdit: vi.fn(async () => ({ events: [], failed: false })),
    openUnresolvedCheck: vi.fn(), revertFormatCompletion: vi.fn(async () => true),
    loadStageEndedWarning: vi.fn(async () => null), revalidateMatchPages: vi.fn(), auditUnresolved: vi.fn(),
    readOutcomeMark: vi.fn(async () => 'outcome-mark'), takeBackMarkedOutcome: vi.fn(async () => true),
    releaseTeams: vi.fn(async () => 0),
  };
  const aggregates: GamePipelineAggregates = {
    enqueueAggregateJob: vi.fn(), cancelAggregateJobsForGame: vi.fn(async () => 1),
    buildGameAggregateDeltas: vi.fn(() => ({ aggregateDeltas: [], playerDeltas: [] })),
    rollbackGameAggregates: vi.fn<GamePipelineAggregates['rollbackGameAggregates']>().mockResolvedValue('rolled_back'), applyGameAggregatesNow: vi.fn(),
  };
  return { pipeline: createNativeGamePipeline(effects, aggregates), effects, aggregates };
}

beforeEach(() => {
  vi.resetAllMocks();
  forbidden.mockImplementation(() => { throw new Error('Unexpected database access outside native fixture'); });
  nativeWrite.mockImplementation((table) => forbidden(table));
  vi.mocked(phases.getPhaseById).mockResolvedValue(phase);
  vi.mocked(phases.getPhaseParticipants).mockResolvedValue([]);
  vi.mocked(matches.getPhaseMatchById).mockResolvedValue(match());
  vi.mocked(matches.getMatchesByPhase).mockResolvedValue([]);
  vi.mocked(matches.getPhaseMatchesByRound).mockResolvedValue([]);
  vi.mocked(matches.transitionPhaseMatchStatus).mockResolvedValue(match());
  vi.mocked(matches.resetPhaseMatchFields).mockResolvedValue(match({ status: 'scheduled' }));
  vi.mocked(matches.updatePhaseMatchStatus).mockResolvedValue(match());
  vi.mocked(rounds.getPhaseRoundById).mockResolvedValue({
    id: 'round', phase_id: 'phase', name: 'Round One', round_number: 1, best_of: 3, status: 'active',
    pairings_generated: true, deadline: null, bracket_side: null, bye_player_ids: [], created_at: '', updated_at: '',
  });
  vi.mocked(rounds.getRoundsByPhase).mockResolvedValue([]);
  vi.mocked(games.getPhaseGameById).mockResolvedValue(game);
  vi.mocked(games.getPhaseGamesByMatch).mockResolvedValue([]);
  vi.mocked(games.getPhaseBattleStatsByGame).mockResolvedValue([stat]);
  vi.mocked(games.createPhaseGame).mockResolvedValue(game);
  vi.mocked(games.createPhaseBattleStats).mockResolvedValue([stat]);
  vi.mocked(games.getNextPhaseGameNumber).mockResolvedValue(1);
  vi.mocked(games.getPhaseGameWinCounts).mockResolvedValue({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] });
  vi.mocked(games.findPhaseGameIdByReplayHash).mockResolvedValue(null);
  vi.mocked(games.deleteUncountedPhaseGameRow).mockResolvedValue('deleted');
  vi.mocked(games.claimPhaseGameEditLease).mockResolvedValue('claimed');
  vi.mocked(games.releasePhaseGameEditLease).mockResolvedValue(true);
});

afterEach(() => {
  expect(forbidden).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('native game pipeline', () => {
  it.each([
    { is_admin: false, actor: 'player' },
    { is_admin: true, actor: 'admin' },
  ] as const)('passes the $actor actor through the real native start and threshold guards', async ({ is_admin, actor }) => {
    const id = '11111111-1111-4111-8111-111111111111';
    const real = await vi.importActual<typeof matches>('@/lib/supabase/queries/phase-matches');
    vi.mocked(matches.updatePhaseMatchStatus).mockImplementation(real.updatePhaseMatchStatus);
    vi.mocked(matches.transitionPhaseMatchStatus).mockImplementation(real.transitionPhaseMatchStatus);
    const query = {
      update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: match({ id }), error: null })),
    };
    nativeWrite.mockImplementation((table) => table === 'phase_matches' ? query : forbidden(table));
    const guard = vi.spyOn(phaseMatchMachine, 'assertTransition');
    vi.mocked(matches.getPhaseMatchById).mockResolvedValue(match({ id, status: 'scheduled' }));
    vi.mocked(games.getPhaseGameWinCounts).mockResolvedValue({ player_1_wins: 2, player_2_wins: 0, player_ids: ['p1', 'p2'] });
    const { pipeline } = fixture();
    await expect(pipeline.recordGameResult({ match_id: id, submitter_id: 'p1', is_admin, source: 'manual', winner_id: 'p1', battle_stats: [stat] }))
      .resolves.toMatchObject({ match_status: 'pending_confirmation' });
    expect(guard).toHaveBeenCalledWith('scheduled', 'in_progress', actor);
    expect(guard).toHaveBeenCalledWith('in_progress', 'pending_confirmation', actor);
    expect(query.eq).toHaveBeenCalledWith('status', 'scheduled');
    expect(query.eq).toHaveBeenCalledWith('status', 'in_progress');
    expect(nativeWrite).toHaveBeenCalledTimes(2);
  });

  it('records manual results through phase writers and explicit aggregate ownership', async () => {
    const { pipeline, aggregates } = fixture();
    await expect(pipeline.recordGameResult({ match_id: 'match', submitter_id: 'p1', source: 'manual', winner_id: 'p1', battle_stats: [stat] }))
      .resolves.toMatchObject({ game_id: 'game', match_status: 'in_progress' });
    expect(aggregates.enqueueAggregateJob).toHaveBeenCalledWith('game', { kind: 'phase', phase_id: 'phase', season_id: 'league' });
    expect(games.createPhaseGame).toHaveBeenCalledWith(expect.not.objectContaining({ tournament_id: expect.anything() }));
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('refuses an invalid manual winner or stat owner before any write', async () => {
    const { pipeline } = fixture();
    const input = { match_id: 'match', submitter_id: 'p1', source: 'manual' as const, winner_id: 'outside', battle_stats: [stat] };
    await expect(pipeline.recordGameResult(input)).rejects.toMatchObject({ code: 'match_winner_not_participant' });
    await expect(pipeline.recordGameResult({ ...input, winner_id: 'p1', battle_stats: [{ ...stat, player_id: 'outside' }] }))
      .rejects.toMatchObject({ code: 'admin_game_stats_player_not_participant' });
    expect(games.createPhaseGame).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('compensates a failed native stats/job write with a fenced delete', async () => {
    const { pipeline, aggregates } = fixture();
    const failure = new Error('queue unavailable');
    vi.mocked(aggregates.enqueueAggregateJob).mockRejectedValue(failure);
    await expect(pipeline.recordGameResult({ match_id: 'match', submitter_id: 'p1', source: 'manual', winner_id: 'p1', battle_stats: [stat] })).rejects.toBe(failure);
    expect(games.deleteUncountedPhaseGameRow).toHaveBeenCalledWith('game');
  });

  it('keeps a concurrent status decision after a native game edit', async () => {
    const { pipeline, effects } = fixture();
    vi.mocked(matches.transitionPhaseMatchStatus).mockResolvedValue(null);
    vi.mocked(matches.getPhaseMatchById).mockResolvedValueOnce(match()).mockResolvedValue(match({ status: 'completed', winner_id: 'p2' }));
    await expect(pipeline.editGame({ game_id: 'game', admin_id: 'admin', winner_id: 'p2' })).resolves.toMatchObject({
      match_status: 'completed', match_winner_id: 'p2', match_status_conflict: true,
    });
    expect(effects.rebuildRatingsForPlayers).not.toHaveBeenCalled();
  });

  it('binds a replay winner, stats and hash to the same native insert', async () => {
    const { pipeline } = fixture();
    const replay = bindReplay('https://replay.pokemonshowdown.com/gen9ou-fixture', [
      '|player|p1|ReplayOne|1|', '|player|p2|ReplayTwo|2|', '|teamsize|p1|1', '|teamsize|p2|1',
      '|poke|p1|Pikachu, L50|', '|poke|p2|Eevee, L50|', '|start',
      '|switch|p1a: Pikachu|Pikachu, L50|100/100', '|switch|p2a: Eevee|Eevee, L50|100/100',
      '|turn|1', '|move|p1a: Pikachu|Thunderbolt|p2a: Eevee', '|faint|p2a: Eevee', '|win|ReplayOne',
    ].join('\n'));
    await pipeline.recordGameResult({ match_id: 'match', submitter_id: 'p1', source: 'ps_replay', replay, side_player_ids: ['p1', 'p2'] });
    expect(games.createPhaseGame).toHaveBeenCalledWith(expect.objectContaining({ winner_id: 'p1', replay_hash: replay.hash, replay_url: replay.url }));
    expect(games.createPhaseBattleStats).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ player_id: 'p1', pokemon_name: 'Pikachu', match_won: true }),
      expect.objectContaining({ player_id: 'p2', pokemon_name: 'Eevee', match_won: false }),
    ]));
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('disputes an engine tie with a native outcome and explicit ancillary callbacks', async () => {
    const { pipeline, effects } = fixture();
    vi.mocked(recordPhaseMatchOutcome).mockResolvedValue('written');
    const replay = bindReplay('gen9ou-tie', '|player|p1|ReplayOne|1|\n|player|p2|ReplayTwo|2|\n|tie|');
    await expect(pipeline.recordGameResult({ match_id: 'match', submitter_id: 'p1', source: 'ps_replay', replay, side_player_ids: ['p1', 'p2'] }))
      .rejects.toBeInstanceOf(MatchReplayUnresolvedError);
    expect(recordPhaseMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'match', kind: 'unresolved' }));
    expect(matches.transitionPhaseMatchStatus).toHaveBeenCalledWith('match', { expectedStatus: 'in_progress', status: 'disputed' }, 'system');
    expect(effects.revalidateMatchPages).toHaveBeenCalledWith('phase', 'match');
    expect(effects.auditUnresolved).toHaveBeenCalledWith(match(), expect.objectContaining({ replay }), true);
    expect(games.createPhaseGame).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it.each([
    { is_admin: false, actor: 'player' },
    { is_admin: true, actor: 'admin' },
  ] as const)('starts a scheduled replay tie as $actor before the system disputes it', async ({ is_admin, actor }) => {
    const { pipeline } = fixture();
    vi.mocked(matches.getPhaseMatchById).mockResolvedValue(match({ status: 'scheduled' }));
    vi.mocked(recordPhaseMatchOutcome).mockResolvedValue('written');
    const replay = bindReplay('gen9ou-tie', '|player|p1|ReplayOne|1|\n|player|p2|ReplayTwo|2|\n|tie|');
    await expect(pipeline.recordGameResult({ match_id: 'match', submitter_id: 'p1', is_admin, source: 'ps_replay', replay, side_player_ids: ['p1', 'p2'] }))
      .rejects.toBeInstanceOf(MatchReplayUnresolvedError);
    expect(matches.updatePhaseMatchStatus).toHaveBeenCalledWith('match', 'in_progress', undefined, undefined, undefined, 'scheduled', actor);
    expect(matches.transitionPhaseMatchStatus).toHaveBeenCalledWith('match', { expectedStatus: 'in_progress', status: 'disputed' }, 'system');
  });

  it('cancels before reading the rollback marker, re-applies and releases the edit lease', async () => {
    const { pipeline, aggregates } = fixture();
    const order: string[] = [];
    vi.mocked(aggregates.cancelAggregateJobsForGame).mockImplementation(async () => { order.push('cancel'); return 1; });
    vi.mocked(games.getPhaseGameById).mockImplementation(async () => { order.push('read'); return game; });
    vi.mocked(aggregates.rollbackGameAggregates).mockImplementation(async () => { order.push('rollback'); return 'rolled_back'; });
    vi.mocked(aggregates.applyGameAggregatesNow).mockImplementation(async () => { order.push('apply'); });
    await pipeline.editGame({ game_id: 'game', admin_id: 'admin', winner_id: 'p2' });
    expect(order).toEqual(['read', 'cancel', 'read', 'rollback', 'apply']);
    expect(games.claimPhaseGameEditLease).toHaveBeenCalledWith('game', 'version', expect.any(String));
    expect(games.releasePhaseGameEditLease).toHaveBeenCalledWith('game', expect.any(String));
    expect(aggregates.rollbackGameAggregates).toHaveBeenCalledWith('game', 'marker', expect.anything(), { kind: 'phase', phase_id: 'phase', season_id: 'league' });
    expect(matches.transitionPhaseMatchStatus).toHaveBeenCalledWith('match', expect.objectContaining({ status: 'in_progress' }), 'system');
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('does not write over a lost rollback race, and still releases its edit lease', async () => {
    const { pipeline, aggregates } = fixture();
    vi.mocked(aggregates.rollbackGameAggregates).mockResolvedValue('marker_changed');
    await expect(pipeline.editGame({ game_id: 'game', admin_id: 'admin', winner_id: 'p2' })).rejects.toBeInstanceOf(GameChangedConcurrentlyError);
    expect(games.updatePhaseGameWinner).not.toHaveBeenCalled();
    expect(aggregates.enqueueAggregateJob).not.toHaveBeenCalled();
    expect(games.releasePhaseGameEditLease).toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('re-queues a failed edit and preserves its failure', async () => {
    const { pipeline, aggregates } = fixture();
    const failure = new Error('apply failed');
    vi.mocked(aggregates.applyGameAggregatesNow).mockRejectedValue(failure);
    await expect(pipeline.editGame({ game_id: 'game', admin_id: 'admin', winner_id: 'p2' })).rejects.toBe(failure);
    expect(aggregates.enqueueAggregateJob).toHaveBeenCalledWith('game', { kind: 'phase', phase_id: 'phase', season_id: 'league' });
    expect(games.releasePhaseGameEditLease).toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('refuses the fenced delete when another edit re-counted the game', async () => {
    const { pipeline } = fixture();
    vi.mocked(games.deleteUncountedPhaseGameRow).mockResolvedValue('counted');
    await expect(pipeline.deleteGame('game', 'admin')).rejects.toBeInstanceOf(GameRecountedConcurrentlyError);
    expect(matches.transitionPhaseMatchStatus).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('resets native matches and rounds without losing outcome fencing or child cleanup', async () => {
    const { pipeline, effects } = fixture();
    vi.mocked(matches.getPhaseMatchesByRound).mockResolvedValue([match()]);
    await expect(pipeline.previewMatchReset('match')).resolves.toEqual({ games_to_delete: 0, was_completed: false, downstream: [] });
    await expect(pipeline.resetRound('round', 'admin')).resolves.toMatchObject({ matches_reset: 1, total_games_deleted: 0 });
    expect(cleanPhaseMatchChildren).toHaveBeenCalledWith('match', effects);
    expect(matches.resetPhaseMatchFields).toHaveBeenCalledWith('match', 'in_progress');
    expect(effects.takeBackMarkedOutcome).toHaveBeenCalledWith('match', 'outcome-mark');
    expect(rounds.updatePhaseRoundStatus).toHaveBeenCalledWith('round', 'pending', 'active');
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('refuses played native downstream matches before claiming an edit lease', async () => {
    const { pipeline, effects } = fixture();
    bracketFixture();
    await expect(pipeline.editGame({ game_id: 'game', admin_id: 'admin', winner_id: 'p4' }))
      .rejects.toMatchObject({ code: 'game_change_downstream_played' });
    expect(effects.planRatingRebuild).toHaveBeenCalledWith(expect.any(Array), { excludeMatchIds: ['match', 'final'] });
    expect(games.claimPhaseGameEditLease).not.toHaveBeenCalled();
    expect(games.deleteUncountedPhaseGameRow).not.toHaveBeenCalled();
  });

  it('preserves saved-change warnings from mandatory native effect callbacks', async () => {
    const { pipeline, effects } = fixture();
    vi.mocked(matches.getPhaseMatchById).mockResolvedValue(match({ status: 'completed', winner_id: 'p1' }));
    vi.mocked(effects.revertFormatCompletion).mockResolvedValue(false);
    vi.mocked(effects.loadStageEndedWarning).mockResolvedValue({ phase_id: 'phase', phase_name: 'Fixture phase', advanced: null });
    await expect(pipeline.deleteGame('game', 'admin')).resolves.toMatchObject({
      format_revert_failed: true,
      stage_already_ended: { phase_id: 'phase', advanced: null },
    });
    expect(effects.rebuildRatingsForPlayers).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('propagates a native winner through the shared slot planner without a tournament row', async () => {
    const { competition, participants, origin, sibling } = bracketFixture();
    vi.mocked(matches.getMatchesByPhase).mockResolvedValue([{ ...origin, status: 'in_progress', winner_id: null }, sibling]);
    vi.mocked(matches.createPhaseMatchBatch).mockImplementation(async (inputs) => inputs.map((input) => ({ ...match(), ...input, id: 'created' })));
    const bracket = createBracketPropagation(createNativeBracketPropagationStorage({ releaseTeams: vi.fn(async () => 0) }));
    await bracket.propagateBracketOnMatchComplete(origin, competition, participants);
    expect(matches.createPhaseMatchBatch).toHaveBeenCalledWith([expect.objectContaining({ phase_id: 'phase', round_id: 'round-2', player_1_id: 'p1', player_2_id: 'p2' })]);
    const input = vi.mocked(matches.createPhaseMatchBatch).mock.calls[0][0][0];
    expect(input).not.toHaveProperty('tournament_id');
  });

  it('unpropagates only scheduled unplayed native slots', async () => {
    const { competition, participants, origin, sibling, downstream } = bracketFixture();
    const effects = { releaseTeams: vi.fn(async () => 0) };
    const bracket = createBracketPropagation(createNativeBracketPropagationStorage(effects));
    await expect(bracket.unpropagateBracketOnMatchReset(origin, competition, participants)).resolves.toEqual([]);
    vi.mocked(matches.getMatchesByPhase).mockResolvedValue([origin, sibling, { ...downstream, status: 'scheduled', winner_id: null }]);
    await expect(bracket.unpropagateBracketOnMatchReset(origin, competition, participants)).resolves.toEqual(['final']);
    expect(matches.deletePhaseMatchesByIds).toHaveBeenCalledWith(['final'], effects);
  });
});
