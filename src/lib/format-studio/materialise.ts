/**
 * Stage materialisation: how a format's stages become `tournaments` rows (one phase per kit stage) when a format
 * is attached to a custom league. Pure: no I/O, no clock, no randomness; the same input gives the same rows.
 *
 * What the legacy engine can run today decides what a stage maps to. The kit expresses more than that (several
 * round robin legs, a third-place match, wildcard or threshold selections, groups that the legacy phases create
 * themselves), so every stage property the engine cannot honour yet is returned as an `EngineGap` code with
 * params, never as text: the next PR renders them, and Phase 2b makes the engine run them.
 */
import {
  resolveLText,
  type CountRange,
  type Edge,
  type FormatDefinition,
  type Locale,
  type SeriesOverride,
  type Stage,
  type StagePlan,
} from '@/lib/format-kit/client';
import type { BracketType } from '@/types/tournament';
import type { AttachStageRow } from '@/lib/supabase/queries/season-formats';
import type { EngineGap, EngineGapCode, StageSpecSnapshot } from './library-types';

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
  /** The league's default ruleset; a `season_default` stage uses it. The caller refuses a league without one. */
  seasonRulesetId: string | null;
  /**
   * The ruleset row of every Showdown format the stages name (format id to ruleset id): attach creates (or reuses)
   * them before it plans. A `showdown` stage whose format is missing here is a programming error.
   */
  showdownRulesetIds?: ReadonlyMap<string, string>;
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
  return stage.pairing.kind === 'manual' ? 'round_robin' : stage.pairing.kind;
}

function stageName(stage: Stage, language: Locale, order: number): string {
  const resolved = resolveLText(stage.name, { seasonLanguage: language });
  const trimmed = (resolved?.value ?? '').trim().slice(0, STAGE_NAME_MAX_CHARS).trim();
  return trimmed === '' ? `Stage ${order}` : trimmed;
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

/** The ruleset row a stage plays under: its stored ruleset, the row of its Showdown format, or the league's. */
function stageRulesetId(
  stage: Stage,
  seasonRulesetId: string | null,
  showdownRulesetIds: ReadonlyMap<string, string> | undefined,
): string | null {
  switch (stage.ruleset.kind) {
    case 'ruleset':
      return stage.ruleset.id;
    case 'showdown':
      return showdownRulesetIds?.get(stage.ruleset.format) ?? null;
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
  if (stage.pairing.kind === 'single_elim' && stage.pairing.third_place) {
    gaps.push(gap('third_place_not_run', { stage: stage.key }));
  }
  if (stage.groups !== undefined) {
    gaps.push(gap('groups_not_created', { stage: stage.key }, { count: stage.groups.count, method: stage.groups.method }));
  }
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
 * One `tournaments` row per kit stage, in graph order (`stage_order` counts from 1), plus the engine gaps the
 * attach reports. A `season_default` stage needs `seasonRulesetId` (the caller refuses a league without a
 * default ruleset before it plans) and a `showdown` stage needs the row of its format in `showdownRulesetIds`
 * (the caller creates those first), so a missing one here is a programming error.
 */
export function planStages(input: PlanStagesInput): PlannedStages {
  const { definition, graphOrder, plan, seasonRulesetId, showdownRulesetIds, seasonLanguage, specHash } = input;
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
    const rulesetId = stageRulesetId(stage, seasonRulesetId, showdownRulesetIds);
    if (rulesetId === null) throw new Error(`planStages: stage "${stage.key}" has no ruleset`);
    const series = mapSeriesOverrides(bracket, stage.series.overrides, stagePlan?.rounds ?? null);
    const snapshot: StageSpecSnapshot = {
      v: 1,
      spec_hash: specHash,
      stage: structuredClone(stage),
      mapped_bracket_type: bracket,
    };
    stages.push({
      key: stage.key,
      name: stageName(stage, seasonLanguage, order),
      bracket_type: bracket,
      ruleset_id: rulesetId,
      best_of_default: stage.series.best_of,
      bo_overrides: series.map,
      is_doubles: stage.doubles,
      bracket_reset_enabled: stage.pairing.kind === 'double_elim' ? stage.pairing.bracket_reset : true,
      stage_order: order,
      stage_spec: snapshot,
    });
    warnings.push(...stageWarnings(stage, series.unmapped));
  });
  warnings.push(...edgeWarnings(definition.edges));
  return { stages, warnings };
}
