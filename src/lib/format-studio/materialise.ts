/**
 * Stage materialisation: how a format's stages become `tournaments` rows (one phase per kit stage, or one per group for
 * a `foreach_group` stage) when a format is attached to a custom league. Pure: no I/O, no clock, no randomness; the
 * same input gives the same rows.
 *
 * What the legacy engine can run decides what a stage maps to. The kit expresses more than that (several round
 * robin legs, wildcard, threshold or bottom-N selections, groups), so every stage property the legacy engine cannot
 * honour is returned as an `EngineGap` code with params, never as text. A league on the kit engine runs legs and
 * every selection itself: `engineGaps` drops those for it.
 */
import {
  mappedBracketType,
  type CountRange,
  type Edge,
  type FormatDefinition,
  type SeriesOverride,
  type Stage,
  type StagePlan,
} from '@/lib/format-kit/client';
import { resolveLText } from '@/lib/studio-core/ltext';
import { groupLabel } from '@/lib/tournament/serpentine';
import type { Locale } from '@/i18n/config';
import type { BracketType } from '@/types/tournament';
import type { AttachStageRow } from '@/lib/supabase/queries/season-formats';
import type { EngineGap, EngineGapCode, SeasonFormatEngine, StageSpecSnapshot } from './library-types';

/**
 * The longest stage name a phase keeps (the documented cut). It equals `FIELD_LIMITS.TITLE`; the constant lives here
 * because that object sits in the zod-based validation module and this file runs in the browser (attach preview).
 */
export const STAGE_NAME_MAX_CHARS = 200;

export interface PlanStagesInput {
  definition: FormatDefinition;
  /** The topological stage order of the compiled graph (`CompileResult.graph.order`). */
  graphOrder: readonly string[];
  /** The compiled plan (`CompileResult.plan`): bracket mapping and round counts per stage. */
  plan: readonly StagePlan[];
  /**
   * The league's default ruleset: the VERSION its `season_default` stages pin (the same version as the league, so a phase
   * never drifts from the league default). The caller refuses a league without one.
   */
  seasonRulesetId: string | null;
  /**
   * The head version of every stored ruleset the stages name (definition id to version id): attach resolves them before
   * it plans, so the stage pins the version that was current at attach. A `ruleset` stage whose definition is missing
   * here is a programming error.
   */
  namedRulesetVersionIds?: ReadonlyMap<string, string>;
  /**
   * The version of the ruleset attach created (or reused) for every rule preset the stages name (preset id to version
   * id). A `preset` stage whose preset is missing here is a programming error.
   */
  presetRulesetIds?: ReadonlyMap<string, string>;
  /** The league's content language, used to pick the text of a stage name. */
  seasonLanguage: Locale;
  /** The content hash of the stored version the stages come from. */
  specHash: string;
}

export interface PlannedStages {
  stages: AttachStageRow[];
  warnings: EngineGap[];
}

export interface MappedSeriesOverrides {
  /** Best-of values keyed by the English round name the bracket generators write. */
  map: Record<string, number>;
  /** Overrides the legacy round names cannot express, in kit order. */
  unmapped: SeriesOverride[];
}

const FROM_END_NAMES: Readonly<Record<number, string>> = { 1: 'Finals', 2: 'Semifinals', 3: 'Quarterfinals' };

function exactTotal(rounds: CountRange | null): number | null {
  return rounds !== null && rounds.min === rounds.max ? rounds.min : null;
}

/** The legacy round name a series override stands for, or `null` when it cannot be named. */
function overrideName(bracket: BracketType, override: SeriesOverride, total: number | null): string | null {
  const { round, from } = override;
  switch (bracket) {
    case 'double_elim':
      // Winners, losers and grand final rounds are named by the bracket structure.
      return null;
    case 'round_robin':
    case 'swiss': {
      if (from === 'start') return `Round ${round}`;
      if (total === null) return null;
      const number = total - round + 1;
      return number >= 1 ? `Round ${number}` : null;
    }
    case 'single_elim': {
      // `k` is the distance from the end: 1 is the final.
      const k = from === 'end' ? round : total === null ? null : total - round + 1;
      if (k === null || k < 1) return null;
      if (total !== null && k > total) return null;
      const fixed = FROM_END_NAMES[k];
      if (fixed !== undefined) return fixed;
      return total === null ? null : `Round ${total - k + 1}`;
    }
    default:
      return null;
  }
}

/**
 * The inverse of `format-studio/legacy/overrides.ts`: kit series overrides to the `bo_overrides` map a phase
 * stores. Round robin and Swiss count rounds from the start; single elimination names the last three rounds
 * Finals, Semifinals and Quarterfinals and the others by number; double elimination has no stable names.
 * Counting from the end needs the exact round count, except for the last three rounds of a single elimination.
 * Two overrides that land on the same name: the first one (kit order) wins, the second is unmapped.
 */
