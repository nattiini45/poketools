import {
  createGame, createBattleStats, getNextGameNumber, getGameWinCounts,
  getGameById, getGamesByMatch, getBattleStatsByGame,
  deleteBattleStatsByGame, deleteGameRow, updateGameWinner,
  markGameAggregatesApplied, clearGameAggregatesApplied,
  setGameStatsLocked,
} from '@/lib/supabase/queries/games';
import { updateAggregates, rollbackAggregates } from '@/lib/supabase/queries/aggregates';
import { shouldExcludeFromAllTime } from '@/lib/supabase/queries/test-accounts';
import { enqueueAggregateJob, cancelAggregateJobsForGame } from '@/lib/match/aggregate-queue';
import {
  updateMatchStatus,
  getMatchById,
  resetMatchFields,
  hasDownstreamMatches,
  getMatchesByRound,
  getMatchesByTournament,
  updateMatchConfirmationTiming,
} from '@/lib/supabase/queries/matches';
import {
  findDownstreamSlotKeys,
  findMatchForSlot,
  findSlotForMatch,
  unpropagateBracketOnMatchReset,
} from '@/lib/tournament/bracket-propagation';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament, updateRoundStatus } from '@/lib/supabase/queries/rounds';
import { hasReachedBoThreshold, validateTransition } from '@/lib/tournament/match-state';
import { checkPlayerEvolutions } from '@/lib/draft/evolution-engine';
import {
  applyRealKillsFromGame,
  rollbackRealKillsFromGame,
  recheckEpbStages,
} from '@/lib/match/evolution-match-evaluator';
import { deleteMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { deleteMatchPrepAnalysesByMatch } from '@/lib/supabase/queries/match-prep-analyses';
import { deleteMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { rebuildRatingsForPlayers } from '@/lib/rating/updateRatings';
import { recomputeStreaks } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';
import { cleanMatchChildren } from '@/lib/match/match-children';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { normalizeReplayUrlOrId } from '@/lib/pkmn/replay';
import type { MatchWithPlayers } from '@/types/match';
import type { ParticipantWithSeed } from '@/types/tournament';
import type {
  GameSource, BattleStatInsert, BattleStat,
  DeleteGameResult, ResetMatchResult, ResetRoundResult,
  EditGameInput, EditGameResult, MatchRecalculationSummary,
} from '@/types/game';
import type { EvolutionEvent } from '@/types/evolution';
import type { ImpossibleLineup } from '@/lib/reconcile/evolution-rebuild';

interface GamePipelineInput {
  match_id: string;
  winner_id: string;
  replay_url?: string;
  screenshot_url?: string;
  source: GameSource;
  battle_stats: BattleStatInsert[];
  submitter_id: string;
  /** When true, bypasses participant check (admin submitting on behalf of players) */
  is_admin?: boolean;
}

interface GamePipelineResult {
  game_id: string;
  match_status: string;
  match_winner_id: string | null;
  bo_reached: boolean;
  /** Evolution events triggered by this game (empty if not an evo-league) */
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
 * Shared pipeline for recording a game result + stats + aggregates.
 * Used by both POST /api/parse-replay and POST /api/manual-result.
 *
 * This enforces CLAUDE.md rule #4: every write to games/battle_stats
 * must trigger updateAggregates().
 */
/**
 * NOTE: Steps 1-3 (game + stats + aggregates) are individually atomic
 * but not wrapped in a single DB transaction. A partial failure between
 * steps could leave inconsistent state. Aggregate upserts use atomic RPCs
 * (ON CONFLICT DO UPDATE) to prevent counter corruption from concurrent writes.
 * Side effects (Discord, AI, revalidate) must be triggered by the caller
 * ONLY after this function returns successfully.
 */
export async function recordGameResult(input: GamePipelineInput): Promise<GamePipelineResult> {
  const match = await getMatchById(input.match_id);
  if (!match) throw new Error('Match not found');

  // Validate the actor is a participant or admin
  const isParticipant =
    input.submitter_id === match.player_1_id ||
    input.submitter_id === match.player_2_id;
  if (!isParticipant && !input.is_admin) {
    throw new Error('Only match participants or admins can submit results');
  }

  // Auto-transition scheduled → in_progress on first game submission.
  // Track current status locally so the Bo threshold check below sees the
  // correct state (the `match` object is not re-fetched after this update).
  let currentStatus = match.status;
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
    await updateMatchStatus(input.match_id, 'in_progress');
    currentStatus = 'in_progress';
  } else if (currentStatus !== 'in_progress') {
    throw new Error(`Cannot submit game for match in ${currentStatus} state`);
  }

  assertReplayNotDuplicate(match, input.replay_url);

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

  // 1. Create Game record
  const gameNumber = await getNextGameNumber(input.match_id);
  const game = await createGame({
    match_id: input.match_id,
    game_number: gameNumber,
    winner_id: input.winner_id,
    replay_url: input.replay_url,
    source: input.source,
    parsed: true,
    exclude_all_time: excludeAllTime,
  });

  // 2. Write Battle Stats with game_id and match_won
  const statsWithGameId: BattleStatInsert[] = input.battle_stats.map((s) => ({
    ...s,
    game_id: game.id,
    match_won: s.player_id === input.winner_id,
  }));

  const _createdStats = await createBattleStats(statsWithGameId);

  // 3. Enqueue aggregate update (processed asynchronously)
  await enqueueAggregateJob(
    game.id,
    match.tournament_id,
    tournament.season_id
  );

  // 3b. Check evolutions for both participants (evo-league hook).
  // Round context is fetched once: round_number doubles as the matchday for
  // EPB progress logging, best_of drives the Bo threshold check below.
  const { data: round } = await import('@/lib/supabase/client').then(m =>
    m.supabase.from('rounds').select('best_of, round_number').eq('id', match.round_id).single()
  );

  let evolutionEvents: EvolutionEvent[] = [];
  if (tournament.season_id) {
    if (tournament.season_format_type === 'evolution_point_buy') {
      // EPB: progress + stage resolution is owned by the match evaluator.
      // Do NOT run checkPlayerEvolutions — it re-derives total_kos from
      // battle_stats alone and would erase token/cosmo contributions.
      try {
        evolutionEvents = await applyRealKillsFromGame(
          tournament.season_id,
          statsWithGameId.map((s) => ({
            player_id: s.player_id,
            pokemon_name: s.pokemon_name,
            kos_dealt: s.kos_dealt ?? 0,
          })),
          { matchday: round?.round_number ?? null }
        );
      } catch (err) {
        // Don't block result recording on progress-tracking failures;
        // real_kills can be reconciled from battle_stats later.
        console.error('applyRealKillsFromGame failed; game recorded without progress update', err);
      }
    } else {
      const [p1Events, p2Events] = await Promise.all([
        checkPlayerEvolutions(tournament.season_id, match.player_1_id),
        checkPlayerEvolutions(tournament.season_id, match.player_2_id),
      ]);
      evolutionEvents = [...p1Events, ...p2Events];
    }
  }

  // 4. Check Bo threshold and update match status
  const { player_1_wins, player_2_wins } = await getGameWinCounts(input.match_id);

  const bestOf = round?.best_of ?? 1;

  const boResult = hasReachedBoThreshold(bestOf, player_1_wins, player_2_wins);

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

    if (transition.valid) {
      await updateMatchStatus(input.match_id, 'pending_confirmation', matchWinnerId, input.submitter_id);
      await updateMatchConfirmationTiming(input.match_id, {
        auto_confirm_at: getAutoConfirmAt(input.source, input.screenshot_url),
        confirmed_at: null,
      });
      newStatus = 'pending_confirmation';
    }
  }

  return {
    game_id: game.id,
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
  if (!match) throw new Error('Match not found');
  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament) throw new Error('Tournament not found');
  return { match, tournament };
}

/**
 * Helper: rollback aggregates and delete data for a single game.
 * Does NOT update match status (caller handles that).
 */
async function rollbackAndDeleteGame(
  gameId: string,
  tournamentId: string,
  seasonId: string | null
): Promise<BattleStat[]> {
  const game = await getGameById(gameId);
  if (!game) return [];

  // Cancel any pending aggregate jobs for this game to prevent double-counting
  // if the game is edited before its job is processed.
  await cancelAggregateJobsForGame(gameId);

  const stats = await getBattleStatsByGame(gameId);
  if (stats.length > 0 && game.aggregate_applied_at) {
    // Read the frozen, creation-time decision so flipping test flags after the
    // match exists cannot change what gets rolled back from all_time.
    const excludeAllTime = game.exclude_all_time;
    await rollbackAggregates(stats, tournamentId, seasonId, { excludeAllTime });
  }
  await deleteBattleStatsByGame(gameId);
  await deleteGameRow(gameId);
  return stats;
}

/**
 * Helper: re-check evolutions for both players in an evo-league.
 *
 * Format-aware: for evolution_point_buy seasons, tracker progress is owned by
 * the match evaluator — deleted/added stats adjust real_kills, then stages are
 * re-resolved from total_kos (which preserves token/cosmo contributions).
 * Legacy evo-leagues use checkPlayerEvolutions (battle_stats re-sum).
 * The season's format is threaded from the already-fetched tournament
 * (getTournamentById joins seasons.format_type) — no extra query.
 */
async function recheckEvolutions(
  seasonId: string | null,
  seasonFormatType: string | null | undefined,
  player1Id: string,
  player2Id: string,
  opts: {
    deletedStats?: { player_id: string; pokemon_name: string; kos_dealt: number }[];
    addedStats?: { player_id: string; pokemon_name: string; kos_dealt: number }[];
  } = {}
): Promise<EvolutionEvent[]> {
  if (!seasonId) return [];

  if (seasonFormatType === 'evolution_point_buy') {
    try {
      const events: EvolutionEvent[] = [];
      if (opts.deletedStats && opts.deletedStats.length > 0) {
        await rollbackRealKillsFromGame(seasonId, opts.deletedStats);
      }
      if (opts.addedStats && opts.addedStats.length > 0) {
        events.push(...await applyRealKillsFromGame(seasonId, opts.addedStats));
      }
      // Re-resolve stages (covers devolutions after rollback)
      events.push(...await recheckEpbStages(seasonId, [player1Id, player2Id]));
      return events;
    } catch (err) {
      console.error('EPB evolution recheck failed', err);
      return [];
    }
  }

  const [p1, p2] = await Promise.all([
    checkPlayerEvolutions(seasonId, player1Id),
    checkPlayerEvolutions(seasonId, player2Id),
  ]);
  return [...p1, ...p2];
}

/**
 * Helper: given match state after games changed, determine the correct
 * match status and update it. Returns new status + winner.
 */
async function reevaluateMatchStatus(
  matchId: string,
  roundId: string,
  player1Id: string,
  player2Id: string,
  adminId: string
): Promise<{ status: string; winnerId: string | null }> {
  const { player_1_wins, player_2_wins } = await getGameWinCounts(matchId);
  const totalGames = player_1_wins + player_2_wins;

  if (totalGames === 0) {
    // No games left → reset to scheduled
    await resetMatchFields(matchId);
    return { status: 'scheduled', winnerId: null };
  }

  // Get round best_of
  const { data: round } = await import('@/lib/supabase/client').then(m =>
    m.supabase.from('rounds').select('best_of').eq('id', roundId).single()
  );
  const bestOf = round?.best_of ?? 1;
  const boResult = hasReachedBoThreshold(bestOf, player_1_wins, player_2_wins);

  if (boResult.reached) {
    const winnerId = boResult.winner_id_index === 1 ? player1Id : player2Id;
    await updateMatchStatus(matchId, 'pending_confirmation', winnerId, adminId);
    return { status: 'pending_confirmation', winnerId };
  }

  // Games exist but Bo not reached → in_progress
  await updateMatchStatus(matchId, 'in_progress', null, adminId);
  return { status: 'in_progress', winnerId: null };
}

/**
 * Helper: revert round status to 'pending' if it was 'completed'.
 */
async function revertRoundIfCompleted(roundId: string): Promise<void> {
  const { data: round } = await import('@/lib/supabase/client').then(m =>
    m.supabase.from('rounds').select('status').eq('id', roundId).single()
  );
  if (round?.status === 'completed') {
    await updateRoundStatus(roundId, 'pending');
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
  adminId: string
): Promise<DeleteGameResult> {
  const game = await getGameById(gameId);
  if (!game) throw new Error('Game not found');

  const { match, tournament } = await getMatchContext(game.match_id);

  // 1. Rollback aggregates + delete data (aggregates first for safety)
  const deletedStats = await rollbackAndDeleteGame(gameId, match.tournament_id, tournament.season_id);

  // 2. Re-evaluate match status
  const { status } = await reevaluateMatchStatus(
    match.id, match.round_id,
    match.player_1_id, match.player_2_id, adminId
  );

  // 3. Revert round if needed
  await revertRoundIfCompleted(match.round_id);

  // 4. Re-check evolutions.
  // EPB: rebuild the whole season chronologically via repairSeasonEvolution.
  // The deleted game's battle_stats are already gone (rollbackAndDeleteGame),
  // and repairSeasonEvolution recomputes from remaining matches' battle_stats,
  // so the deleted game is naturally excluded. Capture the full RepairResult so
  // the itemized recalculation summary (spec §24) can surface tracker/event/
  // Evolution Point counts alongside the impossible lineups.
  // Legacy: keep the inverse checkPlayerEvolutions path.
  let evolutionEvents: EvolutionEvent[] = [];
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
    evolutionEvents = await recheckEvolutions(
      tournament.season_id, tournament.season_format_type, match.player_1_id, match.player_2_id,
      { deletedStats }
    );
  }

  // Count remaining games
  const remaining = await getGamesByMatch(match.id);

  // Unified impossible-lineups array for easy UI access (EPB repair, or empty
  // for legacy seasons where no whole-season rebuild runs).
  const summaryImpossibleLineups = impossibleLineups ?? [];

  return {
    match_status: status,
    games_remaining: remaining.length,
    evolution_events: evolutionEvents,
    impossibleLineups,
    recalculation: {
      gamesDeleted: 1,
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
async function collectPlayedDownstreamMatches(
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

  const structure = buildBracketStructureForParticipants(
    tournament.bracket_type,
    participants
  );
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
 *      + refresh signatures. rebuildRatingsForPlayers REPLACES the old
 *      rollbackRatingsForMatch inverse path — it replays each player's
 *      completed matches chronologically so the curve is correct after any
 *      match is removed, not just the last one.
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
    throw new Error('Match is already in scheduled state');
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
  if (playedDownstream.length > 0) {
    if (!cascade) {
      throw new UserFacingError(
        `${playedDownstream.length} downstream match(es) have results or are in progress. Pass cascade: true to reset the whole chain.`,
        { code: 'DOWNSTREAM_PLAYED', params: { count: playedDownstream.length }, status: 409 }
      );
    }
    for (const child of playedDownstream) {
      const latest = await getMatchById(child.id);
      if (!latest || latest.status === 'scheduled') continue;
      try {
        await resetMatch(child.id, adminId, true);
      } catch (err) {
        if (err instanceof Error && err.message.includes('already in scheduled state')) {
          continue;
        }
        throw err;
      }
    }
  }

  // 1. Delete all games (aggregates rolled back per game)
  // Games within a match are independent for rollback — process in parallel
  const games = await getGamesByMatch(matchId);
  const deletedStatArrays = await Promise.all(
    games.map((game) =>
      rollbackAndDeleteGame(game.id, match.tournament_id, tournament.season_id)
    )
  );
  const deletedStats = deletedStatArrays.flat();

  // 2. Clean orphaned match-derived children (prep teams, proposals, moments,
  //    animation views, cleared team/cast/agent pointers, social image).
  const childrenCleanup = await cleanMatchChildren(matchId);

  // 3. Reset match fields — MOVED EARLIER so the rebuilds below see this match
  //    as 'scheduled' (their status='completed' filters then exclude it).
  await resetMatchFields(matchId);

  // 4. Delete AI analyses (Professor Linden) + EPB snapshots so a
  //    re-finalization rebuilds from fresh hooks.
  await Promise.all([
    deleteMatchAnalysis(matchId),
    deleteMatchPrepAnalysesByMatch(matchId),
  ]);
  await deleteMatchSnapshots(matchId);

  // 5. Rebuild gamification effects if this match was completed.
  const rebuiltRatingPlayerIds: string[] = [];
  if (wasCompleted) {
    // Rebuild BOTH players' rating curves chronologically (replaces the old
    // rollbackRatingsForMatch inverse path, which was only correct for the
    // last match). rebuildRatingsForPlayers handles both players directly.
    const ratingPlayerIds = [match.player_1_id, match.player_2_id];
    await rebuildRatingsForPlayers(ratingPlayerIds);
    rebuiltRatingPlayerIds.push(...ratingPlayerIds);

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
  // (replaces the inverse rollbackRealKillsFromGame/recheckEpbStages path).
  // The deleted games' battle_stats are already gone, and
  // repairSeasonEvolution recomputes from remaining completed matches, so
  // this match is naturally excluded. Capture the full RepairResult so the
  // itemized recalculation summary (spec §24) can surface tracker/event/Evolution
  // Point counts alongside the impossible lineups.
  // Legacy: keep the inverse checkPlayerEvolutions path (recheckEvolutions).
  let evolutionEvents: EvolutionEvent[] = [];
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
    evolutionEvents = await recheckEvolutions(
      tournament.season_id, tournament.season_format_type, match.player_1_id, match.player_2_id,
      { deletedStats }
    );
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

  return {
    games_deleted: games.length,
    has_downstream_matches: downstream,
    evolution_events: evolutionEvents,
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

  // Cascade can touch shared downstream matches, so stay sequential.
  // Without cascade, keep the existing bounded parallel chunks.
  if (cascade) {
    for (const match of toReset) {
      const result = await resetMatch(match.id, adminId, true);
      totalGamesDeleted += result.games_deleted;
      allEvolutionEvents.push(...result.evolution_events);
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
      }
    }
  }

  // Ensure round is pending
  await updateRoundStatus(roundId, 'pending');

  return {
    matches_reset: toReset.length,
    total_games_deleted: totalGamesDeleted,
    evolution_events: allEvolutionEvents,
  };
}

/**
 * Edit a game's winner and/or battle stats.
 * Rolls back old aggregates, applies changes, re-applies new aggregates.
 */
export async function editGame(input: EditGameInput): Promise<EditGameResult> {
  const game = await getGameById(input.game_id);
  if (!game) throw new Error('Game not found');

  const { match, tournament } = await getMatchContext(game.match_id);
  // Read the frozen, creation-time decision — do not recompute test flags here.
  const excludeAllTime = game.exclude_all_time;

  // 1. Cancel any pending aggregate jobs for this game
  await cancelAggregateJobsForGame(input.game_id);

  // 2. Fetch old stats and rollback aggregates
  const oldStats = await getBattleStatsByGame(input.game_id);
  if (oldStats.length > 0 && game.aggregate_applied_at) {
    await rollbackAggregates(oldStats, match.tournament_id, tournament.season_id, { excludeAllTime });
  }

  // 2. Update game winner if changed
  const newWinnerId = input.winner_id ?? game.winner_id;
  if (input.winner_id && input.winner_id !== game.winner_id) {
    await updateGameWinner(input.game_id, input.winner_id);
  }

  // 3. Replace battle stats if provided
  let newStats: BattleStat[];
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
    newStats = await createBattleStats(inserts);
  } else {
    // Winner changed but stats not replaced — update match_won on existing stats
    if (input.winner_id && input.winner_id !== game.winner_id) {
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
      newStats = await createBattleStats(inserts);
    } else {
      newStats = oldStats;
    }
  }

  // 4. Re-apply aggregates with new stats
  if (newStats.length > 0) {
    await updateAggregates(newStats, match.tournament_id, tournament.season_id, { excludeAllTime });
    await markGameAggregatesApplied(input.game_id);
  } else {
    await clearGameAggregatesApplied(input.game_id);
  }

  // 5. Lock stats when the admin replaced battle_stats so future re-parse
  // / bulk import tooling skips this game and preserves hand-corrected data.
  // Winner-only edits do not flip the lock.
  if (input.battle_stats) {
    await setGameStatsLocked(input.game_id, true);
  }

  // 6. Re-evaluate match status
  const { status, winnerId } = await reevaluateMatchStatus(
    match.id, match.round_id,
    match.player_1_id, match.player_2_id, input.admin_id
  );

  // 7. Re-check evolutions (EPB: swap old stats' kills for new stats' kills)
  const evolutionEvents = await recheckEvolutions(
    tournament.season_id, tournament.season_format_type, match.player_1_id, match.player_2_id,
    { deletedStats: oldStats, addedStats: newStats }
  );

  return {
    match_status: status,
    match_winner_id: winnerId,
    evolution_events: evolutionEvents,
  };
}
