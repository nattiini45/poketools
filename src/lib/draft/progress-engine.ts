/**
 * Progress engine for Evolution Point Buy format.
 * Handles applying progress from various sources to evolution trackers.
 *
 * The progress sources stay separate (column map in `progress-sources.ts`): self-earned real kills (`real_kills`,
 * the only number shown as kills and used in public kill rankings),
 * `transferred_evo_progress`, Draft Kill Tokens (`draft_tokens`), Comeback
 * Tokens (`kill_tokens`) and Participation Tokens (`cosmo_points`). Every source is
 * 1:1 progress, except on a participation line: Comeback Tokens cost the pack's
 * `participationPoints.comebackTokensPerProgress` tokens per progress point, and its one Draft Kill Token
 * counts as (and costs) `participationPoints.draftKillTokensPerProgress` tokens for +1 progress.
 * League tuning (participation amount, comeback table and earn window, stage lock) comes
 * from the format pack (`@/lib/format-pack`).
 */

import {
  applyTrackerProgressWithLog,
  getLegacyTrackerByBase,
  getTrackerByLine,
  getPlayerTrackers,
  getSeasonTrackers,
  updateTracker,
} from '@/lib/supabase/queries/evolutions';
import { getTokenGrants } from '@/lib/supabase/queries/epb-token-grants';
import { fetchComebackTokenData, type ComebackEarnScope } from '@/lib/supabase/queries/epb-kill-tokens';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getHinrundeScope } from '@/lib/season/epb-phase';
import {
  getDraftPoolBySeason,
  getDraftPoolsBySeason,
  getDraftPoolsBySeasonWithGroups,
  getPicksByPool,
  GroupedLeaguePoolLookupError,
} from '@/lib/supabase/queries/drafts';
import { getSeasonGroupMembership } from '@/lib/supabase/queries/season-groups';
import { getRedraftHistory, getRedraftSlotRefunds } from '@/lib/supabase/queries/redraft';
import {
  getDraftTokenPurchases,
  purchaseDraftTokenRpc,
  type DraftTokenPurchaseResult,
} from '@/lib/supabase/queries/epb-draft-token-purchases';
import {
  getComebackTokenSpends,
  spendComebackTokensRpc,
  type ComebackAllocation,
  type ComebackSpendResult,
} from '@/lib/supabase/queries/epb-comeback-tokens';
import { getCosmoMatchdays } from '@/lib/supabase/queries/progress-log';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { DraftRuleError } from '@/lib/draft/errors';
import {
  comebackTokensPerProgressOf,
  draftKillTokensPerProgressOf,
  isCosmogLine,
  shouldAwardCosmoPoint,
} from '@/lib/draft/special-rules';
import { computeKillTokens, shouldSuspend, suspensionEndMatchday } from '@/lib/draft/point-buy-engine';
import { comebackEarnWindow, epbPack } from '@/lib/format-pack';
import { hasLineupEvidence, isLineBrought, type MatchLineupEvidence } from '@/lib/draft/epb-team-validation';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { isLineId, lineIdOfEntry } from '@/lib/draft/line-identity';
import { nextThresholdFor } from '@/lib/draft/tokens';
import { seasonRemainingPoints, type SeasonPointLedger } from '@/lib/draft/budget';
import { lineLookup } from '@/lib/match/epb-stage-resolution';
import { recheckEpbStages } from '@/lib/match/evolution-match-evaluator';
import { computePokemonScore } from '@/lib/match/aggregation';
import type { ProgressSourceType } from '@/types/format-rules';
import type { EpbTokenGrant } from '@/lib/supabase/queries/epb-token-grants';
import type { BattleStat } from '@/types/game';
import type { DraftPick, DraftPool } from '@/types/draft';
import type { EvolutionTracker, RedraftHistoryEntry } from '@/types/evolution';

// ── Core Progress Application ─────────────────────────────────────

/** Sources an admin correction may target: each maps to one tracker column. */
const COLUMN_SOURCES: ReadonlySet<ProgressSourceType> = new Set<ProgressSourceType>([
  'real_kill',
  'draft_token',
  'kill_token',
  'cosmo_point',
  'transferred',
]);

