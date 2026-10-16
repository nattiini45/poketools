/**
 * Token overview of the EvoLiga token routes (draft-backend §8.1 #25–#27, §10.3; SPEC Prompt 7).
 * Server only.
 *
 * Three separate token kinds, never one generic "kill token":
 * - Draft Kill Token: bought with unspent points after the initial draft (`format_rules` token
 *   ratio and caps), +1 progress, never triggers an evolution (`epb_purchase_draft_token`).
 * - Comeback Token: earned by shutout losses (the format pack's `epb.comeback.table`), spent on own
 *   lines once the redraft is complete or the admin opened spending (`epb_spend_comeback_tokens`).
 * - Participation Token: the participation line's +1 per matchday it was brought (awarded by the match engine).
 *
 * `loadTokenSeasonContext` does every read once for a season (optionally scoped to one player);
 * `buildTokenOverview` is pure and builds one player's `TokenOverviewDTO` from it, so the admin
 * overview (#25b) costs the same reads as a single player's. The DTO carries ids and numbers
 * only — no player row ever reaches it.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { effectiveThresholds } from '@/lib/draft/line-catalog-data';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import {
  comebackSpentTotal,
  computeEarnedComebackTokens,
  computeRemainingPointsFromLedger,
  loadDraftTokenLedger,
  type DraftTokenLedger,
  type EarnedComebackTokens,
} from '@/lib/draft/progress-engine';
import { progressSourcesOf, totalEligibleProgress } from '@/lib/draft/progress-sources';
import { isCosmogLine } from '@/lib/draft/special-rules';
import {
  comebackBalance,
  comebackSpendOpen,
  draftKillLineRefusal,
  draftKillTokenWindow,
  nextThresholdFor,
} from '@/lib/draft/tokens';
import { getDraftPoolBySeason, getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
import { getComebackTokenSpends, type ComebackTokenSpend } from '@/lib/supabase/queries/epb-comeback-tokens';
import { getDraftTokenPurchases, type DraftTokenPurchase } from '@/lib/supabase/queries/epb-draft-token-purchases';
import { getPlayerTrackers, getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getPlayerIdsWithCompletedMatches } from '@/lib/supabase/queries/matches';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getCosmoMatchdays } from '@/lib/supabase/queries/progress-log';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { assertEpbSeason } from '@/lib/season/format-utils';
import { epbPack } from '@/lib/format-pack';
import type { DraftPhase, LineId, TokenOverviewDTO } from '@/types/draft-queue';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { Season } from '@/types/season';

/** Defaults of `format_rules` (the format pack's `epb.defaults`, used when a season has no row yet). */
const DEFAULT_BUDGET = epbPack.defaults.draftBudget;
const DEFAULT_TOKEN_RATIO = epbPack.defaults.tokenRatio;
const DEFAULT_TOKEN_MAX = epbPack.defaults.tokenMax;

/** Everything a token overview reads, loaded once per request. */
export interface TokenSeasonContext {
  seasonId: string;
  budget: number;
  /** Points per Draft Kill Token (`format_rules.draft_token_ratio`). */
  cost: number;
  /** Draft Kill Tokens per player (`format_rules.draft_token_max`). */
  max: number;
  /** `format_rules.comeback_spend_open` (admin switch for seasons without a redraft). */
  comebackAdminOpened: boolean;
  initialPhase: DraftPhase | null;
  /** The initial pool's explicit purchase cutoff; null = default cutoff (first confirmed result). */
  closesAt: string | null;
  redraftComplete: boolean;
  anyLeagueMatchConfirmed: boolean;
  /** List entries by line id (league overrides are applied when thresholds are derived). */
  entriesByLine: ReadonlyMap<LineId, PointBuyListEntry>;
  ledger: DraftTokenLedger;
  earned: EarnedComebackTokens;
  spends: readonly ComebackTokenSpend[];
  purchases: readonly DraftTokenPurchase[];
  trackers: readonly EvolutionTracker[];
  /** Participation-line tracker id → matchdays a Participation Token was awarded. */
  cosmoMatchdays: ReadonlyMap<string, number[]>;
}

/** The season fields the loader needs (a `getSeasonById` result after `assertEpbSeason`). */
export type TokenSeason = Pick<Season, 'id' | 'point_buy_list_id'>;

/** The league, refused unless it exists and plays Evolution Point Buy (`season_not_found` / `format_mismatch`). */
export async function getEpbSeason(seasonId: string): Promise<TokenSeason> {
  const season = await getSeasonById(seasonId);
  assertEpbSeason(season);
  // assertEpbSeason throws for a missing season; this narrows the type.
  if (!season) throw new UserFacingError('Season not found', { code: 'season_not_found', status: 404 });
  return { id: season.id, point_buy_list_id: season.point_buy_list_id };
}

