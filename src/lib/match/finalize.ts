import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import { revalidateMatchPages } from '@/lib/revalidation';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { propagateBracketOnMatchComplete } from '@/lib/tournament/bracket-propagation';
import { logAuditEvent } from '@/lib/audit/log';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMatchById, markMatchFinalized } from '@/lib/supabase/queries/matches';
import { getMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import {
  deleteMatchOutcome,
  getMatchOutcome,
  recordMatchOutcome,
  type RecordMatchOutcomeResult,
} from '@/lib/supabase/queries/match-outcomes';
import { faintTally, playedOutcomeSource } from '@/lib/match/outcome';
import { StagedOutcomeBlockedError } from '@/lib/match/staged-outcome';
import { getRatingHistoryByMatch, getRatingHistoryByMatches, loadRatingScope } from '@/lib/supabase/queries/ratings';
import { matchCountsForRatings } from '@/lib/rating/rating-scope';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { runEpbMatchdayHooks } from '@/lib/match/epb-matchday';
import { creditMatchRealKills } from '@/lib/match/evolution-match-evaluator';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { buildGamePokemonStats, computePokemonScoreFromGameStats } from '@/lib/discord/helpers';
import { checkAchievements } from '@/lib/gamification/achievements';
import { updateSignatures } from '@/lib/gamification/signatures';
import { recomputeStreaks } from '@/lib/gamification/streaks';
import { updateRatings, type RatingUpdateResult } from '@/lib/rating/updateRatings';
import type { MatchStatus, MatchWithPlayers } from '@/types/match';
import type { AdminOutcomeKind } from '@/types/match-outcome';
import type { BattleStat } from '@/types/game';
import type { Tournament } from '@/types/tournament';
import type { StreakChanges } from '@/types/streak';
import type { EarnedAchievement } from '@/types/achievement';

/**
 * Match finalize: the side effects of a match becoming `completed`.
 *
 * The status flip commits in its own UPDATE before this runs (confirm-match,
 * auto-confirm cron), so finalize can never "undo" a completion. Each side
 * effect therefore runs as its own guarded step: a failing step is logged with
 * its original error and recorded, and every step that does not depend on it
 * still runs (EPB hooks and snapshots run when ratings fail, and vice versa).
 * Only when every step succeeded is `matches.finalized_at` stamped; a failed
 * run writes a `match.finalize_failed` audit event for admins.
 *
 * The auto-confirm cron later heals completed matches whose marker is still
 * NULL (`healMatchFinalization`), re-running ONLY the steps proven replay-safe
 * (FINALIZE_HEAL_POLICY). Code review C2.
 */

export const FINALIZE_STEPS = [
  'revalidate',
  'tournament',
  'ratings',
  'battle_stats',
  'outcome',
  'streaks',
  'signatures',
  'achievements',
  'announcements',
  'epb_real_kills',
  'epb_hooks',
  'bracket_propagation',
  'format_hook',
  'mark_finalized',
] as const;

export type FinalizeStep = (typeof FINALIZE_STEPS)[number];

/**
 * What the heal does with each step, checked step by step against the code:
 * - `rerun`: replay-safe, run again from durable state.
 *   revalidate (cache expiry), tournament / battle_stats (reads), streaks
 *   (the live step and the heal both run `recomputeStreaks`, which rebuilds
 *   the player's row from their completed matches in one fenced write and
 *   grants nothing; the incremental `updateStreaks` is not replay-safe and
 *   only the backfill uses it), signatures
 *   (recomputed from aggregates), epb_real_kills (each game is credited once:
 *   `epb_credit_game_kills` sets `games.evolution_applied_at` in the same
 *   transaction and answers 'already_applied' afterwards; the stage recheck
 *   after it is state-based), epb_hooks (deduped per tracker and matchday:
 *   Cosmo award unique index, Evolution Point log check, suspension and stage
 *   checks are state-based, snapshots go through the replace RPC, and the
 *   orchestrator rolls its own writes back on failure; re-run only while the
 *   match has no snapshots, since they are its last write), bracket_propagation
 *   (materializes only missing downstream slots), outcome (`match_outcome_record`
 *   without force rewrites the same played row and never replaces an admin row;
 *   an admin row is rewritten from itself, so the heal carries the admin's
 *   forfeit, no-show or played result and only recomputes the faints of a
 *   played one; the admin result route writes that row BEFORE the status flip
 *   (`stageAdminOutcome`), so a completed match never lacks it), format_hook
 *   (the format runtime's `match_completed`, idempotent per completion key; a
 *   failed hook leaves the marker unset, so the heal calls it again),
 *   mark_finalized.
 * - `verify`: never re-applied, only checked. ratings: the heal requires
 *   both rating_history rows (a test-league match stays out of ratings and
 *   requires none); when they are missing it stops before every
 *   other step (`needs_admin`) and an admin repairs ratings (season
 *   reconcile). `updateRatings` now writes both ratings and both
 *   history rows in ONE transaction (`rating_apply_match_result`), so missing
 *   rows now mean "never applied" and a re-run would be safe; the heal still
 *   only verifies, because ratings written by the earlier two-statement
 *   path ("ratings, no history") cannot be told apart from that.
 * - `not_rerun`: not replay-safe and not checkable, never re-run by the heal.
 *   achievements (`upsertPlayerAchievement` increments times_earned of
 *   repeatable achievements on every run) and announcements (Discord/social
 *   posts: at most once). A first-run failure of these is listed in the
 *   `match.finalize_failed` audit event (needs_admin).
 */
export const FINALIZE_HEAL_POLICY: Readonly<Record<FinalizeStep, 'rerun' | 'verify' | 'not_rerun'>> = {
  revalidate: 'rerun',
  tournament: 'rerun',
  ratings: 'verify',
  battle_stats: 'rerun',
  outcome: 'rerun',
  streaks: 'rerun',
  signatures: 'rerun',
  achievements: 'not_rerun',
  announcements: 'not_rerun',
  epb_real_kills: 'rerun',
  epb_hooks: 'rerun',
  bracket_propagation: 'rerun',
  format_hook: 'rerun',
  mark_finalized: 'rerun',
};

/** Steps the heal never re-runs (reported in its audit event). */
const NOT_RERUN_STEPS: FinalizeStep[] = FINALIZE_STEPS.filter(
  (step) => FINALIZE_HEAL_POLICY[step] === 'not_rerun'
);

/** The outcome an admin set with the result route; written with force, so it replaces any earlier row. */
export interface AdminMatchOutcome {
  kind: AdminOutcomeKind;
  reason: string;
  /** The admin who set it; null when the system did (a format's deadline policy). */
  setBy: string | null;
}

interface FinalizeMatchCompletionInput {
  match: MatchWithPlayers;
  winnerId: string;
  previousStatus: MatchStatus;
  /** Absent: a played result (faints from the battle stats, source replay or manual). */
  adminOutcome?: AdminMatchOutcome;
}

export interface FinalizeMatchCompletionResult {
  /** False when finalize did not run at all (see `reason`). */
  finalized: boolean;
  reason?: string;
  propagation_failed?: boolean;
  /**
   * Steps that failed, or could not run because a step they need failed.
   * Empty when every step succeeded. Present whenever finalize ran.
   */
  failed_steps?: FinalizeStep[];
  /** True when every step succeeded and `finalized_at` was stamped. */
  complete?: boolean;
}

export interface HealMatchFinalizationResult {
  /** True when every re-run / verified step succeeded and the marker was stamped. */
  healed: boolean;
  /**
   * True when there was nothing to heal: the match is no longer `completed`
   * (reset between the worklist read and the heal, or before the marker
   * write; `reason: 'not_completed'`). Not a failure: the cron neither counts
   * it as failed nor spends its heal budget on it.
   */
  skipped?: boolean;
  /**
   * True when the heal stopped because only an admin can repair the match:
   * its rating_history rows are missing (`reason: 'ratings_missing'`; ratings
   * are never re-applied automatically) or its winner is not a participant
   * (`reason: 'winner_not_participant'`). Nothing else is re-run, so a match
   * stuck here costs no writes. The cron normally finds such rows first
   * (`findMatchesNeedingAdmin`, one batched read per page) and never calls
   * the heal for them; it lists them in `needsAdmin`, logs them at error
   * level and does not fail the run for them.
   */
  needs_admin?: boolean;
  reason?: 'not_completed' | 'winner_not_participant' | 'ratings_missing';
  failed_steps: FinalizeStep[];
}

type StepOutcome<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs finalize steps one by one, isolating failures. Every failure is logged
 * with the original error (AGENTS rule 5) and recorded by step name, so logs,
 * the audit event and the cron response all name the step that failed.
 */
class StepRunner {
  readonly failed: FinalizeStep[] = [];

  constructor(
    private readonly matchId: string,
    private readonly mode: 'finalize' | 'heal'
  ) {}

  async run<T>(step: FinalizeStep, fn: () => Promise<T> | T): Promise<StepOutcome<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      this.failed.push(step);
      console.error(`[match-${this.mode}] step "${step}" failed for match ${this.matchId}`, err);
      return { ok: false };
    }
  }

  /** `step` cannot run because a step it needs (`missing`) failed. */
  blocked(step: FinalizeStep, missing: FinalizeStep): void {
    this.failed.push(step);
    console.error(
      `[match-${this.mode}] step "${step}" not run for match ${this.matchId}: "${missing}" failed`
    );
  }
}

