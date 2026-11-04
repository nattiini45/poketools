/**
 * Loads what a kit league's standings need (`KitStandingsData`) in six reads: the attached format's engine and seed,
 * the phases it generated, then their matches, match outcomes, members and standings adjustments in parallel. A stage
 * that ranks by or shows a custom metric adds the spec and the runtime rows (`loadStageMetrics`). Server only: the season
 * seed is read here and turned into per-player coin flip draws, so it never reaches a client or a cached value.
 */
import 'server-only';

import {
  getKitPhases,
  getOutcomesByPhases,
  getPhaseMatchIds,
  getPhaseMembers,
  getSeasonKitHead,
  getStandingAdjustments,
  type KitPhaseRow,
} from '@/lib/supabase/queries/format-engine';
import { getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { BUILTIN_METRICS } from '@/lib/format-kit/engine/runtime-names';
import type { Json } from '@/types/database';
import type { Stage } from '@/lib/format-kit/types';
import type { KitStageMetrics, KitStageRules, KitStandingsData } from './context';
import { standingAdjustments } from './runtime/adjustments';
import { stageMetricsFor } from './runtime/metrics';
import { buildRuntimeState } from './runtime/state';
import type { KitOutcome } from './standings';
import { coinFlipDraws } from './standings';

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
  stage: Stage;
  outcomes: Record<string, KitOutcome>;
}

/** The kit phase `phaseId` of a custom league, or null when the format does not run it (none, `legacy`, not a phase of it). */
export async function loadKitPhase(seasonId: string, phaseId: string): Promise<KitPhase | null> {
  const head = await getSeasonKitHead(seasonId);
  if (head === null || head.engine === 'legacy') return null;
  const phase = (await getKitPhases(seasonId)).find((row) => row.id === phaseId);
  if (!phase) return null;
  const [stage, outcomeRows] = await Promise.all([stageOf(phase), getOutcomesByPhases([phaseId])]);
  const outcomes: Record<string, KitOutcome> = {};
  for (const row of outcomeRows) outcomes[row.match_id] = { kind: row.kind, p1_faints: row.p1_faints, p2_faints: row.p2_faints };
  return { engine: head.engine, seed: head.seed, stage, outcomes };
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
  const [matchRows, outcomeRows, members, adjustmentRows] = await Promise.all([
    getPhaseMatchIds(ids),
    getOutcomesByPhases(ids),
    getPhaseMembers(ids),
    getStandingAdjustments(seasonId),
  ]);

  const stages: Record<string, KitStageRules> = {};
  const full: Stage[] = [];
  for (const phase of phases) {
    const stage = await stageOf(phase);
    full.push(stage);
    stages[phase.id] = { key: stage.key, scoring: stage.scoring, rank: stage.rank };
  }

  const stageOfMatch: Record<string, string> = {};
  for (const row of matchRows) stageOfMatch[row.id] = row.tournament_id;
  const outcomes: Record<string, KitOutcome> = {};
  for (const row of outcomeRows) {
    outcomes[row.match_id] = { kind: row.kind, p1_faints: row.p1_faints, p2_faints: row.p2_faints };
  }

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

  const phaseOfStage = new Map(phases.map((phase, i) => [full[i].key, phase.id]));
  const { adjustments, manualOrder } = standingAdjustments(adjustmentRows, phaseOfStage);
  const metrics = full.some(usesCustomMetric) ? await loadStageMetrics(seasonId, head.seed, phases, full, playersOf) : undefined;

  return {
    engine,
    stages,
    stageOfMatch,
    outcomes,
    coinFlips,
    ...(Object.keys(adjustments).length > 0 ? { adjustments } : {}),
    ...(Object.keys(manualOrder).length > 0 ? { manualOrder } : {}),
    ...(metrics !== undefined ? { metrics } : {}),
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
