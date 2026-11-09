/**
 * Loads what a kit league's standings need (`KitStandingsData`) in eight reads: the attached format's engine and seed,
 * the phases it generated, then their matches, match outcomes, members, standings adjustments, game counts and (round
 * robin stages) kills in parallel. A stage
 * that ranks by or shows a custom metric adds the spec and the runtime rows (`loadStageMetrics`). Server only: the season
 * seed is read here and turned into per-player coin flip draws, so it never reaches a client or a cached value.
 */
import 'server-only';

import {
  getKitPhases,
  getOutcomesByPhases,
  getPhaseGameCounts,
  getPhaseMatchIds,
  getPhaseMembers,
  getSeasonKitHead,
  getStandingAdjustments,
  type KitPhaseRow,
  type StandingAdjustmentRow,
} from '@/lib/supabase/queries/format-engine';
import { getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { getPhaseKillTallies } from '@/lib/supabase/queries/games';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getParticipantsBatch } from '@/lib/supabase/queries/tournaments';
import { BUILTIN_METRICS } from '@/lib/format-kit/engine/runtime-names';
import type { Json } from '@/types/database';
import type { Stage } from '@/lib/format-kit/types';
import type { KitStageMetrics, KitStageRules, KitStandingsData } from './context';
import { standingAdjustments } from './runtime/adjustments';
import { stageHasCustomMetrics, stageMetricsFor } from './runtime/metrics';
import { buildRuntimeState } from './runtime/state';
import { coinFlipDraws, kitOutcomesByMatch, stageCountsKills, type KitOutcome, type StageTableExtras } from './standings';

export type { StageTableExtras };

/** A phase whose frozen `stage_spec` no longer parses as a kit stage: the standings cannot rank it. */
export class KitStageSpecError extends Error {
  constructor(readonly phaseId: string, detail: string) {
    super(`tournaments ${phaseId}: stage_spec is not a kit stage (${detail})`);
    this.name = 'KitStageSpecError';
  }
}

/**
 * The kit stage frozen into a phase (`tournaments.stage_spec.stage`). The zod schema loads on first use: this module
 * sits on the import path of every standings read, and most leagues never parse a stage.
 */
export async function stageOf(phase: KitPhaseRow): Promise<Stage> {
  const { stageSchema } = await import('@/lib/format-kit/schema/primitives');
  const spec = phase.stage_spec;
  const raw = spec !== null && typeof spec === 'object' && !Array.isArray(spec) ? spec.stage : undefined;
  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) throw new KitStageSpecError(phase.id, parsed.error.issues[0]?.message ?? 'invalid');
  return parsed.data as Stage;
}

/** The scoring and rank chain of a phase's kit stage. */
export async function stageRulesOf(phase: KitPhaseRow): Promise<KitStageRules> {
  const { key, scoring, rank } = await stageOf(phase);
  return { key, scoring, rank };
}

/** One phase of a kit league: its full stage, the format's engine and seed, and the outcomes of its matches. */
export interface KitPhase {
  engine: 'kit' | 'shadow';
  /** Server-side only. */
  seed: string;
  /**
   * The `season_formats.revision` read before the phase's stage: a round or a check written from this phase hands it to the
   * database, which refuses the write (`format_context_stale`) when the format was replaced, switched or detached since.
   */
  revision: number;
  stage: Stage;
  outcomes: Record<string, KitOutcome>;
  /**
   * What the phase's table reads besides matches, byes and outcomes (adjustments, the admin's order, custom metrics,
   * seeds, ratings). Pass it to `pairNextRound` as `tableExtras` so the pairing ranks by the table the public sees.
   */
  tableExtras: StageTableExtras;
}

