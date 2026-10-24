/**
 * Evolution Point Buy match evaluator.
 * Owns real-kill credit and stage resolution for the evolution_point_buy
 * format.
 *
 * Real kills wait for the confirmed result: match finalize (`src/lib/match/finalize.ts`, step
 * `epb_real_kills`) credits each game of a COMPLETED match exactly once,
 * marked per game by `games.evolution_applied_at` with what was credited in
 * `games.evolution_credits` (`creditMatchRealKills`). Game submission credits
 * nothing. An admin game edit reverses a credited game by that ledger
 * (`uncreditGameRealKills`); delete and reset rebuild the season
 * (`repairSeasonEvolution`), which re-syncs markers and ledgers.
 *
 * For evolution_point_buy seasons this module OWNS tracker progress and stage
 * resolution. The legacy checkPlayerEvolutions engine must NOT run for this
 * format — it re-derives total_kos from battle_stats alone and would erase
 * token/cosmo contributions.
 */

import {
  getSeasonTrackers,
  updateTracker,
  creditGameKills,
  uncreditGameKills,
  type GameKillCredit,
  type GameKillCreditOutcome,
  type GameKillDebitOutcome,
} from '@/lib/supabase/queries/evolutions';
import { insertEvolutionEvents } from '@/lib/supabase/queries/evolution-events';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { lineLookup, type LineThresholds } from '@/lib/match/epb-stage-resolution';
import {
  applyKillDelta,
  applyStageTransitions,
  buildFormToTrackerIndex,
  type KillStat,
} from '@/lib/match/epb-tracker-apply';
import type { EvolutionEvent, EvolutionTracker } from '@/types/evolution';

export type { LineThresholds };

/**
 * One game's real-kill credits: its battle_stats rows matched against ALL
 * forms of each tracked line (base, stage 2, stage 3: a line that already
 * evolved records KOs under its evolved form), zero and negative KO rows
 * dropped, summed per tracker (one entry each) and sorted by tracker id, so
 * concurrent credits take the tracker row locks in one order. Rows of an
 * untracked Pokémon credit nothing. Pure.
 */
export function buildGameKillCredits(
  stats: readonly KillStat[],
  formToTracker: ReadonlyMap<string, EvolutionTracker>
): GameKillCredit[] {
  const byTracker = new Map<string, number>();
  for (const stat of applyKillDelta([...stats], 1)) {
    const tracker = formToTracker.get(`${stat.player_id}::${stat.pokemon_name}`);
    if (!tracker) continue;
    byTracker.set(tracker.id, (byTracker.get(tracker.id) ?? 0) + stat.kos_dealt);
  }
  return [...byTracker.entries()]
    .map(([tracker_id, amount]) => ({ tracker_id, amount }))
    .sort((a, b) => (a.tracker_id < b.tracker_id ? -1 : a.tracker_id > b.tracker_id ? 1 : 0));
}

export interface MatchKillCreditInput {
  seasonId: string;
  /** The match's `rounds.round_number` (the SQL side logs the credit on the same matchday). */
  matchday: number;
  playerIds: readonly [string, string];
  /** Every game of the match, with or without stats (a game without stats is marked with no credit). */
  gameIds: readonly string[];
  /** The games' battle_stats, keyed by game id (`getBattleStatsByMatch`). */
  statsByGame: Readonly<Record<string, readonly KillStat[]>>;
}

export interface MatchKillCreditResult {
  /** Games credited by this call. */
  applied: string[];
  /** Games already credited (finalize re-run, heal, or a game credited at submission before 2026-10-20). */
  alreadyApplied: string[];
  /** Games refused because the match is no longer completed (reset or edited meanwhile). */
  notCompleted: string[];
  /** Games that no longer exist. */
  missing: string[];
  /** Stage transitions resolved after the credit (persisted as evolution events). */
  events: EvolutionEvent[];
}

/**
 * Credit the real kills of a completed match's games, each game exactly once
 * (`creditGameKills`: tracker increments, `evo_progress_log` rows and the
 * game's `evolution_applied_at` marker in one transaction per game), then
 * resolve the players' stages from the new totals (`recheckEpbStages`,
 * events on this matchday). Replay-safe: a credited game answers
 * 'already_applied' and writes nothing, and the stage recheck is state-based,
 * so a re-run after a failure anywhere in here finishes the job without
 * counting a game twice. A thrown error leaves every game that was not yet
 * credited uncredited (the per-game transaction rolled back).
 */