type ColumnSource = 'real_kill' | 'draft_token' | 'kill_token' | 'cosmo_point' | 'transferred';

function isColumnSource(source: ProgressSourceType): source is ColumnSource {
  return COLUMN_SOURCES.has(source);
}

/**
 * Find a player's tracker by line id (`teddiursa--ursalunabloodmoon`). A base
 * name (never line-id shaped) takes the legacy fallback: legacy evolution-tier
 * leagues keep trackers without a line id, one per base.
 */
async function findPlayerTracker(
  seasonId: string,
  playerId: string,
  lineIdOrBase: string
): Promise<EvolutionTracker | null> {
  return isLineId(lineIdOrBase)
    ? getTrackerByLine(seasonId, playerId, lineIdOrBase)
    : getLegacyTrackerByBase(seasonId, playerId, lineIdOrBase);
}

/** The `{pokemon}` param for a line reference: a line id's base species id, else the base name itself. */
function basePokemonOf(lineIdOrBase: string): string {
  return isLineId(lineIdOrBase) ? lineIdOrBase.slice(0, lineIdOrBase.indexOf('--')) : lineIdOrBase;
}

/**
 * Apply progress from a source to a specific tracker line (admin correction path).
 * `lineIdOrBase` is the line id; a base name is accepted for legacy evolution-tier leagues.
 * Tracker update + audit log run in one transaction (epb_apply_progress RPC).
 */
export async function applyProgress(
  seasonId: string,
  playerId: string,
  lineIdOrBase: string,
  source: ProgressSourceType,
  amount: number,
  matchday?: number | null,
  note?: string | null,
  createdBy?: string | null
): Promise<void> {
  if (amount === 0) return;

  const tracker = await findPlayerTracker(seasonId, playerId, lineIdOrBase);
  if (!tracker) {
    throw new UserFacingError(`No tracker found for ${lineIdOrBase}`, {
      status: 400,
      code: 'TRACKER_NOT_FOUND',
      params: { pokemon: basePokemonOf(lineIdOrBase) },
    });
  }

  if (!isColumnSource(source)) {
    // Corrections must target a concrete source column so the breakdown
    // stays accurate — column-less sources are rejected.
    throw new Error(`Progress source '${source}' does not map to a tracker column`);
  }

  await applyTrackerProgressWithLog(tracker.id, source, amount, {
    matchday: matchday ?? null,
    note: note ?? null,
    createdBy: createdBy ?? null,
  });
}

// ── Draft Kill Tokens ─────────────────────────────────────────────

/**
 * Draft Kill Tokens the line's one purchase counts as: the season's point-buy list entry (its stored
 * participation flag), else the pack's line rule for the tracker's base (the token overview's resolution).
 */
async function draftKillRateOf(pointBuyListId: string | null, lineId: string, trackerBase: string): Promise<number> {
  if (pointBuyListId) {
    const entry = (await getListEntries(pointBuyListId)).find((e) => lineIdOfEntry(e) === lineId);
    if (entry) return draftKillTokensPerProgressOf(entry);
  }
  return draftKillTokensPerProgressOf(trackerBase);
}

/**
 * Buy one Draft Kill Token for an owned line:
 * +1 progress for the season's token ratio in points, within the per-player and
 * per-line limits, never triggers an evolution, points never come back. On a
 * participation line the token counts as (and costs) the pack's
 * `draftKillTokensPerProgress` tokens (default: the comeback rate): the same
 * line resolution as the token overview (the season's list entry, else the base of
 * the player's tracker). The rules are re-checked by the `epb_purchase_draft_token`
 * RPC under the season lock; this wrapper supplies the line's next cumulative
 * threshold (league overrides of the format pack applied) and that rate. A purchase
 * never evolves a line, so no stage recheck.
 *
 * Rule refusals propagate as the RPC's PostgREST error (P0001 + `errors/draft`
 * code); the route maps them with `rpc-errors.ts`.
 */