/** Parse a JSON body; malformed JSON is the caller's 400 (`errors/common` `invalid_json`), not a 500. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (err) {
    console.error('[api/seasons/tokens] malformed JSON body:', err);
    throw new UserFacingError('Invalid JSON body', { code: 'invalid_json', status: 400 });
  }
}

function indexEntries(entries: readonly PointBuyListEntry[]): Map<LineId, PointBuyListEntry> {
  const byLine = new Map<LineId, PointBuyListEntry>();
  for (const entry of entries) byLine.set(lineIdOfEntry(entry), entry);
  return byLine;
}

/**
 * The tracker's line id. Trackers created before the line-id backfill fall back to the one list
 * entry with the same base (never guessed when two branches share it).
 */
export function trackerLineId(
  tracker: Pick<EvolutionTracker, 'line_id' | 'base_pokemon'>,
  entriesByLine: ReadonlyMap<LineId, PointBuyListEntry>,
): LineId | null {
  if (tracker.line_id) return tracker.line_id;
  let found: LineId | null = null;
  for (const [lineId, entry] of entriesByLine) {
    if (entry.base_pokemon !== tracker.base_pokemon) continue;
    if (found !== null) return null;
    found = lineId;
  }
  return found;
}

/** Default cutoff of the Draft Kill Token window: is any match of the league confirmed? */
async function hasConfirmedLeagueMatch(seasonId: string): Promise<boolean> {
  const stages = await getStagesBySeasonId(seasonId);
  if (stages.length === 0) return false;
  const players = await getPlayerIdsWithCompletedMatches(stages.map((s) => s.id));
  return players.size > 0;
}

/**
 * Read everything a token overview needs, once. With `playerId` the per-player tables
 * (trackers, purchases, spends) are read for that player only; without it, for the whole season.
 */
export async function loadTokenSeasonContext(season: TokenSeason, playerId?: string): Promise<TokenSeasonContext> {
  const seasonId = season.id;
  const [rules, pools, initialPool, entries, ledger, earned, spends, purchases, trackers] = await Promise.all([
    getFormatRules(seasonId),
    getDraftPoolsBySeason(seasonId),
    getDraftPoolBySeason(seasonId),
    season.point_buy_list_id ? getListEntries(season.point_buy_list_id) : Promise.resolve<PointBuyListEntry[]>([]),
    loadDraftTokenLedger(seasonId),
    computeEarnedComebackTokens(seasonId),
    getComebackTokenSpends(seasonId, playerId),
    getDraftTokenPurchases(seasonId, playerId),
    playerId ? getPlayerTrackers(seasonId, playerId) : getSeasonTrackers(seasonId),
  ]);

  // The season's oldest pool is its initial draft (`getDraftPoolBySeason`).
  const initial = initialPool && (initialPool.kind ?? 'initial') === 'initial' ? initialPool : null;
  const initialPhase = initial?.phase ?? null;
  const closesAt = initial?.token_purchase_closes_at ?? null;
  const redraftComplete = pools.some((p) => p.kind === 'redraft' && p.phase === 'complete');

  // Only the default cutoff needs the match read; it decides nothing before the draft is complete.
  const anyLeagueMatchConfirmed =
    initialPhase === 'complete' && closesAt === null ? await hasConfirmedLeagueMatch(seasonId) : false;

  const entriesByLine = indexEntries(entries);
  const cosmogTrackers = trackers.filter((t) => {
    const lineId = trackerLineId(t, entriesByLine);
    const entry = lineId ? entriesByLine.get(lineId) : undefined;
    return entry ? isCosmogLine(entry) : isCosmogLine(t.base_pokemon);
  });
  const cosmoDays = await Promise.all(cosmogTrackers.map((t) => getCosmoMatchdays(t.id)));
  const cosmoMatchdays = new Map(cosmogTrackers.map((t, i) => [t.id, cosmoDays[i] ?? []] as const));

  return {
    seasonId,
    budget: rules?.draft_budget ?? DEFAULT_BUDGET,
    cost: rules?.draft_token_ratio ?? DEFAULT_TOKEN_RATIO,
    max: rules?.draft_token_max ?? DEFAULT_TOKEN_MAX,
    comebackAdminOpened: rules?.comeback_spend_open === true,
    initialPhase,
    closesAt,
    redraftComplete,
    anyLeagueMatchConfirmed,
    entriesByLine,
    ledger,
    earned,
    spends,
    purchases,
    trackers,
    cosmoMatchdays,
  };
}