export async function creditMatchRealKills(input: MatchKillCreditInput): Promise<MatchKillCreditResult> {
  const result: MatchKillCreditResult = {
    applied: [],
    alreadyApplied: [],
    notCompleted: [],
    missing: [],
    events: [],
  };
  const gameIds = [...new Set(input.gameIds)].sort();
  if (gameIds.length === 0) return result;

  const [trackers, lines] = await Promise.all([
    getSeasonTrackers(input.seasonId),
    getSeasonLineThresholds(input.seasonId),
  ]);
  const formToTracker = buildFormToTrackerIndex(trackers, lines);

  for (const gameId of gameIds) {
    const credits = buildGameKillCredits(input.statsByGame[gameId] ?? [], formToTracker);
    const outcome: GameKillCreditOutcome = await creditGameKills(gameId, credits);
    switch (outcome) {
      case 'applied':
        result.applied.push(gameId);
        break;
      case 'already_applied':
        result.alreadyApplied.push(gameId);
        break;
      case 'match_not_completed':
        result.notCompleted.push(gameId);
        break;
      case 'game_missing':
        result.missing.push(gameId);
        break;
    }
  }

  if (result.notCompleted.length > 0) {
    console.error(
      `[epb-real-kills] ${result.notCompleted.length} game(s) not credited: the match left completed ` +
        `(reset or edited) while it was being finalized; its next completion credits them`,
      result.notCompleted
    );
  }

  if (result.applied.length > 0 || result.alreadyApplied.length > 0) {
    result.events = await recheckEpbStages(input.seasonId, [...input.playerIds], {
      matchday: input.matchday,
    });
  }
  return result;
}

/**
 * Reverse a credited game's real kills (admin game edit), fenced on the
 * marker read in `game` (`uncreditGameKills`). The database debits the game's
 * credit ledger (`games.evolution_credits`): exactly the amounts credited, to
 * the trackers that got them, even after a redraft or trade changed which
 * tracker a form maps to (a tracker retired since is skipped: its kills were
 * carried into the replacement's transferred_evo_progress). The debits built
 * here from `stats` (read together with `game`) and today's form → tracker
 * index are used only for a legacy marker without a ledger (a game credited
 * before 2026-10-21 whose season was not rebuilt since). A game without the
 * marker answers 'not_applied' without a call. Stages are not resolved here:
 * the caller rechecks them after all of its writes.
 */
export async function uncreditGameRealKills(
  seasonId: string,
  game: { id: string; evolution_applied_at?: string | null },
  stats: readonly KillStat[]
): Promise<GameKillDebitOutcome> {
  if (!game.evolution_applied_at) return 'not_applied';
  const [trackers, lines] = await Promise.all([
    getSeasonTrackers(seasonId),
    getSeasonLineThresholds(seasonId),
  ]);
  const debits = buildGameKillCredits(stats, buildFormToTrackerIndex(trackers, lines));
  return uncreditGameKills(game.id, game.evolution_applied_at, debits);
}

/**
 * Re-resolve EPB tracker stages from current total_kos (used after undo/
 * rollback and admin corrections). Does NOT touch total_kos or source
 * columns — only form/stage. Transitions are persisted as development
 * events (is_manual for admin corrections).
 */
export async function recheckEpbStages(
  seasonId: string,
  playerIds: string[],
  opts: { matchday?: number | null; isManual?: boolean } = {}
): Promise<EvolutionEvent[]> {
  const [allTrackers, lines] = await Promise.all([
    getSeasonTrackers(seasonId),
    getSeasonLineThresholds(seasonId),
  ]);

  const lineOf = lineLookup(lines);

  const trackers = allTrackers.filter((t) => playerIds.includes(t.player_id));
  const events: EvolutionEvent[] = [];

  for (const tracker of trackers) {
    const line = lineOf(tracker);
    if (!line) continue;

    const transitions = applyStageTransitions(tracker, line);
    if (transitions.length === 0) continue;

    events.push(...transitions);

    await updateTracker(tracker.id, {
      current_form: tracker.current_form,
      current_stage: tracker.current_stage,
      evolved_at: new Date().toISOString(),
    });
  }

  try {
    await insertEvolutionEvents(events, {
      season_id: seasonId,
      matchday: opts.matchday ?? null,
      is_manual: opts.isManual ?? false,
    });
  } catch (err) {
    console.error('Failed to persist evolution events (stage recheck already applied)', err);
  }

  return events;
}

// Matchday side effects (participation tokens, early stage-3 lock, evolution
// points) are owned by src/lib/match/epb-matchday.ts, called from finalize.