export async function purchaseDraftKillToken(
  seasonId: string,
  pointBuyListId: string | null,
  playerId: string,
  lineId: string,
  requestId: string,
  actorId: string
): Promise<DraftTokenPurchaseResult> {
  const [tracker, lines] = await Promise.all([
    getTrackerByLine(seasonId, playerId, lineId),
    getSeasonLineThresholds(seasonId),
  ]);

  // No owned tracker: the RPC refuses with TRACKER_NOT_OWNED before it reads the threshold.
  let nextThreshold: number | null = null;
  let tokensPerProgress = 1;
  if (tracker) {
    tokensPerProgress = await draftKillRateOf(pointBuyListId, lineId, tracker.base_pokemon);
    const line = lineLookup(lines)(tracker);
    if (!line) {
      throw new Error(`No thresholds for line ${lineId} in season ${seasonId}`);
    }
    nextThreshold = nextThresholdFor(line, tracker.current_stage);
  }

  return purchaseDraftTokenRpc({
    seasonId,
    playerId,
    actorId,
    lineId,
    nextThreshold,
    clientRequestId: requestId,
    tokensPerProgress,
  });
}

// ── Comeback Tokens ───────────────────────────────────────────────

/** One completed match that earned its loser Comeback Tokens. */
export interface ComebackTokenEarning {
  player_id: string;
  match_id: string;
  /** EPB matchday (`rounds.round_number`). */
  matchday: number;
  /** Surviving-Pokémon score, loser first: "0:4". */
  score: string;
  /** The format pack's comeback table row for this score (`comebackTokensFromTable`). */
  tokens: number;
}

export interface EarnedComebackTokens {
  /** player id → Comeback Tokens earned this season (inside the pack's earn window). */
  byPlayer: Record<string, number>;
  /** Per-match earnings, ascending by matchday (TokenOverviewDTO `comeback.history`). */
  history: ComebackTokenEarning[];
}

/**
 * The matches that may earn Comeback Tokens, from the format pack's `epb.comeback.earnWindow`:
 * `season` → `{ scope: undefined }` (every completed match of the season); `first_half` → the
 * Hinrunde of the primary stage (`getHinrundeScope`, the same boundary as the redraft gate).
 * `null` = the window holds no round yet (no stage rounds, or a one-round stage).
 */
async function comebackEarnScope(seasonId: string): Promise<{ scope: ComebackEarnScope | undefined } | null> {
  if (comebackEarnWindow() === 'season') return { scope: undefined };
  const hinrunde = await getHinrundeScope(seasonId);
  if (!hinrunde || hinrunde.last_round < 1) return null;
  return { scope: hinrunde };
}

/**
 * Comeback Tokens earned per player from the completed matches inside the pack's earn window
 * (shutout losses, per the format pack's `epb.comeback.table`; `epb.comeback.earnWindow`
 * decides between the whole season and the first half). Computed on demand — no stored
 * counter to drift when matches are undone or corrected; the balance is earned − Σ
 * `epb_comeback_token_spends` (`comebackSpentTotal`, BR-5).
 */
export async function computeEarnedComebackTokens(seasonId: string): Promise<EarnedComebackTokens> {
  const earnScope = await comebackEarnScope(seasonId);
  if (earnScope === null) return { byPlayer: {}, history: [] };
  const { matches, statsByGame, gamesByMatch } = await fetchComebackTokenData(seasonId, earnScope.scope);
  const byPlayer: Record<string, number> = {};
  const history: ComebackTokenEarning[] = [];

  for (const match of matches) {
    const matchGameIds = gamesByMatch.get(match.id) ?? [];
    if (matchGameIds.length === 0) continue;

    const statsByGameRecord: Record<
      string,
      { player_id: string; pokemon_name: string; was_koed: boolean }[]
    > = {};
    for (const gameId of matchGameIds) {
      statsByGameRecord[gameId] = statsByGame.get(gameId) ?? [];
    }

    const loserId =
      match.winner_id === match.player_1_id ? match.player_2_id : match.player_1_id;
    const score = computePokemonScore(
      statsByGameRecord as Record<string, BattleStat[]>,
      match.player_1_id,
      match.player_2_id
    );

    const loserIsP1 = loserId === match.player_1_id;
    const loserSurvivors = loserIsP1 ? score.p1Score : score.p2Score;
    const winnerSurvivors = loserIsP1 ? score.p2Score : score.p1Score;

    const tokens = computeKillTokens(loserSurvivors, winnerSurvivors);
    if (tokens > 0) {
      byPlayer[loserId] = (byPlayer[loserId] ?? 0) + tokens;
      history.push({
        player_id: loserId,
        match_id: match.id,
        matchday: match.round_number,
        score: `${loserSurvivors}:${winnerSurvivors}`,
        tokens,
      });
    }
  }

  history.sort((a, b) => a.matchday - b.matchday);
  return { byPlayer, history };
}