/**
 * The format runtime of a custom league (`match_completed`, track progress, assisted checks). A finalize step, so a
 * failure is visible and retried: the hook is idempotent per completion (its event key), logs its own failure with
 * the original error and reports it; the step then fails, `finalized_at` stays unset and the heal calls it again. It
 * needs the match's outcome row (faints, forfeit), so it never runs when the `outcome` step failed.
 */
async function runFormatHook(match: MatchWithPlayers, winnerId: string, tournament: Tournament): Promise<void> {
  const { onMatchCompleted } = await import('@/lib/format-engine/runtime/hooks');
  const applied = await onMatchCompleted({
    tournament,
    matchId: match.id,
    roundId: match.round_id,
    player1Id: match.player_1_id,
    player2Id: match.player_2_id,
    winnerId,
  });
  if (!applied) throw new Error(`format runtime hook failed for match ${match.id}`);
}

/**
 * The outcome of a played match: the faint tally of its battle stats (null when it has none). By default it never
 * replaces an admin row (a forfeit, no-show or played result the admin result route wrote before the completion), so a
 * heal or the take-back of a lost staging writes the same row again. `replaceAdminRow` is for the finalize of a
 * completion that carries no admin intent (a player's confirmation, the auto-confirm, a bulk confirm): any admin row
 * still there was staged by a request that never completed the match (it died between the staging and its status flip,
 * or lost the compare-and-set and its take-back failed), so it describes a result that never happened and the played
 * row replaces it. A staging that races this completion cannot land afterwards (it only writes while the match is not
 * completed) and one that landed before is the loser's: its own take-back then finds the row replaced and leaves it.
 */
