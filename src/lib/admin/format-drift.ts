/**
 * Format drift report (`GET /api/admin/format-drift`, shown on `/admin/data`). Pure and client-safe: the route
 * reads the rows, this module compares them, the report component renders the result.
 *
 * It lists where what leagues store differs from the format pack or from what the engine reads. The report only
 * describes them; nothing here writes, and nothing is repaired automatically.
 *
 * 1. Tiebreaker order (information). A league stores `format_rules.tiebreaker_order` and its standings rank by it
 *    (`effectiveTiebreakerChain`), so a stored order that differs from the format pack's default is not a defect:
 *    the section lists the leagues that run a custom order. It stays because an admin can then see which leagues do
 *    not follow the default, and because it still catches a real defect: a stored order the standings cannot use
 *    (empty, an unknown or repeated step, a decision match that is not last) falls back to the pack's chain, so the
 *    case is marked `usable: false`.
 * 2. Advancement rule direction. Enrollment sync reads `advancement_rule` from the TARGET phase (the phase being
 *    enrolled), while the phase timeline and the phase form hint treat it as the rule of the SOURCE phase (the one
 *    before). A rule stored on one side of a consecutive phase pair is therefore applied or displayed on the other.
 */
import { isUsableTiebreakerChain } from '@/lib/tournament/standings-rules';
import type { TiebreakerStep } from '@/types/format-rules';
import type { AdvancementRule } from '@/types/season';

/** Rows read per list (`format_rules`, league phases) before the report is marked partial. */
export const FORMAT_DRIFT_MAX_ROWS = 10000;

/** One `format_rules` row with its league, as the report reads it (`archived` / `is_test` are the league's). */
export interface FormatRulesOrderRow {
  season_id: string;
  season_name: string;
  archived: boolean;
  is_test: boolean;
  tiebreaker_order: TiebreakerStep[];
}

/** One league phase (a `tournaments` row with a `season_id`) with its league (`archived` / `is_test` are the league's). */
export interface DriftPhaseRow {
  id: string;
  season_id: string;
  season_name: string;
  archived: boolean;
  is_test: boolean;
  name: string;
  stage_order: number;
  status: string;
  advancement_rule: AdvancementRule | null;
}

export interface DriftPhaseRef {
  id: string;
  name: string;
  stageOrder: number;
  status: string;
  rule: AdvancementRule | null;
}

export interface TiebreakerDriftCase {
  seasonId: string;
  seasonName: string;
  archived: boolean;
  isTest: boolean;
  stored: TiebreakerStep[];
  pack: TiebreakerStep[];
  /** Whether the standings can rank by the stored order; when false they use the pack's chain instead. */
  usable: boolean;
}

/**
 * - `source_only`: the rule is on the earlier phase. The timeline labels it on the edge into the target, but enrolling
 *   the target reads the target's own rule, so no cut is applied unless the request names `top_n`.
 * - `target_only`: the rule is on the later phase. Enrollment applies it; the timeline shows no label for it on the
 *   edge into that phase (it would show it on the edge after the phase).
 * - `both_differ`: both phases carry a rule and the rules differ. Enrollment uses the target's, the timeline shows
 *   the source's.
 * - `orphan`: the league's only phase carries a rule; nothing reads it.
 */
export type AdvancementDriftKind = 'source_only' | 'target_only' | 'both_differ' | 'orphan';

export interface AdvancementDriftCase {
  seasonId: string;
  seasonName: string;
  archived: boolean;
  isTest: boolean;
  kind: AdvancementDriftKind;
  source: DriftPhaseRef | null;
  target: DriftPhaseRef | null;
}

export interface FormatDriftReport {
  generatedAt: string;
  packChain: TiebreakerStep[];
  tiebreaker: { checked: number; cases: TiebreakerDriftCase[] };
  advancement: {
    /** Leagues with at least one phase. */
    leaguesChecked: number;
    /** Consecutive phase pairs where at least one phase carries a rule. */
    pairsChecked: number;
    /** Checked pairs whose two phases carry the same rule. */
    consistentPairs: number;
    cases: AdvancementDriftCase[];
  };
  /** A read stopped at its row cap, so the report covers only part of the data. */
  truncated: { formatRules: boolean; phases: boolean };
}

/** A stored rule as the engine reads it: `top_n` with a numeric count. Anything else counts as no rule. */
export function normalizeAdvancementRule(value: unknown): AdvancementRule | null {
  if (!value || typeof value !== 'object') return null;
  const rule = value as Record<string, unknown>;
  if (rule.type !== 'top_n' || typeof rule.count !== 'number' || !Number.isFinite(rule.count)) return null;
  return { type: 'top_n', count: rule.count, per_group: rule.per_group === true };
}