/**
 * Comeback Tokens a player has already used: Σ `epb_comeback_token_spends.amount` (tokens, not
 * progress). There is no legacy stock: one-shot `kill_token` grants of
 * `epb_token_grants` are not counted. Twin of `v_spent` in `epb_spend_comeback_tokens`
 * (migration 20261018140000); the earned total stays separate.
 */
export function comebackSpentTotal(
  spends: ReadonlyArray<{ player_id: string; amount: number }>,
  playerId: string
): number {
  return spends.filter((s) => s.player_id === playerId).reduce((sum, s) => sum + s.amount, 0);
}

/**
 * Comeback Tokens per progress point of each allocated line (`comebackTokensPerProgressOf`), with
 * the token overview's line resolution: the season's point-buy list entry, else the base of the
 * player's tracker on that line (the pack's line rule for that base). A line with neither is
 * priced 1:1; the RPC refuses a line the player does not own (`TRACKER_NOT_OWNED`).
 */
async function comebackRatesByLine(
  seasonId: string,
  pointBuyListId: string | null,
  playerId: string,
  lineIds: readonly string[]
): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  if (pointBuyListId) {
    for (const entry of await getListEntries(pointBuyListId)) {
      rates.set(lineIdOfEntry(entry), comebackTokensPerProgressOf(entry));
    }
  }
  if (lineIds.every((lineId) => rates.has(lineId))) return rates;
  for (const tracker of await getPlayerTrackers(seasonId, playerId)) {
    if (tracker.line_id && lineIds.includes(tracker.line_id) && !rates.has(tracker.line_id)) {
      rates.set(tracker.line_id, comebackTokensPerProgressOf(tracker.base_pokemon));
    }
  }
  return rates;
}

/**
 * Spend Comeback Tokens on owned lines (BR-5): the earned total is computed
 * here from completed matches and passed to `epb_spend_comeback_tokens`, which
 * re-checks the balance, the spend window and ownership under the season lock.
 * Each allocation carries its line's tokens-per-progress rate (pack value on a participation
 * line, else 1): a count that is not a multiple of it is refused here and by the RPC
 * (`COMEBACK_TOKENS_NOT_MULTIPLE`). The balance stays in tokens.
 * Comeback progress may evolve a line, so the player's stages are re-resolved
 * right after (also on a replay: the recheck is idempotent).
 */
export async function spendComebackTokens(
  seasonId: string,
  pointBuyListId: string | null,
  playerId: string,
  allocations: readonly ComebackAllocation[],
  requestId: string,
  actorId: string
): Promise<ComebackSpendResult & { earned: number }> {
  const [{ byPlayer }, spends, rates] = await Promise.all([
    computeEarnedComebackTokens(seasonId),
    getComebackTokenSpends(seasonId, playerId),
    comebackRatesByLine(
      seasonId,
      pointBuyListId,
      playerId,
      allocations.map((a) => a.line_id)
    ),
  ]);
  const earned = byPlayer[playerId] ?? 0;
  const priced = allocations.map((a) => ({ line_id: a.line_id, count: a.count, ratio: rates.get(a.line_id) ?? 1 }));

  // Pre-check with the SQL rules (epb_spend_comeback_tokens): whole progress points per line,
  // then earned − Σ spends. A replay of an already-stored request skips it; the RPC answers replays.
  const isReplay = spends.some((s) => s.client_request_id === requestId);
  if (!isReplay) {
    const uneven = priced.find((a) => a.count % a.ratio !== 0);
    if (uneven) {
      throw new DraftRuleError('COMEBACK_TOKENS_NOT_MULTIPLE', { ratio: uneven.ratio });
    }
    const spent = comebackSpentTotal(spends, playerId);
    const requested = priced.reduce((sum, a) => sum + a.count, 0);
    const balance = earned - spent;
    if (balance < requested) {
      throw new DraftRuleError('COMEBACK_BALANCE_SHORT', { balance: Math.max(balance, 0) });
    }
  }

  const result = await spendComebackTokensRpc({
    seasonId,
    playerId,
    actorId,
    earnedTotal: earned,
    allocations: priced,
    clientRequestId: requestId,
  });

  await recheckEpbStages(seasonId, [playerId]);
  return { ...result, earned };
}