function recordPlayedOutcome(
  match: MatchWithPlayers,
  statsByGame: Record<string, BattleStat[]>,
  options: { replaceAdminRow?: boolean } = {}
): Promise<RecordMatchOutcomeResult> {
  const tally = faintTally(statsByGame, match.player_1_id, match.player_2_id);
  return recordMatchOutcome({
    matchId: match.id,
    kind: 'played',
    p1Faints: tally?.p1 ?? null,
    p2Faints: tally?.p2 ?? null,
    source: playedOutcomeSource(match.games ?? []),
    reason: null,
    setBy: null,
    force: options.replaceAdminRow ?? false,
  });
}

/**
 * The admin's outcome. Faints come from the battle stats only for a played result (null without stats); a forfeit
 * or no-show never carries faints.
 */
function recordAdminOutcome(
  match: MatchWithPlayers,
  outcome: AdminMatchOutcome,
  statsByGame: Record<string, BattleStat[]> | null
): Promise<RecordMatchOutcomeResult> {
  const tally =
    outcome.kind === 'played' && statsByGame ? faintTally(statsByGame, match.player_1_id, match.player_2_id) : null;
  return recordMatchOutcome({
    matchId: match.id,
    kind: outcome.kind,
    p1Faints: tally?.p1 ?? null,
    p2Faints: tally?.p2 ?? null,
    source: 'admin',
    reason: outcome.reason,
    setBy: outcome.setBy,
    force: true,
  });
}

/** The row `stageAdminOutcome` wrote, identified by its `set_at`: what the caller may take back, and nothing another writer put there since. */
export interface StagedAdminOutcome {
  setAt: string;
}

/**
 * Writes the admin's outcome BEFORE the status flip that completes the match. The flip commits on its own and the
 * finalize steps after it can fail, and a heal cannot know the admin's intent: written first, a forfeit or no-show
 * can never be lost to a completed match with a played row. A failure throws with nothing completed, so the caller
 * answers an error and the admin retries. Faints stay unknown here; the finalize outcome step fills them for a played
 * result. The write is skipped (`kept`) when the match is already completed: the request that completed it owns the
 * row, and the caller's own status write then loses with a 409. The write and the status flip are separate
 * transactions, so two concurrent staged writers can overwrite each other's row; the request whose flip wins
 * therefore rewrites the row with its own outcome in finalize's outcome step. A request that dies between this write and
 * its status flip (a timeout, a kill) leaves the row behind on a match that is not completed; the completion that
 * follows without admin intent (a player's confirmation, the auto-confirm) replaces it in its finalize outcome step, so
 * the stale row never scores a played match as a forfeit. A caller whose status write loses
 * anyway calls `discardStagedAdminOutcome` with the handle this returns: the `set_at` of the row it wrote (null when
 * nothing was written or the row could not be read back; a null handle on a match that is not completed still takes the
 * row back, see `discardStagedAdminOutcome`).
 *
 * A match that a replay-tie has disputed meanwhile owns an `unresolved` row, which the forced write would overwrite
 * (the status write after it can only lose, the match left its status): staging refuses with
 * `StagedOutcomeBlockedError` and leaves the row alone. The check and the write are separate calls, so a dispute that
 * lands between them is still possible; `discardStagedAdminOutcome` puts the row back in that case.
 */
export async function stageAdminOutcome(matchId: string, outcome: AdminMatchOutcome): Promise<StagedAdminOutcome | null> {
  if ((await getMatchOutcome(matchId))?.kind === 'unresolved' && (await getMatchById(matchId))?.status === 'disputed') {
    throw new StagedOutcomeBlockedError('disputed');
  }
  const written = await recordMatchOutcome({
    matchId,
    kind: outcome.kind,
    p1Faints: null,
    p2Faints: null,
    source: 'admin',
    reason: outcome.reason,
    setBy: outcome.setBy,
    force: true,
    // A request that lost the race to a completed match must not overwrite the winner's row.
    openOnly: true,
  });
  if (written !== 'written') return null;
  try {
    const row = await getMatchOutcome(matchId);
    return row?.source === 'admin' ? { setAt: row.set_at } : null;
  } catch (error) {
    // The write stands; without its handle a later loss can only take it back without the `set_at` guard (logged).
    console.error(`[match-outcome] could not read back the staged outcome of match ${matchId}`, error);
    return null;
  }
}

/**
 * Takes back the outcome `stageAdminOutcome` wrote when the status write lost: the result it described never happened.
 * With the `staged` handle only that very row goes (a row another request wrote or rewrote since is theirs). The match
 * may have been completed meanwhile by a request with no admin intent (a player's confirmation, the auto-confirm): its
 * finalize replaces an admin row, but its outcome write may have run before ours landed or failed, so the played row is
 * written here once ours is gone (a no-op write when finalize already wrote it). A match that a replay-tie disputed meanwhile lost its `unresolved` row to ours (our forced
 * write replaced it, or the dispute's own write was kept out by ours): that row is put back, as a disputed match without it
 * would reach no check and score as a played one. Without a handle (the write stood but could not be read back) the
 * row goes unconditionally, the callers having ruled out a completed match, and a disputed match gets its `unresolved`
 * row back all the same; the played row is only written with a handle, as without one the row that went may be
 * another writer's.
 */