function sameRule(a: AdvancementRule, b: AdvancementRule): boolean {
  return a.type === b.type && a.count === b.count && a.per_group === b.per_group;
}

function sameOrder(a: readonly TiebreakerStep[], b: readonly TiebreakerStep[]): boolean {
  return a.length === b.length && a.every((step, i) => step === b[i]);
}

/** Leagues whose stored tiebreaker order differs from the pack chain by content or by order (information). */
export function findTiebreakerDrift(
  rows: readonly FormatRulesOrderRow[],
  packChain: readonly TiebreakerStep[],
): { checked: number; cases: TiebreakerDriftCase[] } {
  const cases: TiebreakerDriftCase[] = [];
  for (const row of rows) {
    if (sameOrder(row.tiebreaker_order, packChain)) continue;
    cases.push({
      seasonId: row.season_id,
      seasonName: row.season_name,
      archived: row.archived,
      isTest: row.is_test,
      stored: [...row.tiebreaker_order],
      pack: [...packChain],
      usable: isUsableTiebreakerChain(row.tiebreaker_order),
    });
  }
  cases.sort(byLeague);
  return { checked: rows.length, cases };
}

function byLeague(
  a: { seasonName: string; seasonId: string },
  b: { seasonName: string; seasonId: string },
): number {
  return a.seasonName.localeCompare(b.seasonName) || a.seasonId.localeCompare(b.seasonId);
}

function phaseRef(row: DriftPhaseRow): DriftPhaseRef {
  return {
    id: row.id,
    name: row.name,
    stageOrder: row.stage_order,
    status: row.status,
    rule: row.advancement_rule,
  };
}

/**
 * Consecutive phase pairs (earlier = source, later = target, ordered by `stage_order` then id) of every league
 * where the stored advancement rules and the engine's reading of them disagree.
 */
export function findAdvancementDrift(
  rows: readonly DriftPhaseRow[],
): FormatDriftReport['advancement'] {
  const bySeason = new Map<string, DriftPhaseRow[]>();
  for (const row of rows) {
    const list = bySeason.get(row.season_id);
    if (list) list.push(row);
    else bySeason.set(row.season_id, [row]);
  }

  const cases: AdvancementDriftCase[] = [];
  let pairsChecked = 0;
  let consistentPairs = 0;

  for (const [seasonId, unsorted] of bySeason) {
    const phases = [...unsorted].sort((a, b) => a.stage_order - b.stage_order || a.id.localeCompare(b.id));
    const league = {
      seasonId,
      seasonName: phases[0].season_name,
      archived: phases[0].archived,
      isTest: phases[0].is_test,
    };

    if (phases.length === 1) {
      if (phases[0].advancement_rule) {
        cases.push({ ...league, kind: 'orphan', source: phaseRef(phases[0]), target: null });
      }
      continue;
    }

    for (let i = 0; i + 1 < phases.length; i += 1) {
      const source = phases[i];
      const target = phases[i + 1];
      const sourceRule = source.advancement_rule;
      const targetRule = target.advancement_rule;
      if (!sourceRule && !targetRule) continue;
      pairsChecked += 1;

      if (sourceRule && targetRule && sameRule(sourceRule, targetRule)) {
        consistentPairs += 1;
        continue;
      }
      const kind: AdvancementDriftKind = !targetRule ? 'source_only' : !sourceRule ? 'target_only' : 'both_differ';
      cases.push({ ...league, kind, source: phaseRef(source), target: phaseRef(target) });
    }
  }

  cases.sort(
    (a, b) =>
      byLeague(a, b) ||
      (a.source?.stageOrder ?? 0) - (b.source?.stageOrder ?? 0),
  );
  return { leaguesChecked: bySeason.size, pairsChecked, consistentPairs, cases };
}

export interface FormatDriftInputs {
  formatRules: readonly FormatRulesOrderRow[];
  phases: readonly DriftPhaseRow[];
  packChain: readonly TiebreakerStep[];
  /** ISO timestamp, passed in so the function stays pure. */
  generatedAt: string;
  truncated: FormatDriftReport['truncated'];
}

export function buildFormatDriftReport(inputs: FormatDriftInputs): FormatDriftReport {
  return {
    generatedAt: inputs.generatedAt,
    packChain: [...inputs.packChain],
    tiebreaker: findTiebreakerDrift(inputs.formatRules, inputs.packChain),
    advancement: findAdvancementDrift(inputs.phases),
    truncated: { ...inputs.truncated },
  };
}