// ── Participation Tokens ──────────────────────────────────────────────────

/**
 * Award Cosmo (participation) Tokens for one matchday: +`participationPoints.perMatchday`
 * progress (format pack) on each of the player's participation lines (resolved by line id)
 * that was brought to the match.
 *
 * - Brought = a form of the line is in the player's registered team for the match
 *   (`match_prep_teams`), OR one of the player's battle rows names a form of it
 *   (`isLineBrought`). Battle data is not required: a registered team is enough.
 * - Neither a registered team nor an own battle row → no token, without any read.
 * - Not brought → no token.
 * - At or past the pack's `participationPoints.untilStage` → no token.
 * - At most one positive Participation Token row per tracker and matchday: skipped
 *   when any positive `cosmo_point` row exists for that matchday (dispute
 *   re-confirms, re-finalized matches). A reversal does not re-open the
 *   matchday; a re-award is an admin correction without a matchday.
 *   Concurrent finalizations are stopped by a partial unique index, whose
 *   violation counts as "already awarded".
 */
export async function awardCosmoPoint(
  seasonId: string,
  matchday: number,
  evidence: MatchLineupEvidence
): Promise<boolean> {
  if (!hasLineupEvidence(evidence)) return false;
  const { playerId } = evidence;

  const [trackers, lines] = await Promise.all([
    getPlayerTrackers(seasonId, playerId),
    getSeasonLineThresholds(seasonId),
  ]);
  const lineOf = lineLookup(lines);

  let awarded = false;
  for (const tracker of trackers) {
    const line = lineOf(tracker);
    if (!line || !isCosmogLine(line)) continue;
    if (!shouldAwardCosmoPoint(tracker.current_stage)) continue;
    if (!isLineBrought(line, evidence, tracker.locked_stage3_pokemon)) continue;

    const awardedMatchdays = await getCosmoMatchdays(tracker.id);
    if (awardedMatchdays.includes(matchday)) continue;

    try {
      await applyTrackerProgressWithLog(tracker.id, 'cosmo_point', epbPack.participationPoints.perMatchday, {
        matchday,
        note: epbPack.participationPoints.awardNote,
      });
    } catch (err) {
      // A concurrent finalization of the same matchday won the race: the
      // unique index rolled this call's increment back with its log row.
      if (isCosmoAwardDuplicate(err)) continue;
      throw err;
    }
    awarded = true;
  }

  return awarded;
}

/**
 * Partial unique index on evo_progress_log (tracker_id, matchday) for positive
 * `cosmo_point` rows (migration 20261012094028_draft_review_fixes.sql). The
 * read above (`getCosmoMatchdays`) is only a fast path over the same predicate;
 * this index is the race-proof guarantee.
 */
const COSMO_AWARD_UNIQUE_INDEX = 'evo_progress_log_cosmo_matchday_uniq';

function isCosmoAwardDuplicate(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return code === '23505' && typeof message === 'string' && message.includes(COSMO_AWARD_UNIQUE_INDEX);
}

// ── Early Stage-3 Lock ────────────────────────────────────────────

/**
 * Check and apply the early stage lock (format pack `epb.stageLock`) for trackers in a season.
 * A line that reached the lock stage by the lock matchday is suspended for the next
 * `suspendMatchdays` matchdays (`shouldSuspend`, `suspensionEndMatchday`). Nothing happens
 * when the pack disables the lock.
 * When `playerIds` is provided, only those players' trackers are considered
 * (match-finalize path — avoids touching unrelated concurrent pairings).
 */