export async function discardStagedAdminOutcome(matchId: string, staged?: StagedAdminOutcome | null): Promise<void> {
  const deleted = await deleteMatchOutcome(matchId, staged ? { onlyIfSetAt: staged.setAt } : {});
  if (deleted === 0) return;
  const match = await getMatchById(matchId);
  if (match?.status === 'disputed') {
    await restoreUnresolvedOutcome(matchId);
    return;
  }
  if (!staged || match?.status !== 'completed') return;
  await recordPlayedOutcome(match, await getBattleStatsByMatch(matchId));
}

/** The row the replay-tie dispute writes (`disputeUnresolvedMatch`); never replaces an admin row. */
function restoreUnresolvedOutcome(matchId: string): Promise<RecordMatchOutcomeResult> {
  return recordMatchOutcome({
    matchId,
    kind: 'unresolved',
    p1Faints: null,
    p2Faints: null,
    source: 'replay',
    reason: 'replay_engine_tie',
    setBy: null,
    force: false,
  });
}

async function loadTournament(tournamentId: string): Promise<Tournament> {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
  return tournament;
}

function isEpbTournament(tournament: Tournament): tournament is Tournament & { season_id: string } {
  return Boolean(tournament.season_id) && isEvolutionPointBuy(tournament.season_format_type ?? '');
}

function isElimTournament(tournament: Tournament): boolean {
  return tournament.bracket_type === 'single_elim' || tournament.bracket_type === 'double_elim';
}

/**
 * EPB real kills: evolution
 * progress waits for the confirmed result, so the real kills of the match's
 * games are credited here, at completion, never at submission. Each game is
 * credited at most once (`games.evolution_applied_at`, set in the credit's own
 * transaction), so a finalize re-run or a heal credits nothing twice, and a
 * game credited at submission before 2026-10-20 carries the backfilled marker.
 * Runs before the matchday hooks: the hooks' Participation Token rule reads
 * the stage the kills reached, as the season rebuild does. A missing round is a
 * failure (the matchday is unknown). Returns the matchday for the hooks.
 */
async function runEpbRealKillsStep(
  match: MatchWithPlayers,
  seasonId: string,
  statsByGame: Record<string, BattleStat[]>
): Promise<number> {
  const round = await getRoundById(match.round_id);
  if (!round) throw new Error(`Round ${match.round_id} not found; EPB matchday unknown`);
  await creditMatchRealKills({
    seasonId,
    matchday: round.round_number,
    playerIds: [match.player_1_id, match.player_2_id],
    // Every game of the match (a game without stats is marked with no credit).
    gameIds: [...new Set([...match.games.map((game) => game.id), ...Object.keys(statsByGame)])],
    statsByGame,
  });
  return round.round_number;
}

/**
 * EPB matchday hooks (cosmo, stage recheck, lock, EP, snapshots). The
 * orchestrator rolls its own writes back and rethrows on failure. Runs after
 * `runEpbRealKillsStep`, which resolved the matchday.
 */
async function runEpbStep(
  match: MatchWithPlayers,
  seasonId: string,
  matchday: number,
  battleStats: BattleStat[]
): Promise<void> {
  await runEpbMatchdayHooks({
    match,
    seasonId,
    matchday,
    battleStats,
  });
}

async function runBracketStep(
  match: MatchWithPlayers,
  winnerId: string,
  tournament: Tournament
): Promise<void> {
  const participants = await getParticipants(match.tournament_id);
  await propagateBracketOnMatchComplete(
    { ...match, winner_id: winnerId, status: 'completed' },
    tournament,
    participants
  );
}

/**
 * Rating history must hold both players' rows for this match (heal `verify`).
 * True when both rows exist, and for a test-league match, which stays out of
 * ratings and has no rows to verify (`matchCountsForRatings`). A failed read
 * throws (transient: the heal retries next run); missing rows return false
 * (permanent until an admin rebuilds ratings). Logged once per heal attempt;
 * the cron pre-classifies such rows with `findMatchesNeedingAdmin` and does
 * not call the heal for them, so this line appears only when the rows
 * vanished between that check and the heal.
 */
async function ratingsApplied(match: MatchWithPlayers): Promise<boolean> {
  if (!matchCountsForRatings(match, await loadRatingScope())) return true;
  const history = await getRatingHistoryByMatch(match.id);
  if (hasBothRatingRows(match, history)) return true;
  console.error(
    `[match-heal] rating_history for match ${match.id} has ${history.length} of 2 rows; ` +
      'ratings are not re-applied automatically: an admin rebuilds them (season reconcile)'
  );
  return false;
}

function hasBothRatingRows(
  match: Pick<MatchWithPlayers, 'player_1_id' | 'player_2_id'>,
  history: readonly { player_id: string }[]
): boolean {
  const players = new Set(history.map((entry) => entry.player_id));
  return players.has(match.player_1_id) && players.has(match.player_2_id);
}