/** The kit phase `phaseId` of a custom league, or null when the format does not run it (none, `legacy`, not a phase of it). */
export async function loadKitPhase(seasonId: string, phaseId: string): Promise<KitPhase | null> {
  const head = await getSeasonKitHead(seasonId);
  if (head === null || head.engine === 'legacy') return null;
  const phase = (await getKitPhases(seasonId)).find((row) => row.id === phaseId);
  if (!phase) return null;
  const [stage, outcomeRows] = await Promise.all([stageOf(phase), getOutcomesByPhases([phaseId])]);
  const members = await getPhaseMembers([phaseId]);
  const tableExtras = await loadStageTableExtras({
    seasonId,
    phase,
    stage,
    seed: head.seed,
    playerIds: members.map((member) => member.player_id),
  });
  return { engine: head.engine, seed: head.seed, revision: head.revision, stage, outcomes: kitOutcomesByMatch(outcomeRows), tableExtras };
}

export interface StageTableExtrasInput {
  seasonId: string;
  phase: KitPhaseRow;
  stage: Stage;
  seed: string;
  /** The phase's players: whose attributes, seeds and ratings are read. */
  playerIds: readonly string[];
  /** The attached format, when the caller has read it already (else read here, and only when a metric needs it). */
  format?: Awaited<ReturnType<typeof getSeasonFormat>>;
  /** The league's adjustment rows, when the caller has read them already. */
  adjustmentRows?: readonly StandingAdjustmentRow[];
}

/**
 * The game counts, kill stats (round robin), adjustments, custom metrics, seeds and ratings a phase's table needs, read like the public table reads
 * them, so the advancement, the pairing and the runtime rank the way the standings page does (`games_played` included:
 * a threshold or metric on it sees the real count). Reads the format and the runtime rows only when a metric of the
 * format applies to the stage, and seeds and ratings only when the stage ranks by or shows `seed` / `rating`.
 */
export async function loadStageTableExtras(input: StageTableExtrasInput): Promise<StageTableExtras> {
  const { phase, stage, playerIds } = input;
  const [adjustmentRows, gameCounts, kills] = await Promise.all([
    input.adjustmentRows ?? getStandingAdjustments(input.seasonId),
    getPhaseGameCounts([phase.id]),
    // Kills count in a round robin stage only, like the public table.
    stageCountsKills(stage) ? getPhaseKillTallies([phase.id]) : Promise.resolve({}),
  ]);
  const { adjustments, manualOrder } = standingAdjustments(adjustmentRows, new Map([[stage.key, phase.id]]));
  const out: StageTableExtras = {
    ...(Object.keys(gameCounts).length > 0 ? { gameCounts } : {}),
    ...(Object.keys(kills).length > 0 ? { kills } : {}),
    ...(adjustments[phase.id] !== undefined ? { pointAdjustments: adjustments[phase.id] } : {}),
    ...(manualOrder[phase.id] !== undefined ? { manualOrder: manualOrder[phase.id] } : {}),
  };

  const format = input.format !== undefined ? input.format : await getSeasonFormat(input.seasonId);
  if (format !== null && stageHasCustomMetrics(format.spec, stage.key)) {
    const runtime = await getFormatRuntime(input.seasonId);
    const { state } = buildRuntimeState(format.spec, runtime, {
      tunables: format.tunables as Json,
      amendments: format.amendments as Json,
    });
    const metrics = stageMetricsFor(format.spec, state, input.seed, stage.key, playerIds);
    if (metrics !== undefined) {
      out.metricDefs = metrics.defs;
      out.placements = metrics.placements;
      out.playerRefs = metrics.playerRefs;
      if (metrics.relations !== undefined) out.relations = metrics.relations;
    }
  }

  const seedsAndRatings = await loadSeedsAndRatings([{ phaseId: phase.id, stage, playerIds }]);
  if (seedsAndRatings.seeds?.[phase.id] !== undefined) out.seeds = seedsAndRatings.seeds[phase.id];
  if (seedsAndRatings.ratings !== undefined) out.ratings = seedsAndRatings.ratings;
  return out;
}