export async function checkEarlyStage3Lock(
  seasonId: string,
  matchday: number,
  playerIds?: string[]
): Promise<string[]> {
  if (!epbPack.stageLock.enabled) return [];
  const trackers = await getSeasonTrackers(seasonId);
  const playerFilter =
    playerIds && playerIds.length > 0 ? new Set(playerIds) : null;
  const suspended: string[] = [];

  for (const tracker of trackers) {
    if (playerFilter && !playerFilter.has(tracker.player_id)) continue;
    if (shouldSuspend(tracker.current_stage, matchday)) {
      // Only suspend if not already suspended
      if (tracker.suspended_until_matchday === null) {
        const suspendUntil = suspensionEndMatchday(matchday);
        await updateTracker(tracker.id, { suspended_until_matchday: suspendUntil });
        suspended.push(tracker.base_pokemon);
      }
    }
  }

  return suspended;
}

// ── Season points ledger (one read per source) ───────────────────

/** A pick as the ledger counts it: void picks and picks of cancelled pools cost nothing. */
export type LedgerPick = Pick<DraftPick, 'player_id' | 'points_spent'> & {
  voided_at?: string | null;
  pool_cancelled?: boolean;
};

/**
 * Everything the season points ledger reads, loaded once for a whole season
 * (all players). The draft state route polls every participant's token math
 * once the pool is complete; reading this ledger once replaces the per-player
 * reads. `computeRemainingPointsFromLedger` turns it into the
 * `seasonRemainingPoints` input (budget.ts, twin of `epb__season_remaining_points`).
 */
export interface DraftTokenLedger {
  /** Picks of every pool of the season; null when the season has no pool. */
  picks: ReadonlyArray<LedgerPick> | null;
  /**
   * The season's legacy one-shot draft_token grants (all players). Legacy `kill_token` grants
   * are not read: there is no legacy Comeback stock.
   */
  draftGrants: ReadonlyArray<Pick<EpbTokenGrant, 'player_id' | 'token_count'>>;
  /** The season's redraft history (all players): legacy redraft and retired-trade spends (history). */
  redrafts: ReadonlyArray<Pick<RedraftHistoryEntry, 'player_id' | 'points_spent'>>;
  /** Draft Kill Token purchases (`epb_draft_token_purchases`): points permanently spent. */
  draftTokenPurchases: ReadonlyArray<{ player_id: string; points_spent: number }>;
  /** Redraft-slot refunds (`redraft_slots.dropped_price`): a dropped line's price comes back. */
  redraftRefunds: ReadonlyArray<{ player_id: string; dropped_price: number }>;
  /** The initial pool's `point_budget`; null → the caller's `format_rules.draft_budget`. */
  initialPoolBudget: number | null;
  /**
   * League groups only (absent in a league without groups): each trainer's group's initial pool `point_budget`
   * (null → `format_rules.draft_budget`), the twin of `epb__season_remaining_points`' group base.
   */
  initialPoolBudgetByPlayer?: Readonly<Record<string, number | null>>;
}

type KnownPool = Pick<DraftPool, 'id' | 'season_id'> &
  Partial<Pick<DraftPool, 'point_budget' | 'phase' | 'kind' | 'season_group_id'>>;

function toLedgerPicks(
  picks: ReadonlyArray<LedgerPick>,
  poolCancelled: boolean
): LedgerPick[] {
  return picks.map((p) => ({
    player_id: p.player_id,
    points_spent: p.points_spent,
    voided_at: p.voided_at ?? null,
    pool_cancelled: poolCancelled || p.pool_cancelled === true,
  }));
}

/**
 * Read the ledger with one query per source: the initial pool and its picks,
 * legacy grants, Draft Kill Token purchases, redraft history and redraft-slot
 * refunds. Picks of a redraft pool are read only when the season has redraft
 * slots (a redraft pool without drops has no picks).
 *
 * `known` lets a caller that already holds the season's INITIAL pool and its
 * picks skip re-reading them (a redraft pool passed as `known` is ignored: the
 * initial pool carries the budget). The initial pool is the season's oldest
 * pool (`getDraftPoolBySeason`).
 *
 * A league with groups has one initial pool per group (`getDraftPoolBySeason` refuses it): the ledger then reads
 * every pool with its group and the membership (`loadGroupedDraftTokenLedger`), and each trainer's base budget is
 * their group's initial pool. A league without groups reads exactly what it read before.
 */