/** Why only an admin can finish a completed, unfinalized match. */
export type NeedsAdminReason = 'winner_not_participant' | 'ratings_missing';

/**
 * Classifies a page of the heal worklist up front, with ONE batched
 * rating_history read for the whole page: returns the matches the heal cannot
 * finish on its own (winner not a participant, or rating_history rows
 * missing; a test-league match expects none, see `ratingsApplied`), keyed by
 * match id. Everything else is healable. The cron uses this
 * to report needs-admin rows without spending a per-row read or a heal attempt
 * on them, and to page past them. A failed read throws (the run fails).
 *
 * The heal re-checks both conditions itself (`healMatchFinalization`), so a
 * row whose state changes between this read and the heal is still handled.
 */
export async function findMatchesNeedingAdmin(
  matches: readonly MatchWithPlayers[]
): Promise<Map<string, NeedsAdminReason>> {
  const result = new Map<string, NeedsAdminReason>();
  const withWinner: MatchWithPlayers[] = [];
  for (const match of matches) {
    const winnerId = match.winner_id;
    if (!winnerId || (winnerId !== match.player_1_id && winnerId !== match.player_2_id)) {
      result.set(match.id, 'winner_not_participant');
    } else {
      withWinner.push(match);
    }
  }
  if (withWinner.length === 0) return result;

  // Test-league matches stay out of ratings: no rows to look for.
  const scope = await loadRatingScope();
  const rated = withWinner.filter((match) => matchCountsForRatings(match, scope));
  if (rated.length === 0) return result;

  const history = await getRatingHistoryByMatches(rated.map((match) => match.id));
  const byMatch = new Map<string, { player_id: string }[]>();
  for (const row of history) {
    const rows = byMatch.get(row.match_id) ?? [];
    rows.push(row);
    byMatch.set(row.match_id, rows);
  }
  for (const match of rated) {
    if (!hasBothRatingRows(match, byMatch.get(match.id) ?? [])) {
      result.set(match.id, 'ratings_missing');
    }
  }
  return result;
}

function emitAnnouncements(input: {
  match: MatchWithPlayers;
  winnerId: string;
  tournament: Tournament;
  statsByGame: Record<string, BattleStat[]>;
  ratingChanges: RatingUpdateResult | null;
  streaks: { winner: StreakChanges; loser: StreakChanges } | null;
  achievements: { winner: EarnedAchievement[]; loser: EarnedAchievement[] } | null;
}): void {
  const { match, winnerId, tournament, statsByGame, ratingChanges, streaks, achievements } = input;

  const gameStats = buildGamePokemonStats(match, statsByGame);
  const pokScore = computePokemonScoreFromGameStats(
    gameStats,
    match.player_1_name,
    match.player_2_name
  );
  const replayUrl = match.games.find((game) => game.replay_url)?.replay_url;
  const winnerName = winnerId === match.player_1_id ? match.player_1_name : match.player_2_name;
  const loserName = winnerId === match.player_1_id ? match.player_2_name : match.player_1_name;

  const matchConfirmedPayload = {
    event_type: 'match_confirmed' as const,
    tournament_id: match.tournament_id,
    season_id: tournament.season_id,
    data: {
      kind: 'match_confirmed' as const,
      player_1_name: match.player_1_name,
      player_2_name: match.player_2_name,
      player_1_avatar_url: match.player_1_avatar_url,
      player_2_avatar_url: match.player_2_avatar_url,
      winner_name: winnerName,
      game_score: `${pokScore.p1}-${pokScore.p2}`,
      replay_url: replayUrl || undefined,
      tournament_name: tournament.name,
      game_stats: gameStats,
    },
  };
  void emitDiscordEvent(matchConfirmedPayload);
  void emitSocialEvent({
    ...matchConfirmedPayload,
    imageUrl: match.social_image_url || undefined,
  });

  for (const entry of [
    ...(achievements?.winner ?? []).map((achievement) => ({ achievement, player_name: winnerName })),
    ...(achievements?.loser ?? []).map((achievement) => ({ achievement, player_name: loserName })),
  ]) {
    if (entry.achievement.tier !== 'gold' && entry.achievement.tier !== 'platinum') {
      continue;
    }

    const achievementPayload = {
      event_type: 'achievement_unlocked' as const,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id,
      data: {
        kind: 'achievement_unlocked' as const,
        player_name: entry.player_name,
        achievement_name: entry.achievement.name,
        achievement_key: entry.achievement.key,
        achievement_tier: entry.achievement.tier,
        achievement_icon: entry.achievement.icon,
        achievement_description: entry.achievement.description,
        tournament_name: tournament.name,
      },
    };
    void emitDiscordEvent(achievementPayload);
    void emitSocialEvent(achievementPayload);
  }

  // The rebuilt streak can equal the stored one (a match that did not move it), so the milestone needs a real rise.
  if (
    streaks &&
    streaks.winner.win_streak.after >= 5 &&
    streaks.winner.win_streak.after % 5 === 0 &&
    streaks.winner.win_streak.after > streaks.winner.win_streak.before
  ) {
    const streakMilestonePayload = {
      event_type: 'streak_milestone' as const,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id,
      data: {
        kind: 'streak_milestone' as const,
        player_name: winnerName,
        streak_type: 'win' as const,
        streak_count: streaks.winner.win_streak.after,
        tournament_name: tournament.name,
      },
    };
    void emitDiscordEvent(streakMilestonePayload);
    void emitSocialEvent(streakMilestonePayload);
  }

  if (streaks && streaks.loser.win_streak.before >= 5 && streaks.loser.win_streak.after === 0) {
    const streakBrokenPayload = {
      event_type: 'streak_broken' as const,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id,
      data: {
        kind: 'streak_broken' as const,
        breaker_name: winnerName,
        broken_player_name: loserName,
        streak_count: streaks.loser.win_streak.before,
        tournament_name: tournament.name,
      },
    };
    void emitDiscordEvent(streakBrokenPayload);
    void emitSocialEvent(streakBrokenPayload);
  }

  if (!ratingChanges) return;

  const thresholds = [
    { rating: 1600, key: 'rising_star' },
    { rating: 1700, key: 'ace_trainer' },
    { rating: 1800, key: 'elite_four' },
    { rating: 1900, key: 'champion_tier' },
  ] as const;

  for (const threshold of thresholds) {
    if (
      ratingChanges.winnerRating >= threshold.rating &&
      (ratingChanges.winnerRating - ratingChanges.winnerChange) < threshold.rating
    ) {
      const ratingPayload = {
        event_type: 'rating_milestone' as const,
        tournament_id: match.tournament_id,
        season_id: tournament.season_id,
        data: {
          kind: 'rating_milestone' as const,
          player_name: winnerName,
          new_rating: ratingChanges.winnerRating,
          threshold: threshold.key,
          tournament_name: tournament.name,
        },
      };
      void emitDiscordEvent(ratingPayload);
      void emitSocialEvent(ratingPayload);
    }
  }
}