/** Whether a stage ranks by, or shows as a column, the builtin metric `metric`. */
function stageUsesMetric(stage: Pick<Stage, 'rank' | 'columns'>, metric: 'seed' | 'rating'): boolean {
  return stage.rank.some((step) => step.kind === 'metric' && step.metric === metric) || stage.columns.includes(metric);
}

/** Ids per `.in()` read of ratings: keeps the request URL short. */
const RATING_CHUNK = 100;

/**
 * The `seed` (`tournament_participants.seed`, per phase) and `rating` (`player_ratings.rating`, global) values of the
 * phases' players, for the stages that rank by or show them; nothing is read for the others. A player without a seed or
 * a rating row is absent (the metric then sorts them last, or reads 0).
 */
export async function loadSeedsAndRatings(
  entries: readonly { phaseId: string; stage: Pick<Stage, 'rank' | 'columns'>; playerIds: readonly string[] }[],
): Promise<{ seeds?: Record<string, Record<string, number>>; ratings?: Record<string, number> }> {
  const seeded = entries.filter((entry) => stageUsesMetric(entry.stage, 'seed'));
  const rated = entries.filter((entry) => stageUsesMetric(entry.stage, 'rating'));
  const out: { seeds?: Record<string, Record<string, number>>; ratings?: Record<string, number> } = {};

  if (seeded.length > 0) {
    const byPhase = await getParticipantsBatch(seeded.map((entry) => entry.phaseId));
    const seeds: Record<string, Record<string, number>> = {};
    for (const entry of seeded) {
      const bySeed: Record<string, number> = {};
      for (const participant of byPhase.get(entry.phaseId) ?? []) {
        if (participant.seed !== null) bySeed[participant.id] = participant.seed;
      }
      seeds[entry.phaseId] = bySeed;
    }
    out.seeds = seeds;
  }

  if (rated.length > 0) {
    const ids = [...new Set(rated.flatMap((entry) => entry.playerIds))];
    const ratings: Record<string, number> = {};
    for (let i = 0; i < ids.length; i += RATING_CHUNK) {
      for (const [playerId, rating] of await getPlayerRatingsBatch(ids.slice(i, i + RATING_CHUNK))) ratings[playerId] = rating.rating;
    }
    out.ratings = ratings;
  }
  return out;
}

export interface LoadKitOptions {
  /** Load a `legacy` league too, as `shadow` (the admin diff compares before the switch). */
  includeLegacy?: boolean;
}

/**
 * The standings data of a league, or undefined when its format does not rank (no format attached, or the engine
 * `legacy` without `includeLegacy`). Call it only for a `custom` league: no other league type has an attached format.
 */
