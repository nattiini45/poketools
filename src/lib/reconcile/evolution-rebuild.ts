/**
 * Chronological EPB evolution rebuild engine (spec §20).
 *
 * For an evolution_point_buy season, recomputes what each tracker's evolution
 * state SHOULD be by replaying the sources in chronological order:
 *   post-draft roster → preserved draft-token/kill-token grants → remaining
 *   matches chronological → real KOs → Participation Tokens → stage recheck →
 *   early stage-3 lock → Evolution Points.
 *
 * This is the engine the reconcile orchestrator and match reset/delete
 * reconciliation call. It MIRRORS (does not re-invent) the existing pure EPB
 * primitives: stage resolution (`applyStageTransitions`), participation-line detection
 * (`isCosmogLine` / `wasLineBroughtInMatch` / `shouldAwardCosmoPoint`), the
 * early stage lock rule (`shouldSuspend` / `suspensionEndMatchday`), and evolution-point
 * accounting (`earnsEvolutionPoint`). League tuning comes from the format pack
 * (`@/lib/format-pack`). It does NOT write; `repairSeasonEvolution` is the
 * only writer and reuses the existing query modules + the
 * `epb_recalculate_evolution_points` RPC.
 *
 * §21 — non-match sources (transferred progress, Draft Kill Tokens, Comeback
 * Tokens, admin adjustments) are PRESERVED, never zeroed. The rebuild only recomputes the
 * match-derived columns (real_kills, cosmo_points, evolution_points_awarded,
 * current_stage, current_form, suspended_until_matchday) and the derived
 * total_kos.
 *
 * §13 — `match_evolution_snapshots` are IMMUTABLE. This module never rewrites
 * them; instead it FLAGS later matches whose lineup becomes impossible after
 * a rebuild (`ImpossibleLineup`) so the orchestrator can surface them.
 *
 * `total_kos` composition (the load-bearing invariant, mirrored from the
 * `increment_tracker_progress` RPC in
 * supabase/migrations/20260727010000_epb_review_fixes.sql):
 *
 *   total_kos = real_kills + transferred_evo_progress + draft_tokens + kill_tokens + cosmo_points
 *
 * (five terms since migration M4, draft-backend §12.1). `transferred_evo_progress`
 * (real kills carried over from a redraft slot or a trade) is a preserved non-match
 * source like the token columns: it counts for evolution, never as kills.
 *
 * Each source column is clamped at 0 (negative admin corrections cannot
 * underflow). The rebuild applies increments by recomputing the sum, never
 * by adding to a running total, so it matches the RPC exactly.
 */