/** Stamp the marker; false when the match is no longer `completed` (reset meanwhile). */
async function markFinalized(runner: StepRunner, matchId: string): Promise<boolean> {
  const marked = await runner.run('mark_finalized', () => markMatchFinalized(matchId));
  if (!marked.ok) return false;
  if (!marked.value) {
    console.error(
      `[match-finalize] match ${matchId} is no longer completed; finalized_at not stamped`
    );
  }
  return marked.value;
}

export async function finalizeMatchCompletion({
  match,
  winnerId,
  previousStatus,
  adminOutcome,
}: FinalizeMatchCompletionInput): Promise<FinalizeMatchCompletionResult> {
  if (previousStatus === 'completed') {
    return { finalized: false, reason: 'already_completed' };
  }
  if (winnerId !== match.player_1_id && winnerId !== match.player_2_id) {
    return { finalized: false, reason: 'winner_not_participant' };
  }

  const runner = new StepRunner(match.id, 'finalize');
  const loserId = winnerId === match.player_1_id ? match.player_2_id : match.player_1_id;

  await runner.run('revalidate', () => revalidateMatchPages(match.tournament_id, match.id));

  const tournamentStep = await runner.run('tournament', () => loadTournament(match.tournament_id));
  const tournament = tournamentStep.ok ? tournamentStep.value : null;

  const ratingsStep = await runner.run('ratings', () =>
    updateRatings(winnerId, loserId, false, match.id)
  );

  const statsStep = await runner.run('battle_stats', () => getBattleStatsByMatch(match.id));
  const statsByGame = statsStep.ok ? statsStep.value : null;
  const flatStats = statsByGame ? Object.values(statsByGame).flat() : null;

  let outcomeRecorded = false;
  if (adminOutcome) {
    // Always rewrite the row with THIS request's outcome, even for a played result whose stats are unknown: the
    // staged row is not atomic with the status flip, so a concurrent request may have overwritten it between
    // staging and the flip, and only the request whose flip won knows the outcome that matches the winner.
    // A played result without stats gets null faints (healed once the stats read works) and keeps the format
    // hook blocked, as the faints are not known yet.
    const adminStep = await runner.run('outcome', () => recordAdminOutcome(match, adminOutcome, statsByGame));
    outcomeRecorded = adminStep.ok && (adminOutcome.kind !== 'played' || statsByGame !== null);
  } else if (statsByGame) {
    // No admin intent on this completion: a leftover staged admin row is replaced (see recordPlayedOutcome).
    outcomeRecorded = (await runner.run('outcome', () => recordPlayedOutcome(match, statsByGame, { replaceAdminRow: true }))).ok;
  } else {
    runner.blocked('outcome', 'battle_stats');
  }

  // Rebuilt from each player's whole history in one fenced write: two finalizations
  // sharing a player both end up counted, and a rerun lands on the same numbers.
  let streaks: { winner: StreakChanges; loser: StreakChanges } | null = null;
  const streakStep = await runner.run('streaks', async () => {
    const [winner, loser] = await Promise.all([recomputeStreaks(winnerId), recomputeStreaks(loserId)]);
    return { winner, loser };
  });
  if (streakStep.ok) streaks = streakStep.value;

  await runner.run('signatures', async () => {
    await Promise.all([updateSignatures(winnerId), updateSignatures(loserId)]);
  });

  let achievements: { winner: EarnedAchievement[]; loser: EarnedAchievement[] } | null = null;
  if (tournament) {
    const matchContext = {
      match_id: match.id,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id ?? null,
      winner_id: winnerId,
      loser_id: loserId,
      is_draw: false,
    };
    const achievementStep = await runner.run('achievements', async () => {
      const [winner, loser] = await Promise.all([
        checkAchievements(winnerId, matchContext),
        checkAchievements(loserId, matchContext),
      ]);
      return { winner, loser };
    });
    if (achievementStep.ok) achievements = achievementStep.value;
  } else {
    runner.blocked('achievements', 'tournament');
  }

  if (!tournament) {
    runner.blocked('announcements', 'tournament');
  } else if (!statsByGame) {
    runner.blocked('announcements', 'battle_stats');
  } else {
    await runner.run('announcements', () =>
      emitAnnouncements({
        match,
        winnerId,
        tournament,
        statsByGame,
        // A test-league match moved no rating: no milestone to announce.
        ratingChanges: ratingsStep.ok && ratingsStep.value.status === 'rated' ? ratingsStep.value : null,
        streaks,
        achievements,
      })
    );
  }

  // Evolution Point Buy (EPB seasons only): real kills of the now confirmed
  // result, then the matchday hooks. Independent of the rating / streak /
  // achievement steps above; the hooks need the kills step.
  if (!tournament) {
    runner.blocked('epb_real_kills', 'tournament');
    runner.blocked('epb_hooks', 'tournament');
  } else if (isEpbTournament(tournament)) {
    if (statsByGame && flatStats) {
      const kills = await runner.run('epb_real_kills', () =>
        runEpbRealKillsStep(match, tournament.season_id, statsByGame)
      );
      if (kills.ok) {
        await runner.run('epb_hooks', () => runEpbStep(match, tournament.season_id, kills.value, flatStats));
      } else {
        runner.blocked('epb_hooks', 'epb_real_kills');
      }
    } else {
      runner.blocked('epb_real_kills', 'battle_stats');
      runner.blocked('epb_hooks', 'battle_stats');
    }
  }

  // Bracket propagation for elimination formats (bracket integrity).
  let propagationFailed = false;
  if (!tournament) {
    runner.blocked('bracket_propagation', 'tournament');
  } else if (isElimTournament(tournament)) {
    const propagation = await runner.run('bracket_propagation', () =>
      runBracketStep(match, winnerId, tournament)
    );
    if (!propagation.ok) {
      propagationFailed = true;
      logAuditEvent({
        actor_id: null,
        actor_name: 'System',
        action: 'match.propagation_failed',
        resource_type: 'match',
        resource_id: match.id,
        resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
        metadata: {
          tournament_id: match.tournament_id,
          winner_id: winnerId,
        },
      });
    }
  }

  // The format runtime reads the outcome row (faints, forfeit): without it the event would fire with 0 faints and burn
  // its key, so a failed outcome step blocks it.
  // (Without the tournament the league is unknown; that failed step already keeps the marker unset.)
  if (tournament && isKitCandidate(tournament)) {
    if (outcomeRecorded) {
      await runner.run('format_hook', () => runFormatHook(match, winnerId, tournament));
    } else {
      runner.blocked('format_hook', 'outcome');
    }
  }

  let complete = false;
  if (runner.failed.length === 0) {
    complete = await markFinalized(runner, match.id);
  }

  if (runner.failed.length > 0) {
    const failed = [...runner.failed];
    logAuditEvent({
      actor_id: null,
      actor_name: 'System',
      action: 'match.finalize_failed',
      resource_type: 'match',
      resource_id: match.id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      metadata: {
        tournament_id: match.tournament_id,
        winner_id: winnerId,
        failed_steps: failed,
        // What the auto-confirm cron's heal does with each failed step once
        // the match is 10 minutes old (FINALIZE_HEAL_POLICY):
        // - healed_automatically: re-run by the heal.
        // - verified_by_heal: never re-applied, only checked (ratings). The
        //   heal finishes the match by itself when the rows exist (a failure
        //   after the write, e.g. a lost response); when they are missing the
        //   cron lists the match under needsAdmin and an admin rebuilds ratings.
        // - needs_admin: never re-run (achievements, announcements); an admin
        //   follows up.
        healed_automatically: failed.filter((step) => FINALIZE_HEAL_POLICY[step] === 'rerun'),
        verified_by_heal: failed.filter((step) => FINALIZE_HEAL_POLICY[step] === 'verify'),
        needs_admin: failed.filter((step) => FINALIZE_HEAL_POLICY[step] === 'not_rerun'),
      },
    });
  }

  return {
    finalized: true,
    complete,
    failed_steps: [...runner.failed],
    ...(propagationFailed ? { propagation_failed: true } : {}),
  };
}