export function mapSeriesOverrides(
  bracket: BracketType,
  overrides: readonly SeriesOverride[],
  rounds: CountRange | null,
): MappedSeriesOverrides {
  const total = exactTotal(rounds);
  const map: Record<string, number> = {};
  const unmapped: SeriesOverride[] = [];
  for (const override of overrides) {
    const name = overrideName(bracket, override, total);
    if (name === null || Object.prototype.hasOwnProperty.call(map, name)) {
      unmapped.push(override);
    } else {
      map[name] = override.best_of;
    }
  }
  return { map, unmapped };
}

function mappedBracketOf(stage: Stage, plan: StagePlan | undefined): BracketType {
  if (plan !== undefined) return plan.mappedBracketType;
  return mappedBracketType(stage.pairing);
}

function stageName(stage: Stage, language: Locale, order: number): string {
  const resolved = resolveLText(stage.name, { seasonLanguage: language });
  const trimmed = (resolved?.value ?? '').trim().slice(0, STAGE_NAME_MAX_CHARS).trim();
  return trimmed === '' ? `Stage ${order}` : trimmed;
}

const GROUP_NAME_SEPARATOR = ' · ';

/**
 * The phase name of group `group` (1-based) of a `foreach_group` stage: "<stage> · Group A". The cut applies to the stage
 * part, so the group suffix always survives.
 */
export function groupPhaseName(base: string, group: number): string {
  const suffix = `${GROUP_NAME_SEPARATOR}Group ${groupLabel(group - 1)}`;
  return `${base.slice(0, Math.max(1, STAGE_NAME_MAX_CHARS - suffix.length)).trim()}${suffix}`;
}

/**
 * The groups a `foreach_group` stage repeats over: 1..N for the N groups of the stage it names, or an empty list for a
 * stage that repeats over nothing (no `foreach_group`, or a source without groups, which the compiler rejects).
 */