import { lineLookup } from '@/lib/match/epb-stage-resolution';
import {
  buildFormToTrackerIndex,
  applyStageTransitions,
  applyKillDelta,
  type KillStat,
} from '@/lib/match/epb-tracker-apply';
import { getSeasonLineThresholds, type LineThresholds } from '@/lib/draft/epb-thresholds';
import { wasLineBroughtInMatch } from '@/lib/draft/epb-team-validation';
import {
  isCosmogLine,
  shouldAwardCosmoPoint,
} from '@/lib/draft/special-rules';
import {
  shouldSuspend,
  suspensionEndMatchday,
  earnsEvolutionPoint,
} from '@/lib/draft/point-buy-engine';
import { epbPack } from '@/lib/format-pack';
import { getSeasonTrackers, updateTracker } from '@/lib/supabase/queries/evolutions';
import {
  insertEvolutionEvents,
} from '@/lib/supabase/queries/evolution-events';
import { getMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { recalculateEvolutionPoints } from '@/lib/draft/evolution-points-engine';
import { supabase } from '@/lib/supabase/client';
import type { EvolutionTracker, EvolutionEvent } from '@/types/evolution';
import type { BattleStat } from '@/types/game';
import type { Match } from '@/types/match';

// ── Public types ──────────────────────────────────────────────────

/**
 * Working tracker copy used during the rebuild. Mirrors the mutable
 * evolution_tracker columns; identity columns (id, season_id, player_id,
 * base_pokemon, locked_stage3_pokemon) are carried through unchanged.
 */
export interface ComputedTracker {
  id: string;
  season_id: string;
  player_id: string;
  base_pokemon: string;
  /** Draft line id; null for legacy evolution-tier leagues. Identity, carried through. */
  line_id: string | null;
  /** Preserved non-match source (redraft / trade transfer) — never reset by the rebuild (§21). */
  transferred_evo_progress: number;
  /** Preserved non-match source — never reset by the rebuild (§21). */
  draft_tokens: number;
  /** Preserved non-match source — never reset by the rebuild (§21). */
  kill_tokens: number;
  /** Match-derived — recomputed from battle_stats. */
  real_kills: number;
  /** Match-derived — recomputed from participation-line participation (format pack). */
  cosmo_points: number;
  /** Derived: real_kills + transferred_evo_progress + draft_tokens + kill_tokens + cosmo_points (clamp 0). */
  total_kos: number;
  current_form: string;
  current_stage: number;
  /** Match-derived — set when an early stage-3 lock triggers. */
  suspended_until_matchday: number | null;
  /** Carried from the stored tracker (cosmo lock form / branch choice). */
  locked_stage3_pokemon: string | null;
  /** Per-tracker evolution-points awarded this matchday (player total is the
   * sum across the player's trackers — recomputed from events in repair). */
  evolution_points_awarded: number;
}

/** A development event the rebuild produced, tagged with its matchday. */
export interface ComputedMatchdayEvent {
  matchday: number;
  event: EvolutionEvent;
}

/**
 * A remaining match whose historical snapshot records a higher stage than the
 * rebuilt progression could reach by that matchday — i.e. the lineup is now
 * impossible after the source change (e.g. the match that carried the
 * progression was deleted). The snapshot is NOT rewritten (§13); it is flagged
 * for the orchestrator to surface.
 */
export interface ImpossibleLineup {
  matchId: string;
  playerId: string;
  basePokemon: string;
  /** Branch-exact line of the snapshot; null for old line-less rows (base-keyed fallback). */
  lineId?: string | null;
  /** Stage recorded in the immutable snapshot (what the player actually fielded). */
  snapshotStage: number;
  /** Highest stage the rebuilt progression reaches by this matchday. */
  rebuiltMaxStageByMatchday: number;
  matchday: number;
}

export interface ComputedEvolutionState {
  computedTrackers: ComputedTracker[];
  computedEvents: ComputedMatchdayEvent[];
  impossibleLineups: ImpossibleLineup[];
}

export interface EvolutionMismatch {
  trackerId: string;
  field: keyof EvolutionTracker;
  stored: number | string | null;
  computed: number | string | null;
}

export interface RepairResult {
  trackersUpdated: number;
  eventsRewritten: number;
  impossibleLineups: ImpossibleLineup[];
  /** Result of the recalc RPC (rebuilt from the rewritten events). */
  evolutionPoints: { players_updated: number; points_awarded: number };
}

// ── Loader input types (already-loaded data, so compute is pure) ──

/** A remaining (non-deleted) match with its matchday and battle stats. */
export interface RebuildMatch {
  match: Match;
  /** round_number — the EPB matchday (see game-pipeline.ts / finalize.ts). */
  matchday: number;
  /** Battle stats across all games in this match (flattened). */
  battleStats: BattleStat[];
}

/** A snapshot row joined with the matchday of its match, for impossible-lineup
 * detection. Loaded alongside the matches. */
export interface RebuildSnapshot {
  matchId: string;
  matchday: number;
  playerId: string;
  basePokemon: string;
  /** Draft line id of the snapshot row; null for rows written before line_id existed. */
  lineId?: string | null;
  stageAtMatch: number;
}

export interface RebuildInput {
  /** Stored trackers — cloned to working copies; never mutated. */
  trackers: EvolutionTracker[];
  /** Season line thresholds (stage2/stage3 cumulative KO thresholds). */
  lines: LineThresholds[];
  /** Remaining (non-deleted) matches in chronological order. */
  matches: RebuildMatch[];
  /** Immutable snapshots for remaining matches (for impossible-lineup detection). */
  snapshots: RebuildSnapshot[];
  /** Creation-time gate signals (see `computeEvolutionStateCore`); omitted → created_at only. */
  gate?: RebuildGateInput;
}

/**
 * Timestamps for the creation-time gate, loaded in two season-wide reads.
 * `slotPublishedAt`: redraft_slots.id → created_at (the slot row is written by the
 * publish, so this is the redraft publish time; it survives a drop/restore because
 * the restore keeps an earlier slot id and never copies the tracker's created_at).
 * `restoredTrackerIds`: trackers re-inserted by redraft_admin_restore_drop (their
 * row created_at is the restore time, not their birth).
 */
export interface RebuildGateInput {
  slotPublishedAt: ReadonlyMap<string, string>;
  restoredTrackerIds: ReadonlySet<string>;
}

// ── Pure core ─────────────────────────────────────────────────────

/** Recompute total_kos = real_kills + transferred_evo_progress + draft_tokens + kill_tokens + cosmo_points. */
function recomputeTotalKos(t: ComputedTracker): number {
  const sum =
    Math.max(0, t.real_kills) +
    Math.max(0, t.transferred_evo_progress) +
    Math.max(0, t.draft_tokens) +
    Math.max(0, t.kill_tokens) +
    Math.max(0, t.cosmo_points);
  return Math.max(0, sum);
}

/** Deep-ish clone of a stored tracker into a working ComputedTracker.
 * Match-derived columns are reset; preserved sources (transferred_evo_progress,
 * draft_tokens, kill_tokens) and identity columns are carried through. */
function toWorkingTracker(t: EvolutionTracker): ComputedTracker {
  const working: ComputedTracker = {
    id: t.id,
    season_id: t.season_id,
    player_id: t.player_id,
    base_pokemon: t.base_pokemon,
    line_id: t.line_id ?? null,
    transferred_evo_progress: t.transferred_evo_progress ?? 0,
    draft_tokens: t.draft_tokens,
    kill_tokens: t.kill_tokens,
    real_kills: 0,
    cosmo_points: 0,
    total_kos: 0,
    current_form: t.base_pokemon,
    current_stage: 1,
    suspended_until_matchday: null,
    locked_stage3_pokemon: t.locked_stage3_pokemon,
    evolution_points_awarded: 0,
  };
  working.total_kos = recomputeTotalKos(working);
  return working;
}

/** True when the tracker was born by a redraft pick or a trade (creation-time gate applies). */
function isReplacementTracker(t: EvolutionTracker): boolean {
  return t.redraft_slot_id != null || (t.transferred_evo_progress ?? 0) > 0;
}

/**
 * Epoch ms from which a replacement tracker takes part in matches, or null for
 * no gate. Order: its redraft slot's publish time; else, for a tracker the
 * restore re-inserted, no gate (its row created_at is the restore time and its
 * birth time is gone — never under-credit); else its row created_at.
 */
function gateStartMs(t: EvolutionTracker, gate: RebuildGateInput | undefined): number | null {
  if (!isReplacementTracker(t)) return null;
  const slotAt = t.redraft_slot_id ? gate?.slotPublishedAt.get(t.redraft_slot_id) : undefined;
  const slotMs = toEpochMs(slotAt);
  if (slotMs !== null) return slotMs;
  if (gate?.restoredTrackerIds.has(t.id)) return null;
  return toEpochMs(t.created_at);
}

/** Parse an ISO timestamp to epoch ms; null when missing or unparseable. */
function toEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** When the match was completed: completion stamps both confirmed_at and date_played. */
function matchCompletedAtMs(match: Match): number | null {
  return toEpochMs(match.confirmed_at) ?? toEpochMs(match.date_played);
}

/** Impossible-lineup key for a branch-exact line. */
function lineStageKey(playerId: string, lineId: string, matchday: number): string {
  return `${playerId}::line:${lineId}::${matchday}`;
}

/** Impossible-lineup key for old snapshots without line_id (max over the base's lines). */
function baseStageKey(playerId: string, basePokemon: string, matchday: number): string {
  return `${playerId}::base:${basePokemon}::${matchday}`;
}

/**
 * Pure chronological rebuild of an EPB season's evolution state from its
 * sources. No database access — pass already-loaded data. This is the
 * unit-testable core; the thin async loader `computeSeasonEvolutionState`
 * fetches and delegates here.
 *
 * Order mirrors `runEpbMatchdayHooks` (epb-matchday.ts) WITHOUT the snapshot
 * write, with real kills applied first (as the per-game pipeline does):
 *   per matchday, ascending:
 *     1. clearExpiredSuspensions (suspended_until_matchday < matchday → null)
 *     2. real kills (form→tracker index) → recompute total_kos → stage transitions
 *     3. Participation Token (participation line brought — needs battle stats — current_stage
 *        below the pack's untilStage, at most one per tracker per matchday) → recompute total_kos
 *     4. recheck stages (stage transitions again after cosmo) — mirrors recheckEpbStages
 *     5. early stage lock (pack `epb.stageLock`: `shouldSuspend` → suspended_until_matchday =
 *        `suspensionEndMatchday(md)`)
 *     6. evolution point (max 1/player/matchday when ≥1 non-devolution event)
 *
 * §21: transferred_evo_progress, draft_tokens and kill_tokens are NEVER reset —
 * they are preserved non-match sources already applied to the current
 * (post-redraft) roster.
 *
 * Creation-time gate: a tracker born by a redraft pick or a trade
 * (`redraft_slot_id` set, or `transferred_evo_progress` > 0 — only those paths
 * write it) takes part only in matches completed at or after its birth: its
 * redraft slot's publish time (`input.gate.slotPublishedAt`), else its row
 * `created_at` — except a tracker re-inserted by the admin drop-restore
 * (`input.gate.restoredTrackerIds`, row created_at = restore time), which stays
 * ungated (match time = `confirmed_at ?? date_played`, both stamped at
 * completion; a match with neither counts as earlier). Earlier matches belong to the line it
 * replaced: they never credit its real kills or Participation Tokens, never move its
 * stage, never lock it, and never record its stage for impossible-lineup
 * detection. Its carried-over stage is resolved once, silently, from
 * `transferred_evo_progress` alone (the redraft/trade RPC created it at that
 * stage — no event, no Evolution Point). Original roster trackers are not gated.
 */
export function computeEvolutionStateCore(input: RebuildInput): ComputedEvolutionState {
  const { trackers, lines, matches, snapshots, gate } = input;

  // Working copies — never mutate the caller's stored trackers.
  const working: ComputedTracker[] = trackers.map(toWorkingTracker);

  const lineOf = lineLookup(lines);
  // Participation Tokens: at most one per (tracker, matchday).
  const cosmoAwarded = new Set<string>();

  // Build a mutable EvolutionTracker view per working copy so the shared
  // applyStageTransitions / buildFormToTrackerIndex helpers (which expect an
  // EvolutionTracker) operate on live state. The helpers mutate
  // current_form / current_stage / total_kos only; we keep the source columns
  // on the ComputedTracker and re-sync total_kos after each change.
  const liveViews: EvolutionTracker[] = working.map((w) => ({
    id: w.id,
    season_id: w.season_id,
    player_id: w.player_id,
    base_pokemon: w.base_pokemon,
    current_form: w.current_form,
    total_kos: w.total_kos,
    current_stage: w.current_stage,
    evolved_at: null,
    created_at: '',
    updated_at: '',
    real_kills: w.real_kills,
    draft_tokens: w.draft_tokens,
    kill_tokens: w.kill_tokens,
    cosmo_points: w.cosmo_points,
    suspended_until_matchday: w.suspended_until_matchday,
    evolution_points_awarded: w.evolution_points_awarded,
    locked_stage3_pokemon: w.locked_stage3_pokemon,
    line_id: w.line_id,
    transferred_evo_progress: w.transferred_evo_progress,
    redraft_slot_id: null,
  }));
  const viewByComputed = new Map<string, EvolutionTracker>();
  const workingById = new Map<string, ComputedTracker>();
  for (let i = 0; i < working.length; i++) {
    viewByComputed.set(working[i].id, liveViews[i]);
    workingById.set(working[i].id, working[i]);
  }

  // Creation-time gate (see the doc comment): replacement trackers → birth time
  // (slot publish, else created_at) in epoch ms. No usable time → ungated.
  const bornAtById = new Map<string, number>();
  for (const t of trackers) {
    const bornAt = gateStartMs(t, gate);
    if (bornAt !== null) bornAtById.set(t.id, bornAt);
  }
  const existedAt = (trackerId: string, completedAt: number | null): boolean => {
    const bornAt = bornAtById.get(trackerId);
    if (bornAt === undefined) return true;
    return completedAt !== null && completedAt >= bornAt;
  };

  // Replacement trackers start at the stage their transferred progress gives
  // (the RPC inserted them there): resolve it silently, without events.
  for (const w of working) {
    if (!bornAtById.has(w.id)) continue;
    const view = viewByComputed.get(w.id);
    if (!view) continue;
    const line = lineOf(view);
    if (!line) continue;
    view.total_kos = Math.max(0, w.transferred_evo_progress);
    applyStageTransitions(view, line);
    view.total_kos = w.total_kos;
    w.current_form = view.current_form;
    w.current_stage = view.current_stage;
  }

  const computedEvents: ComputedMatchdayEvent[] = [];

  // Track the max stage reached per (player, base_pokemon) by each matchday for
  // impossible-lineup detection. Indexed by matchday so we can read the value
  // at the snapshot's matchday (which is the stage reachable UP TO that matchday,
  // inclusive — the snapshot records what was fielded that matchday, and the
  // rebuild progression through that matchday is what could have supported it).
  // Keyed by line_id when the tracker has one (a player may own both lines of a
  // branched base, e.g. Samurott and Samurott-Hisui); the base key holds the
  // max over that base's lines and serves only old snapshots without line_id.
  const maxStageByMatchday = new Map<string, number>(); // stageKey(...) → stage

  // Matchdays ascending. Matches are pre-sorted by the loader; group is not
  // required since EPB round-robin has one match per player per matchday.
  for (const { match, matchday, battleStats } of matches) {
    // Defense in depth: a completed match with no battle_stats contributes
    // nothing legitimate to progression (the loader also filters these out).
    // Processing its matchday would advance suspension clearing / cosmo
    // eligibility for an empty-delta matchday, which can spuriously clear an
    // early-stage-3 suspension. Skip it entirely.
    if (battleStats.length === 0) continue;

    const playerIdSet = new Set([match.player_1_id, match.player_2_id]);
    const completedAt = matchCompletedAtMs(match);
    // Trackers of this match's players that existed when it was completed.
    const presentViews = liveViews.filter(
      (t) => playerIdSet.has(t.player_id) && existedAt(t.id, completedAt)
    );

    // 1. clearExpiredSuspensions — clear where suspended_until_matchday < matchday.
    for (const w of working) {
      if (w.suspended_until_matchday !== null && w.suspended_until_matchday < matchday) {
        w.suspended_until_matchday = null;
        const view = viewByComputed.get(w.id);
        if (view) view.suspended_until_matchday = null;
      }
    }

    // Build the form→tracker index for THIS matchday's players from the live
    // views (forms reflect evolutions that happened in earlier matchdays).
    const formToTracker = buildFormToTrackerIndex(presentViews, lines);

    // 2. Real kills from battle_stats (sign +1, drop zero/negative).
    const touchedTrackerIds = new Set<string>();
    for (const stat of applyKillDelta(battleStats as KillStat[], 1)) {
      const tracker = formToTracker.get(`${stat.player_id}::${stat.pokemon_name}`);
      if (!tracker) continue;

      const w = workingById.get(tracker.id);
      if (!w) continue;
      w.real_kills = Math.max(0, w.real_kills + stat.kos_dealt);
      w.total_kos = recomputeTotalKos(w);
      // keep live view in sync so applyStageTransitions reads the new total
      tracker.real_kills = w.real_kills;
      tracker.total_kos = w.total_kos;
      touchedTrackerIds.add(tracker.id);
    }

    // Apply stage transitions for trackers that gained real kills this matchday.
    const matchdayEvents: EvolutionEvent[] = [];
    for (const view of liveViews) {
      if (!touchedTrackerIds.has(view.id)) continue;
      const line = lineOf(view);
      if (!line) continue;
      const transitions = applyStageTransitions(view, line);
      if (transitions.length === 0) continue;
      matchdayEvents.push(...transitions);
      // sync working copy form/stage
      const w = workingById.get(view.id);
      if (w) {
        w.current_form = view.current_form;
        w.current_stage = view.current_stage;
        w.total_kos = recomputeTotalKos(w);
      }
    }

    // 3. Participation Token — participation lines only (each resolved by its line id),
    // only when brought (battle stats are non-empty here: empty matches were
    // skipped above, NQ 2), only below the pack's untilStage
    // (`shouldAwardCosmoPoint`), at most one per tracker per matchday. Mirrors
    // awardCosmoPoint (progress-engine.ts).
    for (const cosmogTracker of presentViews) {
      const cosmogLine = lineOf(cosmogTracker);
      if (!cosmogLine || !isCosmogLine(cosmogLine)) continue;
      if (!shouldAwardCosmoPoint(cosmogTracker.current_stage)) continue;
      const awardKey = `${cosmogTracker.id}::${matchday}`;
      if (cosmoAwarded.has(awardKey)) continue;

      const brought = wasLineBroughtInMatch(
        cosmogTracker.player_id,
        cosmogLine,
        battleStats as { player_id: string; pokemon_name: string }[],
        cosmogTracker.locked_stage3_pokemon
      );
      if (!brought) continue;

      const w = workingById.get(cosmogTracker.id);
      if (!w) continue;
      cosmoAwarded.add(awardKey);
      w.cosmo_points = Math.max(0, w.cosmo_points + epbPack.participationPoints.perMatchday);
      w.total_kos = recomputeTotalKos(w);
      cosmogTracker.cosmo_points = w.cosmo_points;
      cosmogTracker.total_kos = w.total_kos;
    }

    // 4. recheckEpbStages — re-resolve stages after cosmo/token contributions
    // so the early stage-3 lock sees the updated totals (mirrors the forward
    // hook order: cosmo → recheck → lock). The shipped recheckEpbStages runs
    // applyStageTransitions on every tracker of the matchday's players, so we
    // do the same (the helper is a no-op when no threshold is crossed).
    for (const v of presentViews) {
      const w = workingById.get(v.id);
      if (!w) continue;
      const line = lineOf(v);
      if (!line) continue;
      const transitions = applyStageTransitions(v, line);
      if (transitions.length === 0) continue;
      matchdayEvents.push(...transitions);
      w.current_form = v.current_form;
      w.current_stage = v.current_stage;
      w.total_kos = recomputeTotalKos(w);
    }

    // 5. Early stage lock (format pack `epb.stageLock`): the lock stage reached
    // by the lock matchday → suspended for the next `suspendMatchdays`. Mirrors
    // shouldSuspend + checkEarlyStage3Lock (only set when not already suspended;
    // shouldSuspend is false whenever the pack disables the lock).
    for (const v of presentViews) {
      if (shouldSuspend(v.current_stage, matchday) && v.suspended_until_matchday === null) {
        v.suspended_until_matchday = suspensionEndMatchday(matchday);
        const w = workingById.get(v.id);
        if (w) w.suspended_until_matchday = suspensionEndMatchday(matchday);
      }
    }

    // Tag + collect events. is_devolution is set by applyStageTransitions; we
    // attach matchday here.
    for (const event of matchdayEvents) {
      computedEvents.push({ matchday, event });
    }

    // Record max stage reached per (player, base) THROUGH this matchday.
    for (const v of presentViews) {
      if (v.line_id) {
        maxStageByMatchday.set(lineStageKey(v.player_id, v.line_id, matchday), v.current_stage);
      }
      const baseKey = baseStageKey(v.player_id, v.base_pokemon, matchday);
      maxStageByMatchday.set(baseKey, Math.max(maxStageByMatchday.get(baseKey) ?? 0, v.current_stage));
    }
  }

  // 6. Evolution Points: max 1 per player per matchday when ≥1 non-devolution
  // event occurred that matchday. Computed here for the diff; the authoritative
  // store is rebuilt from events via recalculateEvolutionPoints in repair.
  // Distinct (player, matchday) keys with at least one non-devolution event.
  const evolvedMatchdaysByPlayer = new Map<string, Set<number>>();
  for (const { matchday, event } of computedEvents) {
    if (event.is_devolution) continue;
    const set = evolvedMatchdaysByPlayer.get(event.player_id) ?? new Set<number>();
    set.add(matchday);
    evolvedMatchdaysByPlayer.set(event.player_id, set);
  }
  // Award to the player's first tracker (base_pokemon-localeCompare order),
  // mirroring awardEvolutionPointForMatchday's carrier selection (the
  // player-level counter lives on one tracker row).
  const byPlayer = new Map<string, ComputedTracker[]>();
  for (const w of working) {
    const list = byPlayer.get(w.player_id) ?? [];
    list.push(w);
    byPlayer.set(w.player_id, list);
  }
  for (const [playerId, list] of byPlayer) {
    list.sort((a, b) => a.base_pokemon.localeCompare(b.base_pokemon));
    const carrier = list[0];
    if (!carrier) continue;
    const matchdays = evolvedMatchdaysByPlayer.get(playerId);
    // earnsEvolutionPoint is the per-matchday primitive (1 if any line evolved,
    // else 0); sum across the matchdays that had ≥1 non-devolution event.
    carrier.evolution_points_awarded = matchdays
      ? Array.from(matchdays).reduce((sum) => sum + earnsEvolutionPoint(1), 0)
      : 0;
  }

  // Impossible-lineup detection (§20): for each remaining match snapshot,
  // compare the snapshot's stage_at_match against the rebuilt max stage the
  // progression could reach by that matchday. If the snapshot stage is HIGHER
  // than the rebuild supports, flag it (do NOT rewrite the snapshot — §13).
  const impossibleLineups: ImpossibleLineup[] = [];
  for (const snap of snapshots) {
    const key = snap.lineId
      ? lineStageKey(snap.playerId, snap.lineId, snap.matchday)
      : baseStageKey(snap.playerId, snap.basePokemon, snap.matchday);
    const rebuiltMax = maxStageByMatchday.get(key);
    if (rebuiltMax === undefined) {
      // No progression recorded for this line by this matchday — the snapshot
      // claims a stage the rebuild cannot support at all.
      if (snap.stageAtMatch > 1) {
        impossibleLineups.push({
          matchId: snap.matchId,
          playerId: snap.playerId,
          basePokemon: snap.basePokemon,
          lineId: snap.lineId ?? null,
          snapshotStage: snap.stageAtMatch,
          rebuiltMaxStageByMatchday: 1,
          matchday: snap.matchday,
        });
      }
      continue;
    }
    if (snap.stageAtMatch > rebuiltMax) {
      impossibleLineups.push({
        matchId: snap.matchId,
        playerId: snap.playerId,
        basePokemon: snap.basePokemon,
        lineId: snap.lineId ?? null,
        snapshotStage: snap.stageAtMatch,
        rebuiltMaxStageByMatchday: rebuiltMax,
        matchday: snap.matchday,
      });
    }
  }

  return { computedTrackers: working, computedEvents, impossibleLineups };
}

// ── Thin async loaders ────────────────────────────────────────────

/** Load the season's remaining (non-deleted) matches with matchday + battle stats. */
async function loadSeasonMatches(seasonId: string): Promise<RebuildMatch[]> {
  // tournaments for the season
  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId);
  if (tErr) throw tErr;
  if (!tournaments || tournaments.length === 0) return [];

  // matches joined with rounds(round_number), completed with a winner.
  // "Remaining" = status='completed' AND winner_id not null (matches the
  // kill-token / aggregate filters; deleted/reset matches drop out of
  // 'completed' so they are naturally excluded).
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('*, rounds:round_id(round_number)')
    .in('tournament_id', tournaments.map((t) => t.id))
    .eq('status', 'completed')
    .not('winner_id', 'is', null);
  if (mErr) throw mErr;
  if (!matches || matches.length === 0) return [];

  // Chronological by round_number, then date_played.
  const withMatchday = matches
    .map((row) => {
      const round = row.rounds as { round_number: number } | null;
      return {
        match: toMatch(row),
        matchday: round?.round_number ?? 0,
      };
    })
    .filter((m) => m.matchday > 0)
    .sort((a, b) => {
      if (a.matchday !== b.matchday) return a.matchday - b.matchday;
      const ad = a.match.date_played ?? '';
      const bd = b.match.date_played ?? '';
      return ad.localeCompare(bd);
    });

  if (withMatchday.length === 0) return [];

  // Battle stats: load all games for these matches, then their battle_stats,
  // grouped by match_id. (One bulk fetch beats N round-trips.)
  const matchIds = withMatchday.map((m) => m.match.id);
  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('id, match_id')
    .in('match_id', matchIds);
  if (gErr) throw gErr;

  const gameIds = (games ?? []).map((g) => g.id);
  const gameToMatch = new Map<string, string>();
  for (const g of games ?? []) gameToMatch.set(g.id, g.match_id);

  let statsByMatch = new Map<string, BattleStat[]>();
  if (gameIds.length > 0) {
    const { data: stats, error: sErr } = await supabase
      .from('battle_stats')
      .select('*')
      .in('game_id', gameIds);
    if (sErr) throw sErr;
    statsByMatch = groupStatsByMatch(stats ?? [], gameToMatch);
  }

  // Filter out completed matches with no games or battle_stats: a completed
  // match with no stats is corrupt/incomplete and contributes nothing
  // legitimate to progression. Including it would advance matchday processing
  // (suspension clearing, cosmo eligibility) for a matchday whose deltas are
  // empty, which can spuriously clear an early-stage-3 suspension. Skip them.
  return withMatchday
    .filter((m) => {
      // A match is stat-bearing only if it has at least one game with stats.
      const matchGameIds = (games ?? []).filter((g) => g.match_id === m.match.id).map((g) => g.id);
      if (matchGameIds.length === 0) return false;
      const stats = statsByMatch.get(m.match.id);
      return stats !== undefined && stats.length > 0;
    })
    .map((m) => ({
      match: m.match,
      matchday: m.matchday,
      battleStats: statsByMatch.get(m.match.id) ?? [],
    }));
}