export async function loadDraftTokenLedger(
  seasonId: string,
  known?: {
    pool: KnownPool;
    picks: ReadonlyArray<LedgerPick>;
  }
): Promise<DraftTokenLedger> {
  if (known && known.pool.season_id === seasonId && known.pool.season_group_id != null) {
    return loadGroupedDraftTokenLedger(seasonId);
  }
  const reuse =
    known && known.pool.season_id === seasonId && (known.pool.kind ?? 'initial') === 'initial'
      ? known
      : null;

  let sources: [
    { pool: KnownPool; picks: ReadonlyArray<LedgerPick> } | null,
    DraftTokenLedger['draftGrants'],
    DraftTokenLedger['redrafts'],
    Awaited<ReturnType<typeof getDraftTokenPurchases>>,
    Awaited<ReturnType<typeof getRedraftSlotRefunds>>,
  ];
  try {
    sources = await Promise.all([
      reuse
        ? Promise.resolve<{ pool: KnownPool; picks: ReadonlyArray<LedgerPick> } | null>(reuse)
        : getDraftPoolBySeason(seasonId).then(async (pool) =>
            pool ? { pool, picks: await getPicksByPool(pool.id) } : null
          ),
      getTokenGrants(seasonId, 'draft_token'),
      getRedraftHistory(seasonId),
      getDraftTokenPurchases(seasonId),
      getRedraftSlotRefunds(seasonId),
    ]);
  } catch (err) {
    // The one expected refusal: the league has groups. Every other error propagates unchanged.
    if (err instanceof GroupedLeaguePoolLookupError) return loadGroupedDraftTokenLedger(seasonId);
    throw err;
  }
  const [initial, draftGrants, redrafts, purchases, refunds] = sources;

  let picks: LedgerPick[] | null = initial
    ? toLedgerPicks(initial.picks, initial.pool.phase === 'cancelled')
    : null;

  const otherPoolIds = [...new Set(refunds.map((r) => r.draft_pool_id))].filter(
    (id) => id !== initial?.pool.id
  );
  if (otherPoolIds.length > 0) {
    const [pools, ...poolPicks] = await Promise.all([
      getDraftPoolsBySeason(seasonId),
      ...otherPoolIds.map((id) => getPicksByPool(id)),
    ]);
    const cancelled = new Set(pools.filter((p) => p.phase === 'cancelled').map((p) => p.id));
    picks = [
      ...(picks ?? []),
      ...otherPoolIds.flatMap((id, i) => toLedgerPicks(poolPicks[i] ?? [], cancelled.has(id))),
    ];
  }

  return {
    picks,
    draftGrants,
    redrafts,
    draftTokenPurchases: purchases.map((p) => ({ player_id: p.player_id, points_spent: p.points_spent })),
    redraftRefunds: refunds.map((r) => ({ player_id: r.player_id, dropped_price: r.dropped_price })),
    initialPoolBudget: initial?.pool.point_budget ?? null,
  };
}

/**
 * The ledger of a league with groups: every pool with its group (one query) and the membership (one query), the
 * picks of every initial pool and of the redraft pools that have drops, plus the season-wide sources. A trainer's
 * picks live only in their own group's pools, so the season-wide pick and token sums stay per trainer; only the base
 * budget is per group (`initialPoolBudgetByPlayer`).
 */