/**
 * The heal's outcome step. A row an admin wrote (the result route stages it before the completion) is the admin's
 * intent and is rewritten from itself: a forfeit or no-show is left as it is, a played result gets its faints
 * recomputed from the battle stats. Any other match gets the played row. The heal cannot tell a leftover staged row
 * from an admin's completed result; the finalize of a completion without admin intent replaces such a row itself, so
 * only a failure of that very write can leave one for the heal to keep.
 */
async function healOutcome(match: MatchWithPlayers, statsByGame: Record<string, BattleStat[]>): Promise<void> {
  const existing = await getMatchOutcome(match.id);
  if (existing?.source !== 'admin') {
    await recordPlayedOutcome(match, statsByGame);
    return;
  }
  if (existing.kind === 'played') {
    await recordAdminOutcome(match, { kind: 'played', reason: existing.reason ?? '', setBy: existing.set_by }, statsByGame);
  }
}

/**
 * Heal a completed match whose finalize did not finish (`finalized_at` NULL):
 * verify ratings first (stopping there if they cannot be verified), then
 * re-run only the replay-safe steps; never re-run achievements or
 * announcements (FINALIZE_HEAL_POLICY). Stamps the marker only when all of
 * that succeeded; otherwise the match stays on the cron's worklist and the
 * failures are logged per step.
 */