function toMatch(row: Record<string, unknown>): Match {
  return {
    id: row.id as string,
    round_id: row.round_id as string,
    tournament_id: row.tournament_id as string,
    player_1_id: row.player_1_id as string,
    player_2_id: row.player_2_id as string,
    winner_id: (row.winner_id as string | null) ?? null,
    status: row.status as Match['status'],
    submitter_id: (row.submitter_id as string | null) ?? null,
    date_played: (row.date_played as string | null) ?? null,
    scheduled_at: (row.scheduled_at as string | null) ?? null,
    auto_confirm_at: (row.auto_confirm_at as string | null) ?? null,
    confirmed_at: (row.confirmed_at as string | null) ?? null,
    notes: (row.notes as string) ?? '',
    social_image_url: (row.social_image_url as string | null) ?? null,
    bracket_side: (row.bracket_side as Match['bracket_side']) ?? null,
    bracket_pos: (row.bracket_pos as number | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function groupStatsByMatch(
  stats: Record<string, unknown>[],
  gameToMatch: Map<string, string>
): Map<string, BattleStat[]> {
  const out = new Map<string, BattleStat[]>();
  for (const row of stats) {
    const gameId = row.game_id as string;
    const matchId = gameToMatch.get(gameId);
    if (!matchId) continue;
    const stat: BattleStat = {
      id: row.id as string,
      game_id: gameId,
      player_id: row.player_id as string,
      pokemon_name: row.pokemon_name as string,
      was_brought: (row.was_brought as boolean) ?? false,
      was_lead: (row.was_lead as boolean) ?? false,
      kos_dealt: (row.kos_dealt as number) ?? 0,
      was_koed: (row.was_koed as boolean) ?? false,
      moves_used: (row.moves_used as string[]) ?? [],
      turns_active: (row.turns_active as number) ?? 0,
      match_won: (row.match_won as boolean) ?? false,
      created_at: row.created_at as string,
    };
    const list = out.get(matchId) ?? [];
    list.push(stat);
    out.set(matchId, list);
  }
  return out;
}

/**
 * Creation-time gate signals in two season-wide reads (never per tracker):
 * redraft slot publish times, and the trackers the admin drop-restore re-inserted
 * (draft_action_log 'drop_restored' → after.tracker_id).
 */
async function loadSeasonGateInput(seasonId: string): Promise<RebuildGateInput> {
  const [slotsRes, restoresRes] = await Promise.all([
    supabase.from('redraft_slots').select('id, created_at').eq('season_id', seasonId),
    supabase
      .from('draft_action_log')
      .select('after')
      .eq('season_id', seasonId)
      .eq('action', 'drop_restored'),
  ]);
  if (slotsRes.error) throw slotsRes.error;
  if (restoresRes.error) throw restoresRes.error;

  const slotPublishedAt = new Map<string, string>();
  for (const row of (slotsRes.data ?? []) as { id: string; created_at: string }[]) {
    slotPublishedAt.set(row.id, row.created_at);
  }
  const restoredTrackerIds = new Set<string>();
  for (const row of (restoresRes.data ?? []) as { after: unknown }[]) {
    const after = row.after;
    if (after && typeof after === 'object' && !Array.isArray(after)) {
      const trackerId = (after as Record<string, unknown>).tracker_id;
      if (typeof trackerId === 'string') restoredTrackerIds.add(trackerId);
    }
  }
  return { slotPublishedAt, restoredTrackerIds };
}

/** Load immutable snapshots for the season's remaining matches, each tagged
 * with its matchday (via match_id → rounds.round_number) for impossible-lineup
 * detection. */
async function loadSeasonSnapshots(
  seasonId: string,
  matches: RebuildMatch[]
): Promise<RebuildSnapshot[]> {
  const out: RebuildSnapshot[] = [];
  const matchdayById = new Map<string, number>();
  for (const m of matches) matchdayById.set(m.match.id, m.matchday);

  for (const { match } of matches) {
    let snaps;
    try {
      snaps = await getMatchSnapshots(match.id);
    } catch (err) {
      // Snapshots are best-effort for detection; a read failure should not
      // block the rebuild. The orchestrator can re-surface impossible lineups
      // from a later pass. Still log — an unreadable snapshot source must be
      // diagnosable, not silent (CLAUDE.md: no suppression).
      console.error('Failed to load snapshots for match', match.id, err);
      continue;
    }
    const matchday = matchdayById.get(match.id) ?? 0;
    for (const s of snaps) {
      out.push({
        matchId: match.id,
        matchday,
        playerId: s.player_id,
        basePokemon: s.base_pokemon,
        lineId: s.line_id ?? null,
        stageAtMatch: s.stage_at_match,
      });
    }
  }
  return out;
}

/**
 * Recompute what the per-tracker evolution state SHOULD be for an EPB season,
 * from its sources, chronologically. PURE — no writes. Fetches the season's
 * trackers, line thresholds, remaining matches + battle stats, and immutable
 * snapshots, then delegates to the pure core. Mockable via the query modules.
 */
export async function computeSeasonEvolutionState(
  seasonId: string
): Promise<ComputedEvolutionState> {
  const [trackers, lines, matches, gate] = await Promise.all([
    getSeasonTrackers(seasonId),
    getSeasonLineThresholds(seasonId),
    loadSeasonMatches(seasonId),
    loadSeasonGateInput(seasonId),
  ]);
  const snapshots = await loadSeasonSnapshots(seasonId, matches);
  return computeEvolutionStateCore({ trackers, lines, matches, snapshots, gate });
}

// ── Diff ──────────────────────────────────────────────────────────

/** Fields compared between stored and computed tracker state. */
const DIFFED_FIELDS = [
  'real_kills',
  'cosmo_points',
  'total_kos',
  'draft_tokens',
  'kill_tokens',
  'current_stage',
  'current_form',
  'evolution_points_awarded',
  'suspended_until_matchday',
  'locked_stage3_pokemon',
] as const satisfies readonly (keyof EvolutionTracker)[];

/**
 * Compare the computed state against the CURRENT stored tracker state
 * (re-fetched via getSeasonTrackers). Returns a mismatch per tracker where any
 * compared field differs, with {trackerId, field, stored, computed}. PURE —
 * the only DB access is the re-fetch of stored trackers.
 */
export async function diffEvolutionState(
  seasonId: string,
  computed: ComputedEvolutionState
): Promise<EvolutionMismatch[]> {
  const stored = await getSeasonTrackers(seasonId);
  const storedById = new Map(stored.map((t) => [t.id, t]));

  const mismatches: EvolutionMismatch[] = [];
  for (const ct of computed.computedTrackers) {
    const s = storedById.get(ct.id);
    if (!s) continue;
    for (const field of DIFFED_FIELDS) {
      const storedValue = s[field];
      const computedValue = ct[field] as EvolutionTracker[typeof field];
      if (storedValue === computedValue) continue;
      // Normalize numeric comparison (number vs number).
      if (
        typeof storedValue === 'number' &&
        typeof computedValue === 'number' &&
        storedValue === computedValue
      ) {
        continue;
      }
      mismatches.push({
        trackerId: ct.id,
        field,
        stored: storedValue as number | string | null,
        computed: computedValue as number | string | null,
      });
    }
  }
  return mismatches;
}

// ── Repair (writes) ────────────────────────────────────────────────

/** Mutable currency/stage/suspension columns repair may set. Never identity. */
type TrackerUpdateColumns = {
  current_form?: string;
  total_kos?: number;
  current_stage?: number;
  real_kills?: number;
  cosmo_points?: number;
  suspended_until_matchday?: number | null;
  evolution_points_awarded?: number;
};

/**
 * Apply a pre-computed evolution state to the season (write path). Extracted
 * from `repairSeasonEvolution` so the grouped-insert + recalc ordering is
 * unit-testable with a `computeEvolutionStateCore` result and no DB/loader
 * mock. See `repairSeasonEvolution` for the full contract.
 */
export async function applyComputedEvolutionState(
  seasonId: string,
  computed: ComputedEvolutionState
): Promise<RepairResult> {
  let trackersUpdated = 0;
  for (const ct of computed.computedTrackers) {
    const updates: TrackerUpdateColumns = {
      current_form: ct.current_form,
      total_kos: ct.total_kos,
      current_stage: ct.current_stage,
      real_kills: ct.real_kills,
      cosmo_points: ct.cosmo_points,
      suspended_until_matchday: ct.suspended_until_matchday,
      // evolution_points_awarded is recomputed by the RPC below; set it now so
      // the row is consistent even if the RPC is run later by a separate job.
      evolution_points_awarded: ct.evolution_points_awarded,
    };
    await updateTracker(ct.id, updates);
    trackersUpdated += 1;
  }

  // Rewrite match-derived evolution_events: delete the season's non-manual
  // events, then insert the computed ones (all match-derived, is_manual=false).
  // Manual/admin events (is_manual = true) are preserved (§21).
  const { error: delErr } = await supabase
    .from('evolution_events')
    .delete()
    .eq('season_id', seasonId)
    .eq('is_manual', false);
  if (delErr) throw delErr;

  // Insert computed events grouped by matchday so each persisted row keeps a
  // non-null matchday. This is load-bearing: the epb_recalculate_evolution_points
  // RPC only awards points from events where `matchday IS NOT NULL`, and
  // insertEvolutionEvents defaults ctx.matchday to null when omitted — a single
  // flat insert would silently zero every player's evolution_points_awarded.
  const eventsByMatchday = new Map<number, EvolutionEvent[]>();
  for (const { matchday, event } of computed.computedEvents) {
    const list = eventsByMatchday.get(matchday) ?? [];
    list.push(event);
    eventsByMatchday.set(matchday, list);
  }
  let eventsRewritten = 0;
  for (const [matchday, events] of eventsByMatchday) {
    await insertEvolutionEvents(events, { season_id: seasonId, matchday });
    eventsRewritten += events.length;
  }

  // Recompute evolution_points_awarded from the freshly-written events.
  const ep = await recalculateEvolutionPoints(seasonId);

  return {
    trackersUpdated,
    eventsRewritten,
    impossibleLineups: computed.impossibleLineups,
    evolutionPoints: ep,
  };
}

/**
 * Recompute the season's evolution state and apply it transactionally-ish
 * (sequential best-effort, matching the existing `rollbackMatchdayWrites`
 * pattern — the repo uses sequential writes here because no single RPC owns
 * the multi-table tracker+event recompute).
 *
 *   1. Update each tracker's mutable columns to the computed values via
 *      `updateTracker` (only currency/stage/suspension cols — never id/
 *      season_id/player_id/base_pokemon/draft_tokens/kill_tokens).
 *   2. Rewrite `evolution_events` for the season: delete the season's existing
 *      match-derived events, insert the computed ones. Manual/admin events
 *      (is_manual = true) are PRESERVED — they are non-match sources (§21).
 *   3. Recompute `evolution_points_awarded` via `recalculateEvolutionPoints`
 *      (it rebuilds from evolution_events, so events must be written first).
 *   4. NEVER touch `match_evolution_snapshots` (§13), draft_token/kill_token
 *      grants, or evo_progress_log admin_correction rows.
 *
 * Returns counts + the impossible lineups for surfacing to admins.
 */
export async function repairSeasonEvolution(seasonId: string): Promise<RepairResult> {
  const computed = await computeSeasonEvolutionState(seasonId);
  return applyComputedEvolutionState(seasonId, computed);
}