export async function loadKitStandingsData(
  seasonId: string,
  options: LoadKitOptions = {},
): Promise<KitStandingsData | undefined> {
  const head = await getSeasonKitHead(seasonId);
  if (head === null || (head.engine === 'legacy' && options.includeLegacy !== true)) return undefined;
  const engine = head.engine === 'kit' ? 'kit' : 'shadow';
  const phases = await getKitPhases(seasonId);
  const ids = phases.map((phase) => phase.id);
  // The stage of each phase is parsed first: only a round robin stage counts kills, and nothing is read for the others.
  const stages: Record<string, KitStageRules> = {};
  const full: Stage[] = [];
  for (const phase of phases) {
    const stage = await stageOf(phase);
    full.push(stage);
    stages[phase.id] = { key: stage.key, scoring: stage.scoring, rank: stage.rank };
  }
  const killPhaseIds = phases.filter((_, i) => stageCountsKills(full[i])).map((phase) => phase.id);
  const [matchRows, outcomeRows, members, adjustmentRows, gameCounts, kills] = await Promise.all([
    getPhaseMatchIds(ids),
    getOutcomesByPhases(ids),
    getPhaseMembers(ids),
    getStandingAdjustments(seasonId),
    getPhaseGameCounts(ids),
    killPhaseIds.length > 0 ? getPhaseKillTallies(killPhaseIds) : Promise.resolve({}),
  ]);

  const stageOfMatch: Record<string, string> = {};
  for (const row of matchRows) stageOfMatch[row.id] = row.tournament_id;
  const outcomes = kitOutcomesByMatch(outcomeRows);

  const playersOf = new Map<string, string[]>();
  for (const member of members) {
    const list = playersOf.get(member.tournament_id) ?? [];
    list.push(member.player_id);
    playersOf.set(member.tournament_id, list);
  }
  const coinFlips: Record<string, Record<string, number>> = {};
  for (const phase of phases) {
    coinFlips[phase.id] = coinFlipDraws(head.seed, stages[phase.id].key, playersOf.get(phase.id) ?? []);
  }

  // A `foreach_group` stage runs one phase per group under one stage key: a player's adjustments go to their group's phase.
  const phasesOfStage = new Map<string, string[]>();
  phases.forEach((phase, i) => phasesOfStage.set(full[i].key, [...(phasesOfStage.get(full[i].key) ?? []), phase.id]));
  const memberSets = new Map([...playersOf].map(([phaseId, ids]) => [phaseId, new Set(ids)]));
  const { adjustments, manualOrder } = standingAdjustments(adjustmentRows, phasesOfStage, memberSets);
  const metrics = full.some(usesCustomMetric) ? await loadStageMetrics(seasonId, head.seed, phases, full, playersOf) : undefined;
  const seedsAndRatings = await loadSeedsAndRatings(
    phases.map((phase, i) => ({ phaseId: phase.id, stage: full[i], playerIds: playersOf.get(phase.id) ?? [] })),
  );

  return {
    engine,
    stages,
    stageOfMatch,
    outcomes,
    coinFlips,
    ...(Object.keys(gameCounts).length > 0 ? { gameCounts } : {}),
    ...(Object.keys(kills).length > 0 ? { kills } : {}),
    ...(Object.keys(adjustments).length > 0 ? { adjustments } : {}),
    ...(Object.keys(manualOrder).length > 0 ? { manualOrder } : {}),
    ...(metrics !== undefined ? { metrics } : {}),
    ...(seedsAndRatings.seeds !== undefined ? { seeds: seedsAndRatings.seeds } : {}),
    ...(seedsAndRatings.ratings !== undefined ? { ratings: seedsAndRatings.ratings } : {}),
  };
}

/** Whether a stage ranks by, or shows as a column, a metric that the standings engine does not produce itself. */
function usesCustomMetric(stage: Stage): boolean {
  return (
    stage.rank.some((step) => step.kind === 'metric' && !BUILTIN_METRICS.has(step.metric)) ||
    stage.columns.some((column) => !BUILTIN_METRICS.has(column))
  );
}

/**
 * The custom metrics of the phases whose stage uses one: reads the attached spec and the runtime rows (attributes and
 * track progress feed the expressions). Public values only: no seed, no relation.
 */
async function loadStageMetrics(
  seasonId: string,
  seed: string,
  phases: readonly KitPhaseRow[],
  stages: readonly Stage[],
  playersOf: ReadonlyMap<string, string[]>,
): Promise<Record<string, KitStageMetrics> | undefined> {
  const [format, runtime] = await Promise.all([getSeasonFormat(seasonId), getFormatRuntime(seasonId)]);
  if (format === null) return undefined;
  const { state } = buildRuntimeState(format.spec, runtime, {
    tunables: format.tunables as Json,
    amendments: format.amendments as Json,
  });
  const out: Record<string, KitStageMetrics> = {};
  phases.forEach((phase, i) => {
    const metrics = stageMetricsFor(format.spec, state, seed, stages[i].key, playersOf.get(phase.id) ?? []);
    if (metrics !== undefined) out[phase.id] = metrics;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}