function toStage(stage: number): 1 | 2 | 3 {
  if (stage >= 3) return 3;
  if (stage === 2) return 2;
  return 1;
}

/** One player's token overview (pure; `now` decides an explicit purchase cutoff). */
export function buildTokenOverview(ctx: TokenSeasonContext, playerId: string, now: Date): TokenOverviewDTO {
  const window = draftKillTokenWindow({
    initialPhase: ctx.initialPhase,
    closesAt: ctx.closesAt,
    anyLeagueMatchConfirmed: ctx.anyLeagueMatchConfirmed,
    now,
  });

  const purchases = ctx.purchases.filter((p) => p.player_id === playerId);
  const legacyGrantTokens = ctx.ledger.draftGrants
    .filter((g) => g.player_id === playerId)
    .reduce((sum, g) => sum + g.token_count, 0);
  const owned = purchases.length + legacyGrantTokens;
  const tokenLines = new Set(purchases.map((p) => p.line_id));
  const unspentPoints = computeRemainingPointsFromLedger(ctx.ledger, playerId, ctx.budget, ctx.cost);

  const draftKillLines: TokenOverviewDTO['draft_kill']['lines'] = [];
  const lines: TokenOverviewDTO['lines'] = [];
  let cosmo: TokenOverviewDTO['cosmo'] = null;

  const owners = ctx.trackers.filter((t) => t.player_id === playerId);
  const keyed = owners
    .map((tracker) => ({ tracker, lineId: trackerLineId(tracker, ctx.entriesByLine) }))
    .filter((row): row is { tracker: EvolutionTracker; lineId: LineId } => row.lineId !== null)
    .sort((a, b) => a.lineId.localeCompare(b.lineId));

  for (const { tracker, lineId } of keyed) {
    const entry = ctx.entriesByLine.get(lineId);
    const nextThreshold = entry ? nextThresholdFor(effectiveThresholds(entry), tracker.current_stage) : null;
    const sources = progressSourcesOf(tracker);
    const hasToken = tokenLines.has(lineId);
    // The SQL compares `tracker.total_kos` (= the five-source total, M4 invariant).
    const progress = tracker.total_kos;

    const reason = draftKillLineRefusal({
      window,
      owned,
      max: ctx.max,
      lineHasToken: hasToken,
      unspentPoints,
      cost: ctx.cost,
      totalProgress: progress,
      nextThreshold,
    });
    draftKillLines.push({
      line_id: lineId,
      has_token: hasToken,
      progress,
      next_threshold: nextThreshold,
      eligible: reason === null,
      reason,
    });

    lines.push({
      line_id: lineId,
      stage: toStage(tracker.current_stage),
      self_earned_kills: sources.selfEarnedKills,
      transferred_evo_progress: sources.transferred,
      draft_token_progress: sources.draftKillToken,
      comeback_token_progress: sources.comebackToken,
      cosmo_token_progress: sources.cosmoToken,
      total_progress: totalEligibleProgress(sources),
      next_threshold: nextThreshold,
    });

    const matchdays = ctx.cosmoMatchdays.get(tracker.id);
    if (matchdays && cosmo === null) {
      cosmo = { line_id: lineId, tokens: sources.cosmoToken, matchdays_brought: [...matchdays] };
    }
  }

  const earned = ctx.earned.byPlayer[playerId] ?? 0;
  // Σ spends + legacy kill_token grants: the same `v_spent` as epb_spend_comeback_tokens (M7).
  const spent = comebackSpentTotal(ctx.spends, ctx.ledger.killGrants ?? [], playerId);
  if (earned - spent < 0) {
    console.error(
      `[api/seasons/tokens] Comeback Token balance below zero for player ${playerId} in season ${ctx.seasonId}: earned ${earned}, spent ${spent}`,
    );
  }

  return {
    season_id: ctx.seasonId,
    player_id: playerId,
    initial_draft_complete: ctx.initialPhase === 'complete',
    redraft_complete: ctx.redraftComplete,
    draft_kill: {
      window,
      cutoff_at: ctx.closesAt,
      cost: ctx.cost,
      max: ctx.max,
      owned,
      unspent_points: unspentPoints,
      lines: draftKillLines,
    },
    comeback: {
      earned,
      spent,
      unspent: comebackBalance(earned, spent),
      history: ctx.earned.history
        .filter((h) => h.player_id === playerId)
        .map((h) => ({ matchday: h.matchday, score: h.score, tokens: h.tokens })),
      spend_open: comebackSpendOpen({ redraftComplete: ctx.redraftComplete, adminOpened: ctx.comebackAdminOpened }),
    },
    cosmo,
    lines,
  };
}