function foreachGroups(definition: FormatDefinition, stage: Stage): number[] {
  const source = stage.foreach_group === undefined ? undefined : definition.stages.find((s) => s.key === stage.foreach_group?.from);
  const count = source?.groups?.count ?? 0;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** Stages in graph order; a stage missing from the order is appended in declaration order. */
function orderedStages(definition: FormatDefinition, graphOrder: readonly string[]): Stage[] {
  const byKey = new Map<string, Stage>();
  for (const stage of definition.stages) {
    if (!byKey.has(stage.key)) byKey.set(stage.key, stage);
  }
  const out: Stage[] = [];
  const seen = new Set<string>();
  for (const key of graphOrder) {
    const stage = byKey.get(key);
    if (stage !== undefined && !seen.has(key)) {
      out.push(stage);
      seen.add(key);
    }
  }
  for (const stage of definition.stages) {
    if (!seen.has(stage.key)) {
      out.push(stage);
      seen.add(stage.key);
    }
  }
  return out;
}

/** The ruleset VERSION a stage pins: the head of its stored ruleset, the version of its rule preset's ruleset, or the league's. */
function stageRulesetId(
  stage: Stage,
  seasonRulesetId: string | null,
  namedRulesetVersionIds: ReadonlyMap<string, string> | undefined,
  presetRulesetIds: ReadonlyMap<string, string> | undefined,
): string | null {
  switch (stage.ruleset.kind) {
    case 'ruleset':
      return namedRulesetVersionIds?.get(stage.ruleset.id) ?? null;
    case 'preset':
      return presetRulesetIds?.get(stage.ruleset.preset) ?? null;
    case 'season_default':
      return seasonRulesetId;
  }
}

/** An engine gap. The code is an argument, not a `code:` property: it is a gap code, not an API error code. */
function gap(gapCode: EngineGapCode, where: { stage?: string; edge?: string }, params: Record<string, string | number> = {}): EngineGap {
  return { code: gapCode, ...where, params };
}

function stageWarnings(stage: Stage, unmapped: readonly SeriesOverride[]): EngineGap[] {
  const gaps: EngineGap[] = [];
  for (const override of unmapped) {
    gaps.push(gap('override_unmapped', { stage: stage.key }, { round: override.round, from: override.from, best_of: override.best_of }));
  }
  if (stage.pairing.kind === 'round_robin' && stage.pairing.legs > 1) {
    gaps.push(gap('rr_legs_not_run', { stage: stage.key }, { legs: stage.pairing.legs }));
  }
  if (stage.groups !== undefined) {
    gaps.push(gap('groups_not_created', { stage: stage.key }, { count: stage.groups.count, method: stage.groups.method }));
  }
  const { pairing } = stage;
  if (pairing.kind === 'bipartite' || pairing.kind === 'filter' || pairing.kind === 'challenge') {
    gaps.push(gap('pairing_not_run', { stage: stage.key }, { kind: pairing.kind }));
  }
  if (stage.constraints !== undefined && stage.constraints.length > 0) {
    gaps.push(gap('constraints_not_run', { stage: stage.key }, { count: stage.constraints.length }));
  }
  if (stage.calendar !== undefined) gaps.push(gap('calendar_not_run', { stage: stage.key }));
  if (stage.end_when !== undefined) gaps.push(gap('end_when_not_run', { stage: stage.key }));
  if (stage.foreach_group !== undefined) gaps.push(gap('foreach_group_not_run', { stage: stage.key }));
  return gaps;
}

const UNRUN_SELECTS: ReadonlySet<string> = new Set(['wildcard', 'threshold', 'bottom_n']);

function edgeWarnings(edges: readonly Edge[]): EngineGap[] {
  const gaps: EngineGap[] = [];
  for (const edge of edges) {
    for (const select of edge.select) {
      if (UNRUN_SELECTS.has(select.kind)) {
        gaps.push(gap('edge_select_not_run', { stage: edge.from, edge: edge.key }, { kind: select.kind }));
      }
    }
  }
  return gaps;
}

/**
 * The gaps the kit engine closes: it plays every round robin leg, runs every edge selection, pairs filter and bipartite
 * stages, checks team constraints, follows the stage calendar and end condition, and repeats a `foreach_group` stage
 * per group.
 */
const KIT_RUNS: ReadonlySet<EngineGapCode> = new Set<EngineGapCode>([
  'rr_legs_not_run',
  'edge_select_not_run',
  'pairing_not_run',
  'constraints_not_run',
  'calendar_not_run',
  'end_when_not_run',
  'foreach_group_not_run',
]);

/** A challenge ladder has its engine but no routes yet for players to issue and answer challenges. */
function kitRuns(entry: EngineGap): boolean {
  if (entry.code === 'pairing_not_run' && entry.params.kind === 'challenge') return false;
  return KIT_RUNS.has(entry.code);
}

/** The gaps that still apply to a league on `engine` (`shadow` schedules and advances like `legacy`). */
export function engineGaps(gaps: readonly EngineGap[], engine: SeasonFormatEngine): EngineGap[] {
  return engine === 'kit' ? gaps.filter((entry) => !kitRuns(entry)) : [...gaps];
}

/**
 * One `tournaments` row per kit stage, in graph order (`stage_order` counts from 1), plus the engine gaps the
 * attach reports. A `season_default` stage needs `seasonRulesetId` (the caller refuses a league without a
 * default ruleset before it plans), a `ruleset` stage needs the head version of its ruleset in `namedRulesetVersionIds`
 * and a `preset` stage the version of its preset's ruleset in `presetRulesetIds` (the caller resolves and creates those
 * first), so a missing one here is a programming error.
 */
export function planStages(input: PlanStagesInput): PlannedStages {
  const { definition, graphOrder, plan, seasonRulesetId, namedRulesetVersionIds, presetRulesetIds, seasonLanguage, specHash } = input;
  const planByKey = new Map<string, StagePlan>();
  for (const entry of plan) {
    if (!planByKey.has(entry.key)) planByKey.set(entry.key, entry);
  }

  const stages: AttachStageRow[] = [];
  const warnings: EngineGap[] = [];
  orderedStages(definition, graphOrder).forEach((stage, index) => {
    const order = index + 1;
    const stagePlan = planByKey.get(stage.key);
    const bracket = mappedBracketOf(stage, stagePlan);
    const rulesetId = stageRulesetId(stage, seasonRulesetId, namedRulesetVersionIds, presetRulesetIds);
    if (rulesetId === null) throw new Error(`planStages: stage "${stage.key}" has no ruleset`);
    const series = mapSeriesOverrides(bracket, stage.series.overrides, stagePlan?.rounds ?? null);
    const snapshot: StageSpecSnapshot = {
      v: 1,
      spec_hash: specHash,
      stage: structuredClone(stage),
      mapped_bracket_type: bracket,
    };
    const name = stageName(stage, seasonLanguage, order);
    const groups = foreachGroups(definition, stage);
    // A stage that repeats per group is one phase per group of its source, in group order; any other stage is one phase.
    for (const group of groups.length > 0 ? groups : [0]) {
      stages.push({
        key: stage.key,
        format_group: group,
        name: group === 0 ? name : groupPhaseName(name, group),
        bracket_type: bracket,
        ruleset_id: rulesetId,
        best_of_default: stage.series.best_of,
        bo_overrides: series.map,
        is_doubles: stage.doubles,
        bracket_reset_enabled: stage.pairing.kind === 'double_elim' ? stage.pairing.bracket_reset : true,
        third_place_enabled: stage.pairing.kind === 'single_elim' && stage.pairing.third_place,
        stage_order: order,
        stage_spec: snapshot,
      });
    }
    warnings.push(...stageWarnings(stage, series.unmapped));
  });
  warnings.push(...edgeWarnings(definition.edges));
  return { stages, warnings };
}
