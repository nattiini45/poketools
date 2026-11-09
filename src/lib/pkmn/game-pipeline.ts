import {
  createGame, createBattleStats, getNextGameNumber, getGameWinCounts,
  getGameById, getGamesByMatch, getBattleStatsByGame,
  deleteBattleStatsByGame, deleteUncountedGameRow, updateGameWinner,
  setGameStatsLocked, claimGameEditLease, releaseGameEditLease,
  findGameIdByReplayHash, ReplayAlreadyRecordedError,
} from '@/lib/supabase/queries/games';
import { buildGameAggregateDeltas, rollbackGameAggregates } from '@/lib/supabase/queries/aggregates';
import { shouldExcludeFromAllTime } from '@/lib/supabase/queries/test-accounts';
import {
  enqueueAggregateJob, cancelAggregateJobsForGame, applyGameAggregatesNow,
} from '@/lib/match/aggregate-queue';
import {
  updateMatchStatus,
  getMatchById,
  clearMatchSocialImage,
  resetMatchFields,
  hasDownstreamMatches,
  getMatchesByRound,
  getMatchesByTournament,
  transitionMatchStatus,
} from '@/lib/supabase/queries/matches';
import {
  findDownstreamSlotKeys,
  findMatchForSlot,
  findSlotForMatch,
  unpropagateBracketOnMatchReset,
} from '@/lib/tournament/bracket-propagation';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById, getRoundsByTournament, updateRoundStatus } from '@/lib/supabase/queries/rounds';
import { hasReachedBoThreshold, validateTransition } from '@/lib/tournament/match-state';
import { checkPlayerEvolutions } from '@/lib/draft/evolution-engine';
import {
  creditMatchRealKills,
  uncreditGameRealKills,
  recheckEpbStages,
} from '@/lib/match/evolution-match-evaluator';
import { deleteMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { deleteMatchPrepAnalysesByMatch } from '@/lib/supabase/queries/match-prep-analyses';
import { deleteMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { planRatingRebuild, rebuildRatingsForPlayers } from '@/lib/rating/updateRatings';
import { recomputeStreaks } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';
import { cleanMatchChildren } from '@/lib/match/match-children';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { roundMachine } from '@/lib/tournament/round-state';
import { MatchSubmitForbiddenError } from '@/lib/auth/match-access';
import { normalizeReplayUrlOrId } from '@/lib/pkmn/replay-reference';
import { ReplayEngineTieError, resultFromBoundReplay, type BoundReplay } from '@/lib/pkmn/replay-binding';
import { recordMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { readOutcomeMark, takeBackMarkedOutcome } from '@/lib/match/outcome-takeback';
import { GameChangeDownstreamPlayedError, MatchStateChangedError } from '@/lib/match/state-errors';
import type { DownstreamMatchSummary } from '@/lib/match/downstream-matches';
import { loadStageEndedWarning } from '@/lib/match/stage-ended';
import type { StageEndedWarning } from '@/lib/match/stage-ended-warning';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import type { MatchStatus, MatchWithPlayers } from '@/types/match';
import type { Round } from '@/types/round';
import type { ParticipantWithSeed, Tournament } from '@/types/tournament';
import type {
  Game, GameSource, BattleStatInsert, BattleStat,
  DeleteGameResult, ResetMatchResult, ResetRoundResult,
  EditGameInput, EditGameResult, MatchRecalculationSummary,
} from '@/types/game';
import type { EvolutionEvent } from '@/types/evolution';
import type { ImpossibleLineup } from '@/lib/reconcile/evolution-rebuild';
import type { MatchResetPreview } from '@/lib/admin/match-detail';

interface GamePipelineBase {
  match_id: string;
  submitter_id: string;
  /** When true, bypasses participant check (admin submitting on behalf of players) */
  is_admin?: boolean;
}

/** A result entered by hand (manual form, Champions): the caller supplies winner and stats. */
export interface EnteredGameInput extends GamePipelineBase {
  source: Exclude<GameSource, 'ps_replay'>;
  winner_id: string;
  battle_stats: BattleStatInsert[];
  screenshot_url?: string;
}

/**
 * A result read from a Showdown replay. There is no
 * winner or stats field: both come from `replay`, the same fetched log its hash was computed
 * from, and the hash is stored on the game row in the insert that records the result. The caller
 * only says which registered player played each side.
 */
export interface ReplayGameInput extends GamePipelineBase {
  source: 'ps_replay';
  replay: BoundReplay;
  /** The registered player of replay side p1 and of side p2, in that order. */
  side_player_ids: readonly [string, string];
}

export type GamePipelineInput = EnteredGameInput | ReplayGameInput;

/** What one recordGameResult call writes, whichever input it came from. */
interface RecordedResult {
  winner_id: string;
  battle_stats: BattleStatInsert[];
  replay_url?: string;
  replay_hash?: string;
  screenshot_url?: string;
}

function resolveRecordedResult(input: GamePipelineInput, match: MatchWithPlayers): RecordedResult {
  if (input.source === 'ps_replay') {
    const { winner_id, battle_stats } = resultFromBoundReplay(
      input.replay,
      input.side_player_ids,
      [match.player_1_id, match.player_2_id],
    );
    return { winner_id, battle_stats, replay_url: input.replay.url, replay_hash: input.replay.hash };
  }
  return {
    winner_id: input.winner_id,
    battle_stats: input.battle_stats,
    screenshot_url: input.screenshot_url,
  };
}

/**
 * Refuse a battle that is already bound to a game, in any match. A read before the first write;
 * the unique index on `games.replay_hash` refuses a concurrent duplicate at the insert
 * (`createGame` maps it to the same error).
 */
async function assertReplayHashUnused(replayHash: string | undefined): Promise<void> {
  if (!replayHash) return;
  const existingGameId = await findGameIdByReplayHash(replayHash);
  if (existingGameId) {
    console.error(`[game-pipeline] replay hash ${replayHash} is already bound to game ${existingGameId}`);
    throw new ReplayAlreadyRecordedError();
  }
}

interface GamePipelineResult {
  game_id: string;
  /** The recorded game's winner (for a replay result: read from the replay). */
  game_winner_id: string;
  match_status: string;
  match_winner_id: string | null;
  bo_reached: boolean;
  /**
   * Evolution events triggered by this game: legacy evolution-tier leagues only. Always empty for
   * an Evolution Point Buy season, whose real kills wait for the confirmed result (match finalize).
   */
  evolution_events: EvolutionEvent[];
}

function getAutoConfirmAt(source: GameSource, screenshotUrl?: string): string | null {
  if (source === 'ps_replay' || source === 'champions') {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  if (screenshotUrl) {
    return new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

export { MatchSubmitForbiddenError };

/** The match does not exist (or was deleted meanwhile). HTTP 404. */
export class MatchNotFoundError extends UserFacingError {
  constructor() {
    super('Match not found', { code: 'match_not_found', status: 404 });
    this.name = 'MatchNotFoundError';
  }
}

/** The match is past the point where games can be added (pending confirmation, completed or disputed). HTTP 409. */
export class MatchNotOpenForGamesError extends UserFacingError<'match_submit_wrong_status'> {
  constructor(status: MatchStatus) {
    super(`Cannot submit game for match in ${status} state`, {
      code: 'match_submit_wrong_status',
      params: { status },
      status: 409,
    });
    this.name = 'MatchNotOpenForGamesError';
  }
}

export class DuplicateReplayError extends UserFacingError {
  constructor() {
    super(
      'This replay URL was already submitted for a game in this match.',
      { code: 'duplicate_replay', status: 409 },
    );
    this.name = 'DuplicateReplayError';
  }
}

function assertReplayNotDuplicate(match: MatchWithPlayers, replayUrl?: string): void {
  if (!replayUrl?.trim()) return;
  const normalized = normalizeReplayUrlOrId(replayUrl);
  for (const game of match.games) {
    if (!game.replay_url) continue;
    if (normalizeReplayUrlOrId(game.replay_url) === normalized) {
      throw new DuplicateReplayError();
    }
  }
}

/**
 * The match left the state this request read before it could write (a
 * concurrent submission, confirmation or admin change won). HTTP 409, the same
 * `match_result_conflict` code as a lost game-number race: reload and retry.
 */
export class MatchStateConflictError extends UserFacingError {
  constructor() {
    super(
      'Another result was recorded for this match at the same moment. Reload the match and submit again.',
      { code: 'match_result_conflict', status: 409 },
    );
    this.name = 'MatchStateConflictError';
  }
}

/**
 * A replay was an engine tie: the match moved to `disputed` with an `unresolved` outcome, and no game was
 * recorded. An admin decides the match (dispute resolution or reopen).
 */
export class MatchReplayUnresolvedError extends UserFacingError {
  constructor() {
    super(
      'Pokémon Showdown ended this battle as a tie, so no result was recorded. The match is now disputed and an admin decides it.',
      { code: 'match_replay_unresolved', status: 409 },
    );
    this.name = 'MatchReplayUnresolvedError';
  }
}

/** Best effort: a custom league's `unresolved_outcome` check rules open a check for the disputed match. */
async function openUnresolvedCheck(match: MatchWithPlayers): Promise<void> {
  try {
    const tournament = await getTournamentById(match.tournament_id);
    if (!tournament || !isKitCandidate(tournament)) return;
    const { onMatchUnresolved } = await import('@/lib/format-engine/runtime/hooks');
    await onMatchUnresolved({ tournament, matchId: match.id, player1Id: match.player_1_id, player2Id: match.player_2_id });
  } catch (err) {
    logger.error('match/outcome', 'format runtime hook failed for an unresolved match', { matchId: match.id, error: err });
  }
}

/**
 * An engine tie is never scored: the match moves to `disputed` (through `in_progress` when it had not started)
 * with an `unresolved` outcome whose reason is the engine's code, and no game is written, so the replay stays free
 * for nothing else to claim. Always throws: `MatchReplayUnresolvedError` once the match is disputed,
 * `MatchStateConflictError` when a concurrent write moved the match first (nothing written then).
 *
 * The status flip commits first (a lost race must leave no outcome row behind), so a failed outcome write cannot undo
 * it. The dispute then still completes its other effects (the page refresh, the admins' `unresolved_outcome` check, the
 * audit event, which records the missing row) and answers the same 409: a disputed match is never scored, so the row is
 * not needed to keep it out of the standings, and an admin resolves the match from the check.
 */
async function disputeUnresolvedMatch(match: MatchWithPlayers, input: ReplayGameInput): Promise<never> {
  const context = {
    actor_id: input.submitter_id,
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
  };
  let status: MatchStatus = match.status;
  if (status === 'scheduled') {
    const start = validateTransition('scheduled', 'in_progress', { ...context, is_admin: input.is_admin ?? false });
    if (!start.valid) throw new Error(start.error ?? 'Cannot start match');
    const started = await updateMatchStatus(match.id, 'in_progress', undefined, undefined, undefined, 'scheduled');
    if (!started) {
      const latest = await getMatchById(match.id);
      if (latest?.status !== 'in_progress') throw new MatchStateConflictError();
    }
    status = 'in_progress';
  }

  // No player chose this move: the engine disputes the match on the admins' behalf, and in_progress -> disputed
  // is an admin transition.
  const transition = validateTransition(status, 'disputed', { ...context, is_admin: true });
  if (!transition.valid) throw new Error(transition.error ?? 'Cannot dispute match');
  const disputed = await transitionMatchStatus(match.id, {
    expectedStatus: status,
    status: 'disputed',
    autoConfirmAt: null,
  });
  if (!disputed) throw new MatchStateConflictError();

  // After the status, so a lost race leaves no outcome row behind.
  let outcomeRecorded = true;
  try {
    // 'kept': an admin row (a staging whose request died) sits on the match and is not replaced, so the dispute has no
    // `unresolved` row; reported in the audit event like a failed write.
    const written = await recordMatchOutcome({
      matchId: match.id,
      kind: 'unresolved',
      p1Faints: null,
      p2Faints: null,
      source: 'replay',
      reason: 'replay_engine_tie',
      setBy: null,
      force: false,
    });
    if (written !== 'written') {
      outcomeRecorded = false;
      logger.error('match/outcome', 'the unresolved outcome of a disputed match was kept out by an admin row', { matchId: match.id });
    }
  } catch (err) {
    outcomeRecorded = false;
    logger.error('match/outcome', 'the unresolved outcome of a disputed match could not be recorded', { matchId: match.id, error: err });
  }

  await revalidateMatchPages(match.tournament_id, match.id);
  await openUnresolvedCheck(match);
  logger.warn('match/outcome', 'replay was an engine tie; match disputed with an unresolved outcome', {
    matchId: match.id,
    replayUrl: input.replay.url,
    fromStatus: match.status,
  });
  logAuditEvent({
    actor_id: null,
    actor_name: 'System',
    action: 'match.replay_unresolved',
    resource_type: 'match',
    resource_id: match.id,
    resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
    changes: { status: { before: match.status, after: 'disputed' } },
    metadata: {
      tournament_id: match.tournament_id,
      replay_url: input.replay.url,
      submitter_id: input.submitter_id,
      reason: 'replay_engine_tie',
      ...(outcomeRecorded ? {} : { outcome_recorded: false }),
    },
  });
  throw new MatchReplayUnresolvedError();
}

/**
 * The match's round, read through the typed query (throws on a read error).
 * `best_of` decides when a match is over, so a failed or empty read must stop
 * the caller BEFORE it writes anything, never fall back to Bo1.
 */
async function requireRound(roundId: string): Promise<Round> {
  const round = await getRoundById(roundId);
  if (!round) throw new Error(`Round ${roundId} not found`);
  return round;
}

/**
 * Compensation for a game row whose battle stats or aggregate job could not be
 * written (`recordGameResult` steps 2-3): delete the row while its aggregates
 * are not counted (`deleteUncountedGameRow`; its stats and jobs cascade). The
 * unique `games.replay_hash` index stays the race guard: the row held the hash
 * until this delete, so a concurrent submission of the same battle was refused
 * meanwhile. Never throws; the caller rethrows the original error. 'counted'
 * means the job was written and applied after all, so the game is complete and
 * stays. A failed delete leaves the row: logged with the admin game delete as
 * the remedy.
 */
async function discardUnfinishedGame(gameId: string): Promise<void> {
  try {
    const outcome = await deleteUncountedGameRow(gameId);
    if (outcome === 'counted') {
      console.error(
        `[game-pipeline] game ${gameId} failed after its insert but its aggregates were applied; the game is kept`
      );
    }
  } catch (cleanupError) {
    console.error(
      `[game-pipeline] game ${gameId} failed after its insert and could not be removed; it has no stats or no ` +
        `aggregate job and keeps its replay hash until an admin deletes it (admin game delete)`,
      cleanupError
    );
  }
}

/**
 * Shared pipeline for recording a game result + stats + aggregates.
 * Used by POST /api/parse-replay, POST /api/admin/matches/[id]/replay-import
 * (both `ReplayGameInput`) and POST /api/manual-result (`EnteredGameInput`).
 *
 * Replay binding: a replay result's
 * winner and stats come from its `BoundReplay`, and the game row stores that
 * replay's hash in the same insert. A battle already bound to any game, in any
 * match, is refused with 409 `replay_already_recorded` (pre-check here, then
 * the unique index on `games.replay_hash` at the insert, race-safe); the
 * per-match URL check (`duplicate_replay`) stays in front of it.
 *
 * Evolution Point Buy progress is NOT applied here: a game's real kills are credited when its match reaches
 * `completed`, once per game (`games.evolution_applied_at`), by the finalize
 * step `epb_real_kills` (src/lib/match/finalize.ts). Aggregates stay here.
 *
 * Every write to games/battle_stats must reach the aggregates (AGENTS.md):
 * a new game enqueues an aggregate job here, which the queue applies with
 * `apply_aggregate_job` (increments + `games.aggregate_applied_at` in one
 * transaction); admin edits re-apply through the same RPC and roll back
 * through `rollback_game_aggregates` (decrements + marker clear in one
 * transaction, fenced on the marker).
 *
 * NOTE: Steps 1-3 (game + stats + job) are individually atomic but not
 * wrapped in a single DB transaction. When step 2 or 3 fails, the game row
 * written in step 1 is deleted again (`discardUnfinishedGame`, fenced on the
 * aggregate marker, cascading any stats) before the error propagates, so the
 * replay's hash is free for a retry. Only when that delete fails too does a
 * game without stats or without a job remain; it is logged, a new submission
 * of its battle answers 409 `replay_already_recorded`, and an admin removes
 * it with the admin game delete (the scope rebuild repairs a missing job).
 * Everything that can fail on a read (match, round, tournament) runs before
 * the first write. Concurrent submissions: UNIQUE (match_id, game_number)
 * turns a lost game-number race into a 409 before anything is written, and
 * both match-row status writes are compare-and-set; the move to
 * pending_confirmation writes status, winner and timer in one row update.
 * Side effects (Discord, AI, revalidate) must be triggered by the caller
 * ONLY after this function returns successfully.
 */
export async function recordGameResult(input: GamePipelineInput): Promise<GamePipelineResult> {
  const match = await getMatchById(input.match_id);
  if (!match) throw new MatchNotFoundError();

  // Validate the actor is a participant or admin
  const isParticipant =
    input.submitter_id === match.player_1_id ||
    input.submitter_id === match.player_2_id;
  if (!isParticipant && !input.is_admin) {
    throw new MatchSubmitForbiddenError();
  }

  if (match.status !== 'scheduled' && match.status !== 'in_progress') {
    throw new MatchNotOpenForGamesError(match.status);
  }

  // Round context, read once and BEFORE the first write: best_of drives the Bo
  // threshold check below. A failed read aborts here with nothing written.
  const round = await requireRound(match.round_id);

  // Winner and stats: from the bound replay for a replay result, as entered otherwise. Throws
  // (nothing written) when the replay's sides are not the two participants or it names no winner.
  let recorded: RecordedResult;
  try {
    recorded = resolveRecordedResult(input, match);
  } catch (err) {
    if (err instanceof ReplayEngineTieError && input.source === 'ps_replay') {
      await disputeUnresolvedMatch(match, input);
    }
    throw err;
  }

  assertReplayNotDuplicate(match, recorded.replay_url);
  await assertReplayHashUnused(recorded.replay_hash);

  // Get tournament context for scope IDs
  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament) throw new Error('Tournament not found');

  // Freeze the all_time test-data gate once, at creation time, so flipping
  // is_test_account / is_test_season after the match exists cannot drift the
  // all_time aggregates. The increment/rollback/rebuild paths read this value.
  const excludeAllTime = await shouldExcludeFromAllTime(tournament.season_id, [
    match.player_1_id,
    match.player_2_id,
  ]);

  // Auto-transition scheduled → in_progress on first game submission.
  // Track current status locally so the Bo threshold check below sees the
  // correct state (the `match` object is not re-fetched after this update).
  let currentStatus: MatchStatus = match.status;
  if (currentStatus === 'scheduled') {
    const transition = validateTransition('scheduled', 'in_progress', {
      actor_id: input.submitter_id,
      is_admin: input.is_admin ?? false,
      player_1_id: match.player_1_id,
      player_2_id: match.player_2_id,
    });
    if (!transition.valid) {
      throw new Error(transition.error ?? 'Cannot start match');
    }
    // Compare-and-set: a concurrent first submission may have started the
    // match already (fine), anything else means the match moved on.
    const started = await updateMatchStatus(
      input.match_id, 'in_progress', undefined, undefined, undefined, 'scheduled'
    );
    if (!started) {
      const latest = await getMatchById(input.match_id);
      if (latest?.status !== 'in_progress') throw new MatchStateConflictError();
    }
    currentStatus = 'in_progress';
  }

  // 1. Create Game record
  const gameNumber = await getNextGameNumber(input.match_id);
  const game = await createGame({
    match_id: input.match_id,
    game_number: gameNumber,
    winner_id: recorded.winner_id,
    replay_url: recorded.replay_url,
    replay_hash: recorded.replay_hash ?? null,
    source: input.source,
    parsed: true,
    exclude_all_time: excludeAllTime,
  });

  // 2. Write Battle Stats with game_id and match_won
  const statsWithGameId: BattleStatInsert[] = recorded.battle_stats.map((s) => ({
    ...s,
    game_id: game.id,
    match_won: s.player_id === recorded.winner_id,
  }));

  try {
    await createBattleStats(statsWithGameId);

    // 3. Enqueue aggregate update (processed asynchronously)
    await enqueueAggregateJob(
      game.id,
      match.tournament_id,
      tournament.season_id
    );
  } catch (error) {
    // The game row is committed but its stats or its job are not: remove it,
    // so it neither counts as a game win nor keeps the replay's hash bound
    // (a retry would answer 409 replay_already_recorded against it).
    await discardUnfinishedGame(game.id);
    throw error;
  }

  // 3b. Evolutions. EPB: nothing here; the game's real kills are credited
  // when the match is completed (finalize step `epb_real_kills`), never for a
  // result that is still pending confirmation or disputed. Do NOT run
  // checkPlayerEvolutions for EPB: it re-derives total_kos from battle_stats
  // alone and would erase token/cosmo contributions. Legacy evo-leagues keep
  // their battle_stats re-sum here.
  let evolutionEvents: EvolutionEvent[] = [];
  if (tournament.season_id && !isEvolutionPointBuy(tournament.season_format_type ?? '')) {
    const [p1Events, p2Events] = await Promise.all([
      checkPlayerEvolutions(tournament.season_id, match.player_1_id),
      checkPlayerEvolutions(tournament.season_id, match.player_2_id),
    ]);
    evolutionEvents = [...p1Events, ...p2Events];
  }

  // 4. Check Bo threshold and update match status
  const { player_1_wins, player_2_wins } = await getGameWinCounts(input.match_id);

  const boResult = hasReachedBoThreshold(round.best_of, player_1_wins, player_2_wins);

  let newStatus: string = currentStatus;
  let matchWinnerId: string | null = null;

  if (boResult.reached) {
    // Bo threshold reached → pending_confirmation
    matchWinnerId = boResult.winner_id_index === 1
      ? match.player_1_id
      : match.player_2_id;

    const targetStatus = 'pending_confirmation';
    const transition = validateTransition(
      currentStatus,
      targetStatus,
      {
        actor_id: input.submitter_id,
        is_admin: input.is_admin ?? false,
        winner_id: matchWinnerId,
        player_1_id: match.player_1_id,
        player_2_id: match.player_2_id,
      }
    );

    if (!transition.valid) {
      throw new Error(transition.error ?? `Cannot move match to ${targetStatus}`);
    }

    // Status, winner, submitter and the auto-confirm timer in ONE conditional
    // row update: no window in which the match is pending without its
    // timer, and no stale timer survives.
    const updated = await transitionMatchStatus(input.match_id, {
      expectedStatus: currentStatus,
      status: targetStatus,
      winnerId: matchWinnerId,
      submitterId: input.submitter_id,
      autoConfirmAt: getAutoConfirmAt(input.source, recorded.screenshot_url),
      confirmedAt: null,
    });
    if (updated) {
      newStatus = targetStatus;
    } else {
      // A concurrent writer moved the match first. This game is already
      // committed, so report the authoritative state instead of failing, and
      // log the lost race (as reevaluateMatchStatus does) so the extra game
      // on a decided match can be traced.
      const latest = await getMatchById(input.match_id);
      if (!latest) throw new MatchNotFoundError();
      console.error(
        `[game-pipeline] match ${input.match_id} moved from ${currentStatus} to ${latest.status} while game ` +
          `${game.id} was recorded; the game is saved, the ${targetStatus} write was not applied`
      );
      newStatus = latest.status;
      matchWinnerId = latest.winner_id;
    }
  }

  return {
    game_id: game.id,
    game_winner_id: recorded.winner_id,
    match_status: newStatus,
    match_winner_id: matchWinnerId,
    bo_reached: boResult.reached,
    evolution_events: evolutionEvents,
  };
}

// ─── Admin Pipeline: Delete / Reset / Edit ───────────────────────────

/**
 * Helper: fetch match + tournament context needed by all admin pipelines.
 */
async function getMatchContext(matchId: string) {
  const match = await getMatchById(matchId);
  if (!match) throw new MatchNotFoundError();
  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament) throw new Error('Tournament not found');
  return { match, tournament };
}

/**
 * A completed match left `completed` (reset, or a game deleted or edited): a custom league's format takes back what the
 * completion applied, and the next completion of the match counts again (`onMatchReverted`). A disputed match that is
 * reset or moved on runs the same hook: it closes the dispute's check and advances the generation. The admin change is saved
 * either way, the hook logs its own failure with the original error, and the import is lazy because only custom leagues
 * need the format engine. A replay cannot repair a failed revert: the match is no longer completed, so it computes
 * the same completion key and fires nothing, and the old winner's grants and points would stand until the format cron
 * retries it (`healPendingReverts` in `format-engine/runtime/cron.ts`: the match is not completed but its current
 * `match_completed` key is still fired). The cron does not cover a match that was completed again before its next pass,
 * or a deleted match row. So this resolves `false` and the caller reports it in the result (`format_revert_failed`,
 * catalogue warning `admin_game_format_revert_failed`); there is no retry in this call because the hook can fail after
 * its event fired, and a second call would then miss the half that failed. Resolves `true` when there was nothing to
 * revert.
 */
async function revertFormatCompletion(
  match: { id: string },
  tournament: Tournament,
  statusBefore: string,
  statusAfter: string
): Promise<boolean> {
  // A disputed match never completed, but its dispute (the unresolved replay tie) opened an `unresolved_outcome` check
  // under the current completion generation. Once the dispute is over (reset, or a game change that moved the match on),
  // that check is closed and the generation advances, so the next tie opens a new dispute instead of being deduplicated
  // against the old key (`onMatchReverted`). A match that is still disputed afterwards keeps its dispute.
  const wasCompleted = statusBefore === 'completed';
  const dispute = statusBefore === 'disputed' && statusAfter !== 'disputed';
  if (!(wasCompleted || dispute) || statusAfter === 'completed') return true;
  if (!isKitCandidate(tournament)) return true;
  try {
    const { onMatchReverted } = await import('@/lib/format-engine/runtime/hooks');
    return await onMatchReverted({ tournament, matchId: match.id });
  } catch (err) {
    logger.error('match/format-revert', 'format runtime hook failed for a match that left completed', { matchId: match.id, error: err });
    return false;
  }
}

/**
 * Cancel the game's queued aggregate jobs, THEN read the game. The marker
 * (`aggregate_applied_at`) must be read after the cancel: a queue job that
 * applied between an earlier read and the cancel would otherwise be missed,
 * its increments never rolled back, and an edit's re-apply would count the
 * game twice. `apply_aggregate_job` holds the job row lock until it commits
 * and fences on status = 'processing', so once the cancel has returned no
 * queue job can apply this game any more. A concurrent admin edit of the same
 * game can still roll it back or re-apply it; `rollback_game_aggregates`
 * fences on the marker read here, so such a race ends in a 409 with nothing
 * written ('not_applied' or 'marker_changed', see `rollbackCountedGame`)
 * instead of a double decrement. Returns null when the game is gone.
 */
async function readGameAfterJobCancel(gameId: string): Promise<Game | null> {
  await cancelAggregateJobsForGame(gameId);
  return getGameById(gameId);
}

/**
 * Another admin changed this game's counted aggregates between this request's
 * read and its rollback (a concurrent edit or delete rolled it back first, or
 * a concurrent edit re-applied it). Nothing was written by this request.
 * HTTP 409: reload the match and try again.
 */
export class GameChangedConcurrentlyError extends UserFacingError {
  constructor() {
    super(
      'This game was changed by another admin at the same moment. Nothing was changed by this request; reload the match and try again.',
      { code: 'admin_game_changed_concurrently', status: 409 },
    );
    this.name = 'GameChangedConcurrentlyError';
  }
}

/**
 * Optimistic concurrency for `editGame`: the game is no longer at the version
 * the editor loaded (`expected_updated_at`). Any write to the game after the
 * editor opened moves the version on: another admin's edit, the aggregate
 * queue counting it, or an earlier save attempt from this same editor (a save
 * claims the version first, so a failed save also moves it). Nothing was
 * written by this request. HTTP 409: reload the editor and make the change
 * again.
 */
export class GameEditStaleError extends UserFacingError {
  constructor() {
    super(
      'This game changed after you opened the editor (an edit was saved or attempted, possibly your own earlier save, or its statistics were counted). Nothing was saved; reload the page and make your change again.',
      { code: 'admin_game_edit_stale', status: 409 },
    );
    this.name = 'GameEditStaleError';
  }
}

/**
 * Edit lease for `editGame`: another edit of this game is running right now
 * (it holds the game's edit lease, `claimGameEditLease`). Nothing was written
 * by this request. HTTP 409: wait for that edit to finish, reload the editor
 * (the running edit changes the game) and make the change again. A lease left
 * behind by an edit that died expires after `GAME_EDIT_LEASE_TTL_SECONDS`.
 */
export class GameEditInProgressError extends UserFacingError {
  constructor() {
    super(
      'Another edit of this game is being saved right now. Nothing was saved; wait a moment, reload the page and make your change again.',
      { code: 'admin_game_edit_in_progress', status: 409 },
    );
    this.name = 'GameEditInProgressError';
  }
}

/**
 * `deleteGame` rolled the game's counts back, but a concurrent edit counted
 * the game again before the fenced delete ran, so the game was NOT deleted.
 * The counts match the game as it now stands (the edit's re-apply). HTTP 409.
 */
export class GameRecountedConcurrentlyError extends UserFacingError {
  constructor() {
    super(
      "Another admin's edit counted this game again at the same moment, so it was not deleted. Its statistics match the game as it now stands; reload the match and delete it again if you still want to.",
      { code: 'admin_game_delete_recounted', status: 409 },
    );
    this.name = 'GameRecountedConcurrentlyError';
  }
}

/**
 * `resetMatch` stopped in its game step: at least one game's rollback lost a
 * race (a concurrent edit or delete of that game) AFTER sibling games were
 * already rolled back and deleted. The match fields were NOT reset; the
 * statistics stay consistent with the games that remain, and resetting the
 * match again finishes the job. HTTP 409. `count` = games already removed.
 */
export class MatchResetPartialError extends UserFacingError {
  constructor(removed: number, readonly causes: unknown[]) {
    super(
      `The reset stopped because another admin changed one of this match's games at the same moment. ${removed} game(s) were already removed (their statistics rolled back); the match itself was not reset. Reload the match and reset it again.`,
      { code: 'admin_match_reset_partial', params: { count: removed }, status: 409 },
    );
    this.name = 'MatchResetPartialError';
  }
}

/** The game row is gone (deleted, possibly by a concurrent request). HTTP 404. */
export class GameNotFoundError extends UserFacingError {
  constructor() {
    super('Game not found', { code: 'game_not_found', status: 404 });
    this.name = 'GameNotFoundError';
  }
}

/** `resetMatch` on a match that is already scheduled (nothing to reset). HTTP 409. */
export class MatchAlreadyScheduledError extends UserFacingError {
  constructor() {
    super('Match is already in scheduled state', { code: 'match_already_scheduled', status: 409 });
    this.name = 'MatchAlreadyScheduledError';
  }
}

/** What `rollbackCountedGame` did. */
type CountedGameRollback = 'rolled_back' | 'not_counted' | 'game_missing';

/**
 * Subtract a game's counted aggregates, if it is counted, in ONE transaction
 * with the marker clear (`rollback_game_aggregates`, fenced on the marker read
 * in `game`). The deltas come from `stats`, read after `game`: every path that
 * changes a game's stats clears the marker first, so a marker that still
 * matches proves the stats are the counted ones.
 *
 *   - Marker NULL in `game` (never counted, or a sequential retry after an
 *     earlier rollback committed): 'not_counted', no RPC.
 *   - 'rolled_back': this call subtracted the game and cleared the marker.
 *   - The RPC answers 'not_applied' (the marker was set when `game` was read
 *     and is NULL now) or 'marker_changed' (it was re-set since): a concurrent
 *     edit or delete of the same game won the race. This call wrote nothing,
 *     and continuing would write stats or deltas based on a stale read, so it
 *     throws `GameChangedConcurrentlyError` (409) and the caller stops.
 *   - 'game_missing': the row is gone (a concurrent delete); the caller
 *     decides (a delete is done, an edit answers 404).
 */
async function rollbackCountedGame(
  game: Game,
  stats: BattleStat[],
  tournamentId: string,
  seasonId: string | null
): Promise<CountedGameRollback> {
  if (!game.aggregate_applied_at) return 'not_counted';
  // The frozen, creation-time all_time decision, so flipping test flags after
  // the match exists cannot change what gets rolled back from all_time.
  const deltas = buildGameAggregateDeltas(stats, tournamentId, seasonId, {
    excludeAllTime: game.exclude_all_time,
  });
  const outcome = await rollbackGameAggregates(game.id, game.aggregate_applied_at, deltas);
  switch (outcome) {
    case 'rolled_back':
      return 'rolled_back';
    case 'game_missing':
      return 'game_missing';
    case 'not_applied':
    case 'marker_changed':
      throw new GameChangedConcurrentlyError();
  }
}

/**
 * Helper: rollback aggregates and delete data for a single game.
 * Does NOT update match status (caller handles that).
 *
 * The rollback and the marker clear commit together, so a delete that fails
 * afterwards and is retried finds the marker NULL and does not roll the game
 * back a second time. A concurrent delete or edit that rolled the game back
 * first makes this call answer `GameChangedConcurrentlyError` (409, nothing
 * written by it).
 *
 * The delete itself is ONE statement fenced on the marker being NULL
 * (`deleteUncountedGameRow`; the stats go with the row by cascade). A
 * concurrent admin edit that re-applied the game after this rollback (or
 * after an uncounted read) leaves the marker set, so the delete removes
 * nothing and answers `GameRecountedConcurrentlyError` (409) instead of
 * deleting a game whose counts stay.
 *
 * From the job cancel on the game may be uncounted (rolled back here, or its
 * pending job cancelled) with nothing left to count it. When a later step of
 * this helper fails, the game is re-queued (`requeueAfterFailedChange`) so
 * the queue counts it again if it still exists, and the original error is
 * rethrown, as `editGame` does.
 */
async function rollbackAndDeleteGame(
  gameId: string,
  tournamentId: string,
  seasonId: string | null
): Promise<BattleStat[]> {
  // Cancel any pending aggregate jobs for this game to prevent double-counting
  // if the game is edited before its job is processed, then read the marker.
  const game = await readGameAfterJobCancel(gameId);
  if (!game) return [];

  let stats: BattleStat[];
  let outcome: Awaited<ReturnType<typeof deleteUncountedGameRow>>;
  try {
    stats = await getBattleStatsByGame(gameId);
    if ((await rollbackCountedGame(game, stats, tournamentId, seasonId)) === 'game_missing') {
      return []; // deleted concurrently: the requested end state, nothing left to count
    }
    outcome = await deleteUncountedGameRow(gameId);
  } catch (err) {
    // A lost race (409) wrote nothing: the winner owns the count.
    if (!(err instanceof GameChangedConcurrentlyError)) {
      const uncounted = await requeueAfterFailedChange('delete', gameId, tournamentId, seasonId, err);
      if (uncounted) throw uncounted;
    }
    throw err;
  }
  if (outcome === 'counted') throw new GameRecountedConcurrentlyError();
  return stats;
}

interface EvolutionRecheckResult {
  events: EvolutionEvent[];
  /**
   * True when the EPB recheck failed after the game change was committed. The
   * failure is logged with its cause and reported in the admin result
   * (`evolution_recheck_failed`, catalogue code
   * `admin_game_evolution_recheck_failed`); the season reconcile repairs the
   * evolution state.
   */
  failed: boolean;
}

/**
 * Helper: re-check evolutions for both players in a LEGACY evo-league
 * (checkPlayerEvolutions, battle_stats re-sum). Evolution Point Buy seasons
 * never come here: delete and reset rebuild the season
 * (`repairSeasonEvolution`), an edit goes through `recheckEpbAfterEdit`.
 */
export async function recheckEvolutions(
  seasonId: string | null,
  player1Id: string,
  player2Id: string
): Promise<EvolutionRecheckResult> {
  if (!seasonId) return { events: [], failed: false };

  const [p1, p2] = await Promise.all([
    checkPlayerEvolutions(seasonId, player1Id),
    checkPlayerEvolutions(seasonId, player2Id),
  ]);
  return { events: [...p1, ...p2], failed: false };
}

/**
 * EPB evolution after an admin game edit (`editGame` step 7). Real kills are
 * credited per game only while its match is completed
 * (`games.evolution_applied_at`), and an edit moves a completed match out of
 * `completed` (`reevaluateMatchStatus`, step 6), so:
 *   1. a credited game (marker set in `game`, the read made before the edit's
 *      writes) is debited by its credit ledger (`games.evolution_credits`;
 *      the old stats only for a legacy marker without a ledger), fenced on
 *      that marker
 *      (`uncreditGameRealKills`); this includes a game of a still-pending
 *      match credited at submission before 2026-10-20;
 *   2. AFTER the debit the match status is re-read, and when the match is
 *      completed the edited stats are credited (`creditMatchRealKills`,
 *      idempotent per marker; the SQL re-checks `completed` in its own
 *      transaction). The re-read closes the edit-vs-confirm race: a confirm that
 *      lands after step 6 but before the debit finds the marker still set
 *      (its finalize credit answers 'already_applied'), the debit then clears
 *      it, and without this credit the completed match would silently lose
 *      the game's kills. A confirm that lands after the re-read finds the
 *      marker NULL, so its finalize (or the heal cron, which only handles
 *      completed matches) credits the stats then in the database;
 *   3. stages are re-resolved for both players (covers devolutions).
 * Why the debit is not moved before step 6 instead: it would run while a
 * completed match is still completed, so a failure of step 6 would leave a
 * completed, finalized match with the game debited and nobody left to credit
 * it (no confirm, and the heal cron skips finalized matches).
 *
 * 'already_applied' on that credit means a concurrent finalize credited the
 * game after the debit. That is the edited stats, unless the finalize may
 * have read the stats before the edit wrote them: a confirm that beat step 6
 * (`statusConflict`), or a finalize of the completed match already in flight
 * when the edit read a NULL marker (`wasCompleted` without a debit). Those are
 * reported, as is a game gone meanwhile. 'match_not_completed' (the match left
 * `completed` again after the re-read) is not: the next completion credits it.
 *
 * The game change is already committed when this runs, so a failure does not
 * turn the admin request into an error that reads as "nothing saved": it is
 * logged with its cause and returned as `failed: true`, which the result
 * carries to the admin (`evolution_recheck_failed`; the season reconcile
 * repairs it). A lost marker race ('marker_changed') is reported the same
 * way: what was counted can then only be rebuilt.
 */
async function recheckEpbAfterEdit(input: {
  seasonId: string;
  matchId: string;
  matchday: number;
  playerIds: readonly [string, string];
  game: Game;
  oldStats: BattleStat[];
  newStats: BattleStat[];
  /** The match was completed when the edit read it (before any write). */
  wasCompleted: boolean;
  /** Step 6 lost its compare-and-set (a concurrent writer moved the match first). */
  statusConflict: boolean;
}): Promise<EvolutionRecheckResult> {
  const { seasonId, game } = input;
  const events: EvolutionEvent[] = [];
  let failed = false;
  try {
    const debit = await uncreditGameRealKills(seasonId, game, input.oldStats);
    if (debit === 'marker_changed' || debit === 'game_missing') {
      console.error(
        `[game-pipeline] EPB real kills of game ${game.id} were not debited after its edit (${debit}); ` +
          'reported to the admin as evolution_recheck_failed (season reconcile repairs it)'
      );
      failed = true;
    } else {
      // The marker is NULL now. Re-read the status AFTER the debit: a confirm
      // that landed before it saw the old marker and credited nothing.
      const latest = await getMatchById(input.matchId);
      if (latest?.status === 'completed') {
        const credit = await creditMatchRealKills({
          seasonId,
          matchday: input.matchday,
          playerIds: input.playerIds,
          gameIds: [game.id],
          statsByGame: { [game.id]: input.newStats },
        });
        events.push(...credit.events);
        const concurrentCreditHoldsEditedStats =
          !input.statusConflict && (debit === 'rolled_back' || !input.wasCompleted);
        // 'match_not_completed': the match left `completed` again after the
        // re-read; the marker is NULL, so its next completion credits the game.
        const settled =
          credit.applied.length > 0 ||
          credit.notCompleted.length > 0 ||
          (credit.alreadyApplied.length > 0 && concurrentCreditHoldsEditedStats);
        if (!settled) {
          console.error(
            `[game-pipeline] EPB real kills of game ${game.id} could not be credited with the edited stats ` +
              `(already: ${credit.alreadyApplied.length}, not completed: ${credit.notCompleted.length}, ` +
              `missing: ${credit.missing.length}); reported as evolution_recheck_failed (season reconcile repairs it)`
          );
          failed = true;
        }
      }
    }

    // Re-resolve stages (covers devolutions after the debit).
    events.push(...await recheckEpbStages(seasonId, [...input.playerIds]));
    return { events, failed };
  } catch (err) {
    console.error(
      `[game-pipeline] EPB evolution recheck failed for season ${seasonId} after the game change was saved; ` +
        'reported to the admin as evolution_recheck_failed (season reconcile repairs it)',
      err
    );
    return { events, failed: true };
  }
}

/**
 * Helper: given match state after games changed, determine the correct
 * match status and update it. Returns new status + winner.
 *
 * `bestOf` and `previousStatus` come from reads the caller made BEFORE its
 * game mutations (a failed round read must not fall back to Bo1). The
 * status write is compare-and-set on `previousStatus` and carries the timer
 * in the same row update: back to in_progress clears any auto-confirm
 * timer; entering pending_confirmation from another state starts without one
 * (admin review), staying in pending_confirmation keeps the stored timer.
 *
 * When the compare-and-set misses (a concurrent confirm, dispute or other
 * write moved the match after the caller read it), the caller's game change is
 * ALREADY committed and the concurrent writer's status is kept: overwriting
 * it could undo a completion without rolling its finalize back. The result
 * then carries the match's current status and `statusConflict: true`, so the
 * caller finishes its remaining steps and reports the partial state. Every
 * branch writes by compare-and-set, the reset to `scheduled` included.
 *
 * A match that leaves `completed` or `disputed` takes its outcome row with it (an admin forfeit, a played row with its
 * faints, the dispute's `unresolved` row): none of them describes the match any more, and a stale admin row would be
 * kept by the heal over the next completion's played result. The row is read before the status write and deleted by its
 * `set_at` after it (`readOutcomeMark`), so a row an admin staged since survives; a failed delete is logged and does not
 * undo the saved game change.
 */
async function reevaluateMatchStatus(
  matchId: string,
  bestOf: number,
  previousStatus: MatchStatus,
  player1Id: string,
  player2Id: string,
  adminId: string
): Promise<{ status: string; winnerId: string | null; statusConflict: boolean }> {
  const { player_1_wins, player_2_wins } = await getGameWinCounts(matchId);
  const totalGames = player_1_wins + player_2_wins;

  // A match without games keeps no outcome row whatever its status was; a decided one never keeps its row.
  const outcomeMark =
    totalGames === 0 || previousStatus === 'completed' || previousStatus === 'disputed'
      ? await readOutcomeMark(matchId)
      : null;

  if (totalGames === 0) {
    // No games left → reset to scheduled
    const reset = await resetMatchFields(matchId, previousStatus);
    if (!reset) return currentMatchStatusAfterConflict(matchId, previousStatus);
    await takeBackMarkedOutcome(matchId, outcomeMark);
    return { status: 'scheduled', winnerId: null, statusConflict: false };
  }

  const boResult = hasReachedBoThreshold(bestOf, player_1_wins, player_2_wins);

  if (boResult.reached) {
    const winnerId = boResult.winner_id_index === 1 ? player1Id : player2Id;
    const updated = await transitionMatchStatus(matchId, {
      expectedStatus: previousStatus,
      status: 'pending_confirmation',
      winnerId,
      submitterId: adminId,
      autoConfirmAt: previousStatus === 'pending_confirmation' ? undefined : null,
    });
    if (!updated) return currentMatchStatusAfterConflict(matchId, previousStatus);
    await takeBackMarkedOutcome(matchId, outcomeMark);
    return { status: 'pending_confirmation', winnerId, statusConflict: false };
  }

  // Games exist but Bo not reached → in_progress
  const updated = await transitionMatchStatus(matchId, {
    expectedStatus: previousStatus,
    status: 'in_progress',
    winnerId: null,
    submitterId: adminId,
    autoConfirmAt: null,
  });
  if (!updated) return currentMatchStatusAfterConflict(matchId, previousStatus);
  await takeBackMarkedOutcome(matchId, outcomeMark);
  return { status: 'in_progress', winnerId: null, statusConflict: false };
}

/** The status a concurrent writer left (reevaluateMatchStatus lost its compare-and-set). */
async function currentMatchStatusAfterConflict(
  matchId: string,
  expectedStatus: MatchStatus
): Promise<{ status: string; winnerId: string | null; statusConflict: true }> {
  const latest = await getMatchById(matchId);
  if (!latest) throw new Error(`Match ${matchId} not found after its status write missed`);
  console.error(
    `[game-pipeline] match ${matchId} moved from ${expectedStatus} to ${latest.status} during an admin game change; ` +
      'the game change is saved, the match status was not re-evaluated'
  );
  return { status: latest.status, winnerId: latest.winner_id, statusConflict: true };
}

/**
 * Rating preflight for an admin game change on a COMPLETED match (read-only):
 * the change may move the match out of `completed`, and the rating rebuild
 * that then follows (`rebuildGamificationAfterUncomplete`) runs after the game
 * write. Planning it first refuses a history-gap cycle no rebuild order can
 * fill (`RatingHistoryIntegrityError`, 409) with nothing written, as
 * `resetMatch` does.
 */
export async function preflightUncompleteRebuild(match: {
  id: string;
  status: MatchStatus;
  player_1_id: string;
  player_2_id: string;
}): Promise<void> {
  if (match.status !== 'completed') return;
  await planRatingRebuild([match.player_1_id, match.player_2_id], { excludeMatchIds: [match.id] });
}

/** Options of an admin game edit or delete. */
export interface GameChangeOptions {
  /**
   * The admin approved resetting the played later bracket matches the change affects (the request carried the confirm
   * flag). Without it such a change is refused with nothing written (`GameChangeDownstreamPlayedError`).
   */
  confirmDownstream?: readonly string[];
  /**
   * Called with the id of each later match right after its reset committed, so a caller can audit the cascade even when
   * a later step of the change fails.
   */
  onDownstreamMatchReset?: (matchId: string) => void;
}

/** What `preflightGameChange` found for a game change of a completed match (empty for any other match). */
interface GameChangePlan {
  /** The participants `dropCompletedResultEffects` needs. */
  participants: ParticipantWithSeed[];
  /** The played later bracket matches the approved change resets, deepest first. */
  downstream: MatchWithPlayers[];
}

/** The later matches as the refusal and the approval prompt name them: round, both players, status. */
async function summarizeDownstream(
  tournamentId: string,
  matches: readonly MatchWithPlayers[]
): Promise<DownstreamMatchSummary[]> {
  const rounds = await getRoundsByTournament(tournamentId);
  const roundNameById = new Map(rounds.map((round) => [round.id, round.name]));
  return matches.map((child) => ({
    id: child.id,
    round_name: roundNameById.get(child.round_id) ?? '',
    player_1_name: child.player_1_name,
    player_2_name: child.player_2_name,
    status: child.status,
  }));
}

/**
 * Everything checked BEFORE an admin game change writes, on a match that may be completed (read-only): the rating
 * preflight and, for a bracket match, which later bracket matches its winner advanced into were played. A game change of
 * a completed match always takes it off `completed` (back to `pending_confirmation` or `in_progress`, or `scheduled`
 * without games), exactly like a reopen, and so orphans that played bracket path. The change is therefore refused with
 * nothing written (409 `game_change_downstream_played`, listing those matches) until the admin approves resetting them
 * (`confirmDownstream`); an approved change resets them as a cascading `resetMatch` does (`resetPlayedDownstream`).
 *
 * The rating plan is the one `resetMatch` makes for a cascade: the players of this match and of every later match the
 * approved change resets, with all those matches left out. It runs before the refusal, so an admin is never asked to
 * approve a cascade whose rating history no rebuild order can fill (`RatingHistoryIntegrityError`, 409).
 *
 * Read-only on purpose, so `editGame` runs it BEFORE it claims the game's edit lease: the claim moves the game's
 * `updated_at`, and a refused edit that had claimed it would make the editor's resend with the confirm flag stale.
 */
async function preflightGameChange(
  match: MatchWithPlayers,
  tournament: Tournament,
  confirmDownstream: readonly string[] | undefined
): Promise<GameChangePlan> {
  if (match.status !== 'completed') return { participants: [], downstream: [] };
  const participants = await getParticipants(match.tournament_id);
  const downstream = await collectPlayedDownstreamMatches(match, tournament, participants);
  if (downstream.length === 0) {
    await preflightUncompleteRebuild(match);
    return { participants, downstream };
  }
  const resetMatches = [match, ...downstream];
  await planRatingRebuild(
    [...new Set(resetMatches.flatMap((m) => [m.player_1_id, m.player_2_id]))],
    { excludeMatchIds: resetMatches.map((m) => m.id) }
  );
  // The approval covers the matches the admin was shown: one played since is not reset unseen, the admin is asked again.
  const approved = new Set(confirmDownstream);
  if (downstream.some((m) => !approved.has(m.id))) {
    throw new GameChangeDownstreamPlayedError(await summarizeDownstream(match.tournament_id, downstream));
  }
  return { participants, downstream };
}

/**
 * The refusals of an admin game edit that need only the match: a winner who is not one of its two players, and battle stats of
 * a player who is not. They come BEFORE the preflight, the lease and every write, because the later steps cannot be taken
 * back: an approved cascade resets the later bracket matches first, and a winner or stats row that names an unknown player
 * would fail on its foreign key only after that and after the game's aggregates were rolled back. The winner is checked only
 * when it changes (a resend of the stored winner writes nothing); the stats are replaced as a whole, so each row is checked.
 */
function assertEditNamesMatchPlayers(input: EditGameInput, game: Game, match: MatchWithPlayers): void {
  const players = new Set([match.player_1_id, match.player_2_id]);
  if (input.winner_id && input.winner_id !== game.winner_id && !players.has(input.winner_id)) {
    throw new UserFacingError('Winner must be one of the match participants', { code: 'match_winner_not_participant', status: 400 });
  }
  if (input.battle_stats?.some((stat) => !players.has(stat.player_id))) {
    throw new UserFacingError('Battle stats must belong to the two players of the match', {
      code: 'admin_game_stats_player_not_participant',
      status: 400,
    });
  }
}

/** What `resetPlayedDownstream` reset, and what its resets reported. */
interface DownstreamReset {
  matchIds: string[];
  formatRevertFailed: boolean;
  evolutionRecheckFailed: boolean;
  stageEnded: StageEndedWarning | null;
}

/**
 * Reset the played later bracket matches of `collectPlayedDownstreamMatches`, in its order (deepest first, so children go
 * before parents), each as a cascading `resetMatch` does: the shared step of a cascading reset and of an approved game
 * change. A match another request reset meanwhile is skipped. Stops at the first failure; the matches reset before it
 * stay reset and were reported through `onReset`.
 */
async function resetPlayedDownstream(
  playedDownstream: readonly MatchWithPlayers[],
  adminId: string,
  onReset?: (matchId: string) => void
): Promise<DownstreamReset> {
  const outcome: DownstreamReset = {
    matchIds: [],
    formatRevertFailed: false,
    evolutionRecheckFailed: false,
    stageEnded: null,
  };
  for (const child of playedDownstream) {
    const latest = await getMatchById(child.id);
    if (!latest || latest.status === 'scheduled') continue;
    try {
      const reset = await resetMatch(child.id, adminId, true);
      outcome.matchIds.push(child.id);
      onReset?.(child.id);
      if (reset.format_revert_failed) outcome.formatRevertFailed = true;
      if (reset.evolution_recheck_failed) outcome.evolutionRecheckFailed = true;
      outcome.stageEnded ??= reset.stage_already_ended ?? null;
    } catch (err) {
      // Reset by a concurrent request between the read above and this call.
      if (err instanceof MatchAlreadyScheduledError) continue;
      throw err;
    }
  }
  return outcome;
}

/**
 * The approved part of an admin game change: reset the played later bracket matches (`resetPlayedDownstream`), then make
 * sure the changed match is still the one the preflight read. The resets can take seconds, and a result that landed
 * meanwhile must answer 409 with the game intact (the compare-and-set of the status write still decides).
 */
async function resetDownstreamForGameChange(
  match: MatchWithPlayers,
  plan: GameChangePlan,
  adminId: string,
  options: GameChangeOptions
): Promise<DownstreamReset | null> {
  if (plan.downstream.length === 0) return null;
  const reset = await resetPlayedDownstream(plan.downstream, adminId, options.onDownstreamMatchReset);
  const latest = await getMatchById(match.id);
  if (latest && latest.status !== match.status) throw new MatchStateChangedError(latest.status);
  return reset;
}

/** The result fields the approved cascade of a game change adds to `DeleteGameResult` / `EditGameResult`. */
function downstreamResetFields(reset: DownstreamReset | null): {
  downstream_reset_match_ids?: string[];
  format_revert_failed?: true;
  evolution_recheck_failed?: true;
} {
  if (reset === null || reset.matchIds.length === 0) return {};
  return {
    downstream_reset_match_ids: reset.matchIds,
    ...(reset.formatRevertFailed ? { format_revert_failed: true as const } : {}),
    ...(reset.evolutionRecheckFailed ? { evolution_recheck_failed: true as const } : {}),
  };
}

/**
 * What a COMPLETED match's result left behind outside ratings, once an admin game change took the match off `completed`
 * (`reopenMatch` and `resetMatch` do the same): the bracket slots its winner (and, in a double elimination, its loser)
 * advanced into are taken back, and the analyses, EPB snapshots and social image of the old result are dropped, as a
 * re-confirmation builds them fresh (the analysis route serves a stored completed analysis, the heal skips the EPB hooks
 * while snapshots exist). The round revert is the caller's (`revertRoundIfCompleted`). Errors propagate: the game change
 * is saved, and the route reports the failure.
 */
async function dropCompletedResultEffects(
  match: MatchWithPlayers,
  tournament: Tournament,
  participants: ParticipantWithSeed[]
): Promise<void> {
  await unpropagateBracketOnMatchReset(match, tournament, participants);
  await Promise.all([deleteMatchAnalysis(match.id), deleteMatchPrepAnalysesByMatch(match.id)]);
  await deleteMatchSnapshots(match.id);
  await clearMatchSocialImage(match.id);
}

/**
 * Gamification after an admin game change moved a COMPLETED match out of
 * `completed` (`deleteGame`, `editGame`): ratings, rating history, streaks and
 * signatures only count completed matches, so both players are rebuilt from
 * their remaining completed matches, as `resetMatch` does (step 5). The rating
 * rebuild replays chronologically, so it is right for any match, not just the
 * last one, and it drops the match's `rating_history` rows; a later
 * confirmation then rates the match afresh. Achievements are permanent and not
 * revoked. Returns every player whose rating curve was rebuilt (the batch may
 * add players to heal history gaps); `[]` when the match was not completed
 * before or still is. Errors propagate: the game change is saved, and the
 * route reports the failure instead of a success with stale ratings.
 */
export async function rebuildGamificationAfterUncomplete(
  wasCompleted: boolean,
  statusAfter: string,
  player1Id: string,
  player2Id: string
): Promise<string[]> {
  if (!wasCompleted || statusAfter === 'completed') return [];
  const ratingResults = await rebuildRatingsForPlayers([player1Id, player2Id]);
  await Promise.all([recomputeStreaks(player1Id), recomputeStreaks(player2Id)]);
  await Promise.all([updateSignatures(player1Id), updateSignatures(player2Id)]);
  return ratingResults.map((result) => result.playerId);
}

/**
 * Helper: reopen a completed round to 'active' (roundMachine `revert`): one of its matches is open again, and players see
 * Submit only in an active round (a 'pending' round hides it). A fresh read
 * at revert time (the games are already gone); a failed read throws instead of
 * silently skipping the revert.
 */
export async function revertRoundIfCompleted(roundId: string): Promise<void> {
  const round = await requireRound(roundId);
  if (round.status !== 'completed') return;
  roundMachine.assertTransition('completed', 'active', 'system');
  try {
    await updateRoundStatus(roundId, 'active', 'completed');
  } catch (err) {
    // Another writer moved the round since the read (an admin reset or reopened it): its status stands.
    if (!(err instanceof UserFacingError) || err.code !== 'round_status_changed') throw err;
  }
}

/**
 * Delete a single game from a match.
 * Rolls back aggregates, deletes stats/game, re-evaluates match state.
 *
 * Children are match-level, not game-level, so this does NOT call
 * `cleanMatchChildren` — a single-game delete leaves the match (and its prep
 * teams / proposals / moments / etc.) intact; only a full reset clears those.
 */
export async function deleteGame(
  gameId: string,
  adminId: string,
  options: GameChangeOptions = {}
): Promise<DeleteGameResult> {
  const game = await getGameById(gameId);
  if (!game) throw new GameNotFoundError();

  const { match, tournament } = await getMatchContext(game.match_id);
  // Read before any mutation: a failed read aborts with nothing deleted.
  const round = await requireRound(match.round_id);
  const wasCompleted = match.status === 'completed';
  const plan = await preflightGameChange(match, tournament, options.confirmDownstream);
  const { participants } = plan;

  // 0. An approved change first resets the played later bracket matches, deepest first, as a cascading reset does.
  const downstreamReset = await resetDownstreamForGameChange(match, plan, adminId, options);

  // 1. Rollback aggregates + delete data (aggregates first for safety)
  await rollbackAndDeleteGame(gameId, match.tournament_id, tournament.season_id);

  // 2. Re-evaluate match status
  const { status, statusConflict } = await reevaluateMatchStatus(
    match.id, round.best_of, match.status,
    match.player_1_id, match.player_2_id, adminId
  );

  // 3. Revert round if needed
  await revertRoundIfCompleted(match.round_id);

  // 3a. A completed match that is no longer completed: take back its bracket slots and result-derived artifacts.
  if (wasCompleted && status !== 'completed') {
    await dropCompletedResultEffects(match, tournament, participants);
  }

  // 3b. A completed match that is no longer completed: rebuild ratings,
  //     streaks and signatures so they stop counting it.
  const rebuiltRatingPlayerIds = await rebuildGamificationAfterUncomplete(
    wasCompleted, status, match.player_1_id, match.player_2_id
  );
  const formatReverted = await revertFormatCompletion(match, tournament, match.status, status);

  // 4. Re-check evolutions.
  // EPB: rebuild the whole season chronologically via repairSeasonEvolution.
  // The deleted game's battle_stats are already gone (rollbackAndDeleteGame),
  // and repairSeasonEvolution recomputes from remaining matches' battle_stats,
  // so the deleted game is naturally excluded. Capture the full RepairResult so
  // the itemized recalculation summary (spec §24) can surface tracker/event/
  // Evolution Point counts alongside the impossible lineups.
  // Legacy: keep the inverse checkPlayerEvolutions path.
  let evolutionEvents: EvolutionEvent[] = [];
  let evolutionRecheckFailed = false;
  let impossibleLineups: ImpossibleLineup[] | undefined;
  let evolutionRepaired: MatchRecalculationSummary['evolutionRepaired'] = undefined;
  if (
    tournament.season_id &&
    isEvolutionPointBuy(tournament.season_format_type ?? '')
  ) {
    const repair = await repairSeasonEvolution(tournament.season_id);
    impossibleLineups = repair.impossibleLineups;
    evolutionRepaired = {
      trackersUpdated: repair.trackersUpdated,
      eventsRewritten: repair.eventsRewritten,
      evolutionPoints: repair.evolutionPoints.points_awarded,
      impossibleLineups: repair.impossibleLineups,
    };
    // EPB carries progression detail in the repair result, not in events.
  } else {
    const recheck = await recheckEvolutions(tournament.season_id, match.player_1_id, match.player_2_id);
    evolutionEvents = recheck.events;
    evolutionRecheckFailed = recheck.failed;
  }

  // Count remaining games
  const remaining = await getGamesByMatch(match.id);

  // Unified impossible-lineups array for easy UI access (EPB repair, or empty
  // for legacy seasons where no whole-season rebuild runs).
  const summaryImpossibleLineups = impossibleLineups ?? [];

  // The stage of an ended format phase is not reopened: the admin is told who advanced on the strength of the old result.
  const stageEnded =
    (await loadStageEndedWarning(tournament, wasCompleted && status !== 'completed')) ??
    downstreamReset?.stageEnded ??
    null;

  return {
    match_status: status,
    ...(statusConflict ? { match_status_conflict: true } : {}),
    games_remaining: remaining.length,
    evolution_events: evolutionEvents,
    ...downstreamResetFields(downstreamReset),
    ...(evolutionRecheckFailed ? { evolution_recheck_failed: true } : {}),
    ...(formatReverted ? {} : { format_revert_failed: true }),
    ...(stageEnded ? { stage_already_ended: stageEnded } : {}),
    impossibleLineups,
    recalculation: {
      gamesDeleted: 1,
      ...(rebuiltRatingPlayerIds.length > 0
        ? { ratingsRebuilt: { players: rebuiltRatingPlayerIds } }
        : {}),
      evolutionRepaired,
      impossibleLineups: summaryImpossibleLineups,
    },
  };
}

function isPlayedBracketMatch(match: {
  status: string;
  games?: { length: number };
}): boolean {
  return match.status !== 'scheduled' || (match.games?.length ?? 0) > 0;
}

/**
 * Structure-generated elim matches whose results sit downstream of `match`.
 * Legacy rows (null `bracket_pos`) and non-elim formats return [] — no cascade.
 * Results are deepest-first so a cascade can reset children before parents.
 */
export async function collectPlayedDownstreamMatches(
  match: MatchWithPlayers,
  tournament: { id: string; bracket_type: string },
  participants: ParticipantWithSeed[]
): Promise<MatchWithPlayers[]> {
  if (match.bracket_pos == null) return [];
  if (
    tournament.bracket_type !== 'single_elim' &&
    tournament.bracket_type !== 'double_elim'
  ) {
    return [];
  }

  // Both optional slots stay in whatever the settings say now: a reset or third-place match played while the
  // setting was on is still downstream of its feeders. A slot without a match adds nothing.
  const structure = buildBracketStructureForParticipants(tournament.bracket_type, participants, {
    bracketResetEnabled: true,
    thirdPlaceEnabled: true,
  });
  if (!structure) return [];

  const rounds = await getRoundsByTournament(tournament.id);
  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  const roundIdByGlobalNumber = new Map(rounds.map((r) => [r.round_number, r.id]));

  const roundNumber = roundNumberById.get(match.round_id);
  if (roundNumber === undefined) return [];

  const originSlot = findSlotForMatch(
    structure.slots,
    roundNumber,
    match.bracket_side,
    match.bracket_pos
  );
  if (!originSlot) return [];

  const downstreamKeys = findDownstreamSlotKeys(structure, originSlot.slotKey);
  if (downstreamKeys.size === 0) return [];

  const depthByKey = new Map<string, number>();
  const queue: { key: string; depth: number }[] = [{ key: originSlot.slotKey, depth: 0 }];
  const seen = new Set<string>([originSlot.slotKey]);
  while (queue.length > 0) {
    const { key, depth } = queue.shift()!;
    for (const slot of structure.slots) {
      const feeds =
        slot.feeder1.slotKey === key || slot.feeder2.slotKey === key;
      if (feeds && !seen.has(slot.slotKey)) {
        seen.add(slot.slotKey);
        depthByKey.set(slot.slotKey, depth + 1);
        queue.push({ key: slot.slotKey, depth: depth + 1 });
      }
    }
  }

  const matches = await getMatchesByTournament(tournament.id);
  const played: { match: MatchWithPlayers; depth: number }[] = [];
  const seenMatchIds = new Set<string>();

  for (const slotKey of downstreamKeys) {
    const slot = structure.slots.find((s) => s.slotKey === slotKey);
    if (!slot) continue;
    const downstreamMatch = findMatchForSlot(matches, roundIdByGlobalNumber, slot);
    if (!downstreamMatch || downstreamMatch.id === match.id) continue;
    if (seenMatchIds.has(downstreamMatch.id)) continue;

    const games = await getGamesByMatch(downstreamMatch.id);
    if (!isPlayedBracketMatch({ status: downstreamMatch.status, games })) continue;

    seenMatchIds.add(downstreamMatch.id);
    played.push({
      match: downstreamMatch,
      depth: depthByKey.get(slotKey) ?? 0,
    });
  }

  played.sort((a, b) => b.depth - a.depth);
  return played.map((entry) => entry.match);
}

/**
 * Reset a match to scheduled: deletes all games/stats, rolls back aggregates,
 * cleans orphaned match-derived children, and rebuilds rating/streak/evolution
 * state so the season reads as if the match had never been finalized.
 *
 * Step order is load-bearing (spec §18):
 *   1. delete games/stats (aggregates rolled back per game)
 *   2. cleanMatchChildren — delete/null orphaned match children
 *   3. resetMatchFields — MOVED EARLIER so every rebuild below excludes this
 *      match via its status='completed' filter (ratings, streaks, evolution)
 *   4. delete AI analyses + EPB snapshots
 *   5. (if wasCompleted) rebuild ratings for both players + recompute streaks
 *      + refresh signatures. rebuildRatingsForPlayers replays each player's
 *      completed matches chronologically, so the curve is correct after any
 *      match is removed, not just the last one (undoing one match's
 *      rating_before would only be right for the last one).
 *   6. evolution: EPB → repairSeasonEvolution (whole-season chronological
 *      rebuild; captures impossible lineups). Legacy → recheckEvolutions
 *      (inverse checkPlayerEvolutions). Never both.
 *   7. revert round if completed; check downstream bracket matches
 */
export async function resetMatch(
  matchId: string,
  adminId: string,
  cascade = false
): Promise<ResetMatchResult> {
  const { match, tournament } = await getMatchContext(matchId);

  if (match.status === 'scheduled') {
    throw new MatchAlreadyScheduledError();
  }

  // Capture completed-ness and identity BEFORE any state change. The
  // ratings/streak/signature rebuilds only run for matches that WERE completed
  // (gamification effects only apply on a completed match). Downstream checks
  // must also use this snapshot — resetMatchFields clears winner_id.
  const wasCompleted = match.status === 'completed';
  const downstreamSnapshot = {
    tournament_id: match.tournament_id,
    winner_id: match.winner_id,
    round_id: match.round_id,
  };

  const participants = await getParticipants(match.tournament_id);
  const playedDownstream = await collectPlayedDownstreamMatches(
    match,
    tournament,
    participants
  );
  if (playedDownstream.length > 0 && !cascade) {
    throw new UserFacingError(
      `${playedDownstream.length} downstream match(es) have results or are in progress. Pass cascade: true to reset the whole chain.`,
      { code: 'DOWNSTREAM_PLAYED', params: { count: playedDownstream.length }, status: 409 }
    );
  }

  // Rating preflight BEFORE any write, cascade included: the rating rebuild in
  // step 5 runs after games, children and match fields are already reset, so
  // a refusal there would leave the match half-reset (and a retry would then
  // hit "already in scheduled state"). The plan covers the players of this
  // match and of every downstream match the cascade resets, excludes all of
  // those matches (still completed now, un-completed by this reset), and
  // refuses only a history-gap cycle no rebuild order can fill
  // (RatingHistoryIntegrityError, 409) with nothing written.
  if (wasCompleted || playedDownstream.some((child) => child.status === 'completed')) {
    const resetMatches = [match, ...playedDownstream];
    await planRatingRebuild(
      [...new Set(resetMatches.flatMap((m) => [m.player_1_id, m.player_2_id]))],
      { excludeMatchIds: resetMatches.map((m) => m.id) }
    );
  }

  // The later matches go first, deepest first (`resetPlayedDownstream`, shared with an approved admin game change). What
  // their resets reported (a failed format revert, a failed evolution recheck) is part of this reset's result.
  const downstreamReset = await resetPlayedDownstream(playedDownstream, adminId);

  // Re-read before anything is destroyed: the preflight and the cascade above can take seconds, and a result that landed
  // meanwhile must answer 409 with its games intact. The compare-and-set in step 3 still decides; if a completion slips into
  // the short gap between this read and that write, the 409 tells the admin to try again, and that retry finishes the reset
  // (it sees the completed match, so it rebuilds the ratings).
  const latestBeforeDelete = await getMatchById(matchId);
  if (latestBeforeDelete && latestBeforeDelete.status !== match.status) {
    throw new MatchStateChangedError(latestBeforeDelete.status);
  }

  // 1. Delete all games (aggregates rolled back per game). Parallel is safe:
  //    each rollback is one transaction under its own game row lock, its
  //    decrements are relative updates under the aggregate row locks, and
  //    every call takes those locks in the same sorted order (no lost update
  //    on shared Pokemon rows, no deadlock).
  //    Every rollback is settled before deciding: when one loses a race
  //    (concurrent edit/delete of that game) its siblings may already have
  //    committed, so "nothing was changed" would be false. A failure with
  //    zero siblings removed rethrows the game's own error unchanged.
  const games = await getGamesByMatch(matchId);
  const settled = await Promise.allSettled(
    games.map((game) =>
      rollbackAndDeleteGame(game.id, match.tournament_id, tournament.season_id)
    )
  );
  const failures = settled.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failures.length > 0) {
    const removed = settled.length - failures.length;
    if (removed === 0) {
      // Nothing was removed: the first game's error is rethrown unchanged (and
      // logged by the route); every rejection is logged here so none is lost.
      for (const [index, failure] of failures.entries()) {
        console.error(
          `[resetMatch] match ${matchId}: game rollback ${index + 1} of ${failures.length} failed and no game was removed:`,
          failure.reason
        );
      }
      throw failures[0].reason;
    }
    for (const failure of failures) {
      console.error(`[resetMatch] match ${matchId}: a game rollback failed after ${removed} sibling(s) were removed:`, failure.reason);
    }
    throw new MatchResetPartialError(removed, failures.map((failure) => failure.reason));
  }
  // 2. Clean orphaned match-derived children (prep teams, proposals, moments,
  //    animation views, cleared team/cast/agent pointers, social image).
  const childrenCleanup = await cleanMatchChildren(matchId);

  // 3. Reset match fields — MOVED EARLIER so the rebuilds below see this match
  //    as 'scheduled' (their status='completed' filters then exclude it). A
  //    compare-and-set on the status read above: a completion that landed
  //    meanwhile has run its finalize, and a blind reset would leave its
  //    ratings and bracket slots applied with no rebuild (wasCompleted is
  //    false). Answers 409; resetting again then sees the completed match.
  const outcomeMark = await readOutcomeMark(matchId);
  if (!(await resetMatchFields(matchId, match.status))) {
    throw new MatchStateChangedError((await getMatchById(matchId).catch(() => null))?.status);
  }

  // 4. Delete AI analyses (Professor Linden) + EPB snapshots so a
  //    re-finalization rebuilds from fresh hooks. The outcome row goes by the
  //    `set_at` read before the flip and a failed delete is logged, not
  //    thrown: the match is scheduled already, and a thrown error here would
  //    skip the rebuilds below and leave a retry answering "already scheduled".
  await Promise.all([
    deleteMatchAnalysis(matchId),
    deleteMatchPrepAnalysesByMatch(matchId),
    takeBackMarkedOutcome(matchId, outcomeMark),
  ]);
  await deleteMatchSnapshots(matchId);

  // 4b. The format runtime of a custom league takes back what the completion applied (match_completed).
  const formatReverted = await revertFormatCompletion(match, tournament, match.status, 'scheduled');

  // 5. Rebuild gamification effects if this match was completed.
  const rebuiltRatingPlayerIds: string[] = [];
  if (wasCompleted) {
    // Rebuild BOTH players' rating curves chronologically (an inverse of
    // this one match would only be correct for each player's last match).
    // The batch may add players to heal history gaps; the summary lists
    // every player it rebuilt.
    const ratingResults = await rebuildRatingsForPlayers([match.player_1_id, match.player_2_id]);
    rebuiltRatingPlayerIds.push(...ratingResults.map((result) => result.playerId));

    await Promise.all([
      recomputeStreaks(match.player_1_id),
      recomputeStreaks(match.player_2_id),
    ]);
    await Promise.all([
      updateSignatures(match.player_1_id),
      updateSignatures(match.player_2_id),
    ]);
    // Achievements are permanent and intentionally not revoked on reset.
  }

  // 6. Evolution rebuild.
  // EPB: rebuild the whole season chronologically via repairSeasonEvolution
  // (the per-game debit is only used by an edit; the rebuild also re-syncs
  // the games' real-kill credit markers).
  // The deleted games' battle_stats are already gone, and
  // repairSeasonEvolution recomputes from remaining completed matches, so
  // this match is naturally excluded. Capture the full RepairResult so the
  // itemized recalculation summary (spec §24) can surface tracker/event/Evolution
  // Point counts alongside the impossible lineups.
  // Legacy: keep the inverse checkPlayerEvolutions path (recheckEvolutions).
  let evolutionEvents: EvolutionEvent[] = [];
  let evolutionRecheckFailed = false;
  let impossibleLineups: ImpossibleLineup[] | undefined;
  let evolutionRepaired: MatchRecalculationSummary['evolutionRepaired'] = undefined;
  if (
    tournament.season_id &&
    isEvolutionPointBuy(tournament.season_format_type ?? '')
  ) {
    const repair = await repairSeasonEvolution(tournament.season_id);
    impossibleLineups = repair.impossibleLineups;
    evolutionRepaired = {
      trackersUpdated: repair.trackersUpdated,
      eventsRewritten: repair.eventsRewritten,
      evolutionPoints: repair.evolutionPoints.points_awarded,
      impossibleLineups: repair.impossibleLineups,
    };
    // EPB carries progression detail in the repair result, not in events.
  } else {
    const recheck = await recheckEvolutions(tournament.season_id, match.player_1_id, match.player_2_id);
    evolutionEvents = recheck.events;
    evolutionRecheckFailed = recheck.failed;
  }

  // 7. Revert round if completed; un-propagate bracket + check downstream
  await revertRoundIfCompleted(match.round_id);
  await unpropagateBracketOnMatchReset(match, tournament, participants);
  const downstream =
    playedDownstream.length > 0 ||
    await hasDownstreamMatches(matchId, downstreamSnapshot);

  // Unified impossible-lineups array for easy UI access (EPB repair, or empty
  // for legacy seasons where no whole-season rebuild runs).
  const summaryImpossibleLineups = impossibleLineups ?? [];

  // The stage of an ended format phase is not reopened: the admin is told who advanced on the strength of the old result.
  const stageEnded = (await loadStageEndedWarning(tournament, wasCompleted)) ?? downstreamReset.stageEnded;

  return {
    games_deleted: games.length,
    has_downstream_matches: downstream,
    evolution_events: evolutionEvents,
    ...(evolutionRecheckFailed || downstreamReset.evolutionRecheckFailed ? { evolution_recheck_failed: true } : {}),
    ...(formatReverted && !downstreamReset.formatRevertFailed ? {} : { format_revert_failed: true }),
    ...(stageEnded ? { stage_already_ended: stageEnded } : {}),
    childrenCleanup,
    impossibleLineups,
    recalculation: {
      gamesDeleted: games.length,
      childrenCleanup,
      ratingsRebuilt: { players: rebuiltRatingPlayerIds },
      evolutionRepaired,
      impossibleLineups: summaryImpossibleLineups,
    },
  };
}

/**
 * Read-only preview of `resetMatch`: how many games it deletes, whether the
 * match WAS completed (ratings, streaks and signatures are then rebuilt) and
 * the played later bracket matches a cascading reset also resets, deepest
 * first. A scheduled match has nothing to reset and previews as zeros. Reads
 * every match of the tournament plus the games of each downstream slot, so it
 * belongs behind one dialog open, never on a list page.
 */
export async function previewMatchReset(matchId: string): Promise<MatchResetPreview> {
  const { match, tournament } = await getMatchContext(matchId);

  if (match.status === 'scheduled') {
    return { games_to_delete: 0, was_completed: false, downstream: [] };
  }

  const participants = await getParticipants(match.tournament_id);
  const [playedDownstream, rounds] = await Promise.all([
    collectPlayedDownstreamMatches(match, tournament, participants),
    getRoundsByTournament(match.tournament_id),
  ]);
  const roundNameById = new Map(rounds.map((round) => [round.id, round.name]));

  return {
    games_to_delete: match.games.length,
    was_completed: match.status === 'completed',
    downstream: playedDownstream.map((child) => ({
      id: child.id,
      player_1_name: child.player_1_name,
      player_2_name: child.player_2_name,
      status: child.status,
      round_name: roundNameById.get(child.round_id) ?? '',
    })),
  };
}

/**
 * Reset all non-scheduled matches in a round.
 */
export async function resetRound(
  roundId: string,
  adminId: string,
  cascade = false
): Promise<ResetRoundResult> {
  const matches = await getMatchesByRound(roundId);
  const toReset = matches.filter((m) => m.status !== 'scheduled');

  let totalGamesDeleted = 0;
  const allEvolutionEvents: EvolutionEvent[] = [];
  let evolutionRecheckFailed = false;
  let formatRevertFailed = false;
  let stageEnded: StageEndedWarning | null = null;

  // Cascade can touch shared downstream matches, so stay sequential.
  // Without cascade, keep the existing bounded parallel chunks.
  if (cascade) {
    for (const match of toReset) {
      const result = await resetMatch(match.id, adminId, true);
      totalGamesDeleted += result.games_deleted;
      allEvolutionEvents.push(...result.evolution_events);
      if (result.evolution_recheck_failed) evolutionRecheckFailed = true;
      if (result.format_revert_failed) formatRevertFailed = true;
      stageEnded ??= result.stage_already_ended ?? null;
    }
  } else {
    const CHUNK_SIZE = 4;
    for (let i = 0; i < toReset.length; i += CHUNK_SIZE) {
      const chunk = toReset.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map((match) => resetMatch(match.id, adminId, false))
      );
      for (const result of results) {
        totalGamesDeleted += result.games_deleted;
        allEvolutionEvents.push(...result.evolution_events);
        if (result.evolution_recheck_failed) evolutionRecheckFailed = true;
        if (result.format_revert_failed) formatRevertFailed = true;
        stageEnded ??= result.stage_already_ended ?? null;
      }
    }
  }

  // The round goes back to pending (roundMachine `reset`), as a compare-and-set on the status read now; a pending round stays.
  const round = await requireRound(roundId);
  if (round.status !== 'pending') {
    roundMachine.assertTransition(round.status, 'pending', 'admin');
    await updateRoundStatus(roundId, 'pending', round.status);
  }

  return {
    matches_reset: toReset.length,
    total_games_deleted: totalGamesDeleted,
    evolution_events: allEvolutionEvents,
    ...(evolutionRecheckFailed ? { evolution_recheck_failed: true } : {}),
    ...(formatRevertFailed ? { format_revert_failed: true } : {}),
    ...(stageEnded ? { stage_already_ended: stageEnded } : {}),
  };
}

/**
 * Writes the edited winner and battle stats (steps 2 and 3 of `editGame`) and
 * returns the game's stats after the edit.
 */
async function writeGameEdit(
  input: EditGameInput,
  game: Game,
  oldStats: BattleStat[]
): Promise<BattleStat[]> {
  const newWinnerId = input.winner_id ?? game.winner_id;
  const winnerChanged = Boolean(input.winner_id && input.winner_id !== game.winner_id);
  if (input.winner_id && winnerChanged) {
    await updateGameWinner(input.game_id, input.winner_id);
  }

  if (input.battle_stats) {
    await deleteBattleStatsByGame(input.game_id);
    const inserts: BattleStatInsert[] = input.battle_stats.map((s) => ({
      game_id: input.game_id,
      player_id: s.player_id,
      pokemon_name: s.pokemon_name,
      was_brought: s.was_brought ?? true,
      was_lead: s.was_lead ?? false,
      kos_dealt: s.kos_dealt ?? 0,
      was_koed: s.was_koed ?? false,
      moves_used: s.moves_used ?? [],
      turns_active: s.turns_active ?? 0,
      match_won: s.player_id === newWinnerId,
    }));
    return createBattleStats(inserts);
  }

  if (!winnerChanged) return oldStats;

  // Winner changed but stats not replaced — update match_won on existing stats
  await deleteBattleStatsByGame(input.game_id);
  const inserts: BattleStatInsert[] = oldStats.map((s) => ({
    game_id: input.game_id,
    player_id: s.player_id,
    pokemon_name: s.pokemon_name,
    was_brought: s.was_brought,
    was_lead: s.was_lead,
    kos_dealt: s.kos_dealt,
    was_koed: s.was_koed,
    moves_used: s.moves_used,
    turns_active: s.turns_active,
    match_won: s.player_id === newWinnerId,
  }));
  return createBattleStats(inserts);
}

/**
 * An admin game edit or delete failed AND queueing the job that would count
 * the game again failed too, while the game still exists (or its existence
 * could not be read): the game may stay uncounted until an admin rebuilds its
 * aggregate scopes. HTTP 500 with its own code so the admin sees the operator
 * action instead of a generic failure; both underlying errors stay on the
 * instance (logged by `safeErrorResponse`).
 */
export class GameLeftUncountedError extends UserFacingError {
  readonly gameId: string;
  /** The edit's or delete's own failure. */
  readonly editError: unknown;
  readonly requeueError: unknown;

  constructor(gameId: string, editError: unknown, requeueError: unknown) {
    super(
      'The game change failed, and the game could not be queued to be counted again, so it may be missing from the statistics. Rebuild the aggregates of its tournament and season (admin data tools).',
      { code: 'admin_game_left_uncounted', status: 500 },
    );
    this.name = 'GameLeftUncountedError';
    this.gameId = gameId;
    this.editError = editError;
    this.requeueError = requeueError;
  }
}

/**
 * An admin edit or delete failed after it started changing the game: the
 * game may now be uncounted (rolled back, or its pending job cancelled) with
 * no job left to count it. Queue a fresh job so the aggregate queue counts the
 * game's stats as they are now; `apply_aggregate_job` fences on the marker, so
 * the job is a no-op when the game is still (or again) counted.
 *
 * Returns null when the re-queue worked, or when it failed because the game no
 * longer exists (a concurrent delete: nothing is left to count); the caller
 * then rethrows its own error. Otherwise returns the `GameLeftUncountedError`
 * the caller throws instead, which names the operator action (a scope
 * rebuild, docs/match.md).
 */
async function requeueAfterFailedChange(
  operation: 'edit' | 'delete',
  gameId: string,
  tournamentId: string,
  seasonId: string | null,
  cause: unknown
): Promise<GameLeftUncountedError | null> {
  console.error(
    `[game-pipeline] ${operation} failed for game ${gameId} after it started writing; queueing an aggregate job so the game is counted again`,
    cause
  );
  try {
    await enqueueAggregateJob(gameId, tournamentId, seasonId);
    return null;
  } catch (requeueError) {
    let stillExists = true;
    try {
      stillExists = (await getGameById(gameId)) !== null;
    } catch (readError) {
      console.error(`[game-pipeline] could not read game ${gameId} after its re-queue failed`, readError);
    }
    if (!stillExists) {
      console.error(
        `[game-pipeline] re-queue of game ${gameId} failed because the game is gone (deleted concurrently); nothing is left to count`,
        requeueError
      );
      return null;
    }
    return new GameLeftUncountedError(gameId, cause, requeueError);
  }
}

/**
 * Edit a game's winner and/or battle stats.
 * Rolls back old aggregates, applies changes, re-applies new aggregates.
 *
 * Concurrency: after its read-only preflight (`preflightGameChange`: it must not move the version) and before anything
 * is written, the edit claims the game's edit lease together with the version the editor loaded (`input.expected_updated_at`,
 * else the version this request read first) in ONE conditional UPDATE
 * (`claimGameEditLease`). The claim needs both the editor's version and no
 * other running edit:
 *   - of two edits carrying the same version (a double submit, two admins on
 *     one game) exactly one claims it; the other answers 409;
 *   - an editor reloaded while an edit runs holds the current version, but
 *     the running edit's lease refuses it (`GameEditInProgressError`, 409);
 *   - an editor opened before the last change answers `GameEditStaleError`
 *     (409). Nothing is written by a refused edit.
 * The lease is released when the edit ends, success or failure
 * (`releaseEditLease`), and expires on its own after
 * `GAME_EDIT_LEASE_TTL_SECONDS`. An edit that still meets a concurrent change
 * at its rollback (a delete or reset of the game, which take no lease: the
 * fenced RPC answers 'not_applied' or 'marker_changed') answers
 * `GameChangedConcurrentlyError` (409) and writes nothing either.
 *
 * The rollback (decrements + marker clear) and the re-apply (increments +
 * marker + job completion) are each one SQL transaction. A failure between
 * them re-queues the game (`requeueAfterFailedChange`) so the queue restores
 * its count.
 */
export async function editGame(input: EditGameInput, options: GameChangeOptions = {}): Promise<EditGameResult> {
  const before = await getGameById(input.game_id);
  if (!before) throw new GameNotFoundError();

  const { match, tournament } = await getMatchContext(before.match_id);
  // Read before any mutation: a failed read aborts with nothing changed.
  const round = await requireRound(match.round_id);
  assertEditNamesMatchPlayers(input, before, match);
  // Every refusal that reads only (the rating plan, the played later bracket matches) comes BEFORE the lease claim: the
  // claim moves the game's version, and a refused edit must leave it where the editor loaded it, so that the editor's
  // resend with the approval of the later matches is not stale.
  const plan = await preflightGameChange(match, tournament, options.confirmDownstream);

  // 0. Claim the edit lease at the version the editor loaded; a stale editor
  //    or a concurrent edit stops here with nothing written.
  const leaseToken = crypto.randomUUID();
  const claim = await claimGameEditLease(input.game_id, input.expected_updated_at ?? before.updated_at, leaseToken);
  if (claim === 'missing') throw new GameNotFoundError();
  if (claim === 'leased') throw new GameEditInProgressError();
  if (claim === 'stale') throw new GameEditStaleError();

  try {
    return await editClaimedGame(input, match, tournament, round, plan, options);
  } finally {
    await releaseEditLease(input.game_id, leaseToken);
  }
}

/**
 * Release the edit lease `editGame` claimed. Called from a `finally`, so it
 * never throws over the edit's own outcome: a saved edit stays saved, and a
 * failed edit's error is the one the admin sees. A failed or lost release is
 * logged with the game and the cause; its only effect is that further edits
 * of the game answer 409 `admin_game_edit_in_progress` until the lease
 * expires (`GAME_EDIT_LEASE_TTL_SECONDS`).
 */
async function releaseEditLease(gameId: string, token: string): Promise<void> {
  try {
    const released = await releaseGameEditLease(gameId, token);
    if (!released) {
      console.error(
        `[game-pipeline] edit lease of game ${gameId} was no longer held at release: it expired and another edit took it over, or the game was deleted during the edit`
      );
    }
  } catch (releaseError) {
    console.error(
      `[game-pipeline] could not release the edit lease of game ${gameId}; further edits answer 409 until it expires`,
      releaseError
    );
  }
}

/** `editGame` after its lease is claimed: steps 1-7. */
async function editClaimedGame(
  input: EditGameInput,
  match: Awaited<ReturnType<typeof getMatchContext>>['match'],
  tournament: Awaited<ReturnType<typeof getMatchContext>>['tournament'],
  round: Round,
  plan: GameChangePlan,
  options: GameChangeOptions
): Promise<EditGameResult> {
  const wasCompleted = match.status === 'completed';
  const { participants } = plan;

  // 0b. An approved change first resets the played later bracket matches, deepest first, as a cascading reset does.
  const downstreamReset = await resetDownstreamForGameChange(match, plan, input.admin_id, options);

  // 1. Cancel any pending aggregate jobs for this game, then re-read it: the
  //    applied marker is only final after the cancel (readGameAfterJobCancel).
  //    From the cancel on, the game may be uncounted, so every failure until
  //    the re-apply commits re-queues it.
  let newStats: BattleStat[];
  let oldStats: BattleStat[];
  // The step-1 read: its evolution marker fences the EPB debit in step 7.
  let editedGame: Game;
  let gameGone = false;
  try {
    const game = await readGameAfterJobCancel(input.game_id);
    if (!game) {
      gameGone = true; // deleted meanwhile: nothing left to count
      throw new GameNotFoundError();
    }
    editedGame = game;

    // 2. Fetch old stats and roll their aggregates back together with the
    //    marker (one transaction, fenced on the marker read above). A
    //    concurrent rollback or re-apply throws 409 here, before any write.
    oldStats = await getBattleStatsByGame(input.game_id);
    if ((await rollbackCountedGame(game, oldStats, match.tournament_id, tournament.season_id)) === 'game_missing') {
      gameGone = true;
      throw new GameNotFoundError();
    }

    // 3. Winner and battle stats.
    newStats = await writeGameEdit(input, game, oldStats);

    // 4. Re-apply aggregates with new stats. Increments, marker and job
    //    completion commit in ONE transaction (applyGameAggregatesNow), so a
    //    lost or failed marker write can never leave the game counted with
    //    the marker NULL, which a retried edit would count a second time.
    //    No stats: nothing to count, and the marker is already NULL.
    if (newStats.length > 0) {
      await applyGameAggregatesNow(
        input.game_id, match.tournament_id, tournament.season_id,
        buildGameAggregateDeltas(newStats, match.tournament_id, tournament.season_id, {
          // The frozen, creation-time decision — do not recompute test flags here.
          excludeAllTime: game.exclude_all_time,
        })
      );
    }
  } catch (err) {
    // A lost race (409) wrote nothing: the winner's edit owns the count.
    if (!gameGone && !(err instanceof GameChangedConcurrentlyError)) {
      const uncounted = await requeueAfterFailedChange('edit', input.game_id, match.tournament_id, tournament.season_id, err);
      if (uncounted) throw uncounted;
    }
    throw err;
  }

  // 5. Lock stats when the admin replaced battle_stats so future re-parse
  // / bulk import tooling skips this game and preserves hand-corrected data.
  // Winner-only edits do not flip the lock.
  if (input.battle_stats) {
    await setGameStatsLocked(input.game_id, true);
  }

  // 6. Re-evaluate match status
  const { status, winnerId, statusConflict } = await reevaluateMatchStatus(
    match.id, round.best_of, match.status,
    match.player_1_id, match.player_2_id, input.admin_id
  );

  // 6a. A completed match the edit moved out of `completed`: its round is no
  //     longer complete, and its bracket slots and result-derived artifacts
  //     are taken back (as deleteGame, resetMatch and reopenMatch do).
  if (wasCompleted && status !== 'completed') {
    await revertRoundIfCompleted(match.round_id);
    await dropCompletedResultEffects(match, tournament, participants);
  }

  // 6b. A completed match the edit moved out of `completed` (to
  //     pending_confirmation, in_progress or scheduled): rebuild ratings,
  //     streaks and signatures so they stop counting it until it is
  //     confirmed again.
  const rebuiltRatingPlayerIds = await rebuildGamificationAfterUncomplete(
    wasCompleted, status, match.player_1_id, match.player_2_id
  );
  const formatReverted = await revertFormatCompletion(match, tournament, match.status, status);

  // 7. Re-check evolutions. EPB: debit the game's credited kills (the match
  //    left `completed`), then re-read the match and credit the edited stats
  //    if a concurrent confirm completed it again meanwhile (also between
  //    step 6 and the debit). Legacy: battle_stats re-sum.
  const recheck = tournament.season_id && isEvolutionPointBuy(tournament.season_format_type ?? '')
    ? await recheckEpbAfterEdit({
        seasonId: tournament.season_id,
        matchId: match.id,
        matchday: round.round_number,
        playerIds: [match.player_1_id, match.player_2_id],
        game: editedGame,
        oldStats,
        newStats,
        wasCompleted,
        statusConflict,
      })
    : await recheckEvolutions(tournament.season_id, match.player_1_id, match.player_2_id);

  // The stage of an ended format phase is not reopened: the admin is told who advanced on the strength of the old result.
  const stageEnded =
    (await loadStageEndedWarning(tournament, wasCompleted && status !== 'completed')) ??
    downstreamReset?.stageEnded ??
    null;

  return {
    match_status: status,
    match_winner_id: winnerId,
    ...(statusConflict ? { match_status_conflict: true } : {}),
    ...(rebuiltRatingPlayerIds.length > 0 ? { ratings_rebuilt: rebuiltRatingPlayerIds } : {}),
    evolution_events: recheck.events,
    ...downstreamResetFields(downstreamReset),
    ...(recheck.failed ? { evolution_recheck_failed: true } : {}),
    ...(formatReverted ? {} : { format_revert_failed: true }),
    ...(stageEnded ? { stage_already_ended: stageEnded } : {}),
  };
}