export async function healMatchFinalization(
  match: MatchWithPlayers
): Promise<HealMatchFinalizationResult> {
  if (match.status !== 'completed') {
    return { healed: false, skipped: true, reason: 'not_completed', failed_steps: [] };
  }
  const winnerId = match.winner_id;
  if (!winnerId || (winnerId !== match.player_1_id && winnerId !== match.player_2_id)) {
    console.error(`[match-heal] completed match ${match.id} has no participant winner; cannot heal`);
    return { healed: false, needs_admin: true, reason: 'winner_not_participant', failed_steps: [] };
  }

  const runner = new StepRunner(match.id, 'heal');

  // Verify ratings first and stop on any failure: the steps below assume the
  // match counted (streaks, signatures, EPB, bracket), and a match whose
  // ratings never verify would otherwise replay them on every cron run.
  const ratingsStep = await runner.run('ratings', () => ratingsApplied(match));
  if (!ratingsStep.ok) {
    return { healed: false, failed_steps: [...runner.failed] };
  }
  if (!ratingsStep.value) {
    return { healed: false, needs_admin: true, reason: 'ratings_missing', failed_steps: ['ratings'] };
  }

  await runner.run('revalidate', () => revalidateMatchPages(match.tournament_id, match.id));
  const tournamentStep = await runner.run('tournament', () => loadTournament(match.tournament_id));
  const tournament = tournamentStep.ok ? tournamentStep.value : null;

  const statsStep = await runner.run('battle_stats', () => getBattleStatsByMatch(match.id));
  const statsByGame = statsStep.ok ? statsStep.value : null;
  let outcomeRecorded = false;
  if (statsByGame) {
    outcomeRecorded = (await runner.run('outcome', () => healOutcome(match, statsByGame))).ok;
  } else {
    runner.blocked('outcome', 'battle_stats');
  }

  // Rebuilt from the history: correct whether or not the first run's write landed.
  await runner.run('streaks', async () => {
    await recomputeStreaks(match.player_1_id);
    await recomputeStreaks(match.player_2_id);
  });

  await runner.run('signatures', async () => {
    await Promise.all([updateSignatures(match.player_1_id), updateSignatures(match.player_2_id)]);
  });

  if (!tournament) {
    runner.blocked('epb_real_kills', 'tournament');
    runner.blocked('epb_hooks', 'tournament');
    runner.blocked('bracket_propagation', 'tournament');
  } else {
    if (isEpbTournament(tournament)) {
      // Real kills first, always: every game is credited at most once (its
      // marker), so a re-run credits only the games the first run did not.
      if (statsByGame) {
        const kills = await runner.run('epb_real_kills', () =>
          runEpbRealKillsStep(match, tournament.season_id, statsByGame)
        );
        if (kills.ok) {
          // Snapshots are the hooks' last write and are rolled back with the
          // rest on failure, so existing snapshots mean the hooks already
          // completed: re-running them would overwrite the point-in-time
          // snapshots with today's tracker state.
          const snapshotsStep = await runner.run('epb_hooks', () => getMatchSnapshots(match.id));
          if (snapshotsStep.ok && snapshotsStep.value.length === 0) {
            const flatStats = Object.values(statsByGame).flat();
            await runner.run('epb_hooks', () => runEpbStep(match, tournament.season_id, kills.value, flatStats));
          }
        } else {
          runner.blocked('epb_hooks', 'epb_real_kills');
        }
      } else {
        runner.blocked('epb_real_kills', 'battle_stats');
        runner.blocked('epb_hooks', 'battle_stats');
      }
    }
    if (isElimTournament(tournament)) {
      await runner.run('bracket_propagation', () => runBracketStep(match, winnerId, tournament));
    }
    // The retry of a hook that failed (or never ran) at completion: its event key makes a second call a no-op.
    if (isKitCandidate(tournament)) {
      if (outcomeRecorded) {
        await runner.run('format_hook', () => runFormatHook(match, winnerId, tournament));
      } else {
        runner.blocked('format_hook', 'outcome');
      }
    }
  }

  if (runner.failed.length > 0) {
    return { healed: false, failed_steps: [...runner.failed] };
  }

  const marked = await markFinalized(runner, match.id);
  if (!marked) {
    if (runner.failed.length > 0) {
      return { healed: false, failed_steps: [...runner.failed] };
    }
    // Reset between the steps and the marker write: nothing left to heal.
    return { healed: false, skipped: true, reason: 'not_completed', failed_steps: [] };
  }

  logAuditEvent({
    actor_id: null,
    actor_name: 'System',
    action: 'match.finalize_healed',
    resource_type: 'match',
    resource_id: match.id,
    resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
    metadata: {
      tournament_id: match.tournament_id,
      winner_id: winnerId,
      // Never re-run by the heal: if the first run's audit event lists them as
      // failed, an admin follows up (achievements backfill; posts are lost).
      not_rerun: NOT_RERUN_STEPS,
    },
  });

  return { healed: true, failed_steps: [] };
}