async function loadGroupedDraftTokenLedger(seasonId: string): Promise<DraftTokenLedger> {
  const [pools, membership, draftGrants, redrafts, purchases, refunds] = await Promise.all([
    getDraftPoolsBySeasonWithGroups(seasonId),
    getSeasonGroupMembership(seasonId),
    getTokenGrants(seasonId, 'draft_token'),
    getRedraftHistory(seasonId),
    getDraftTokenPurchases(seasonId),
    getRedraftSlotRefunds(seasonId),
  ]);
  const initials = pools.filter((p) => p.kind === 'initial');
  const refundPoolIds = new Set(refunds.map((r) => r.draft_pool_id));
  const pickPools = pools.filter((p) => p.kind === 'initial' || refundPoolIds.has(p.id));
  const poolPicks = await Promise.all(pickPools.map((p) => getPicksByPool(p.id)));
  const picks = pickPools.flatMap((p, i) => toLedgerPicks(poolPicks[i] ?? [], p.phase === 'cancelled'));

  const budgetByGroup = new Map<string, number | null>();
  for (const p of initials) if (p.season_group_id !== null) budgetByGroup.set(p.season_group_id, p.point_budget);
  const initialPoolBudgetByPlayer: Record<string, number | null> = {};
  for (const [playerId, groupId] of Object.entries(membership)) {
    initialPoolBudgetByPlayer[playerId] = budgetByGroup.get(groupId) ?? null;
  }

  return {
    picks: initials.length > 0 ? picks : null,
    draftGrants,
    redrafts,
    draftTokenPurchases: purchases.map((p) => ({ player_id: p.player_id, points_spent: p.points_spent })),
    redraftRefunds: refunds.map((r) => ({ player_id: r.player_id, dropped_price: r.dropped_price })),
    initialPoolBudget: null,
    initialPoolBudgetByPlayer,
  };
}

/** The `seasonRemainingPoints` input for a loaded ledger (budget = initial pool budget, else `budget`). */
export function toSeasonPointLedger(
  ledger: DraftTokenLedger,
  budget: number,
  tokenRatio: number
): SeasonPointLedger {
  const byPlayer = ledger.initialPoolBudgetByPlayer;
  return {
    initialBudget: ledger.initialPoolBudget ?? budget,
    ...(byPlayer
      ? {
          initialBudgetByPlayer: Object.fromEntries(
            Object.entries(byPlayer).map(([playerId, b]) => [playerId, b ?? budget])
          ),
        }
      : {}),
    tokenRatio,
    picks: (ledger.picks ?? []).map((p) => ({
      player_id: p.player_id,
      points_spent: p.points_spent ?? null,
      voided: Boolean(p.voided_at),
      pool_cancelled: p.pool_cancelled === true,
    })),
    legacyDraftTokenGrants: ledger.draftGrants,
    draftTokenPurchases: ledger.draftTokenPurchases,
    legacyRedraftSpend: ledger.redrafts,
    redraftRefunds: ledger.redraftRefunds,
  };
}

/**
 * A player's unspent season points from a ledger (`seasonRemainingPoints`):
 * initial budget − non-void picks of non-cancelled pools − legacy grant tokens ×
 * ratio − Draft Kill Token purchases − legacy redraft spends + redraft refunds.
 * The full budget when the season has no pool.
 */
export function computeRemainingPointsFromLedger(
  ledger: DraftTokenLedger,
  playerId: string,
  budget: number,
  tokenRatio: number
): number {
  if (!ledger.picks) return budget;
  return seasonRemainingPoints(toSeasonPointLedger(ledger, budget, tokenRatio), playerId);
}

/**
 * Compute a player's remaining points server-side (one ledger read; see
 * `computeRemainingPointsFromLedger`). Never trust a client-supplied
 * remaining_points.
 */
export async function computeRemainingPoints(
  seasonId: string,
  playerId: string,
  budget: number,
  tokenRatio: number
): Promise<number> {
  const ledger = await loadDraftTokenLedger(seasonId);
  return computeRemainingPointsFromLedger(ledger, playerId, budget, tokenRatio);
}

/**
 * Check whether legacy one-shot draft tokens were already allocated for a player.
 * Grant-based — redraft-proof.
 */
export async function hasAllocatedDraftTokens(
  seasonId: string,
  playerId: string
): Promise<boolean> {
  const grants = await getTokenGrants(seasonId, 'draft_token');
  return grants.some((g) => g.player_id === playerId);
}

/** Pure twin of hasAllocatedDraftTokens, fed by a ledger. */
export function hasAllocatedDraftTokensFromLedger(
  ledger: DraftTokenLedger,
  playerId: string
): boolean {
  return ledger.draftGrants.some((g) => g.player_id === playerId);
}
