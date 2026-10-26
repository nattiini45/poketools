/**
 * Server loader of the read-only Format Studio. Reads a league's rows, hands them to `describeLegacy`, compiles
 * the descriptor with the server entry of the kit and returns a `FormatView`: plain JSON, no locale, nothing
 * rendered. Rendering stays on the client (`describeDefinition`, `renderDiagnostic` with the toggle's locale).
 *
 * Nothing here is cached (`unstable_cache` / `cachedRead`): the descriptor of a league can carry Evolution Point
 * Buy pack values, so the result lives for one request on two admin routes and never reaches a public page.
 * Callers gate on the live admin check BEFORE they call anything here.
 *
 * Read budget (every read is a bounded, scoped query in `queries/format-studio.ts` or the sibling modules):
 *  - one league, one wave: stages, phase group counts, league group counts, plus per format the type assignment
 *    counts (singles, doubles, draft), the tier limits (draft) or the format rules (Evolution Point Buy), at
 *    most five reads; the league row comes from the caller;
 *  - the list of leagues: three reads for any number of leagues, plus the type assignment counts of each classic
 *    (singles, doubles, draft) league without a core pool, because they decide whether the Core Liga module (and
 *    so the coverage line) exists.
 */
import 'server-only';

import { compile, PRESETS, type FormatDefinition } from '@/lib/format-kit';
import type { Coverage } from '@/lib/format-kit/client';
import { epbPack } from '@/lib/format-pack';
import { availableLeagueAdminTabs, leagueAdminHref, type LeagueAdminTab } from '@/lib/league-admin/tabs';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getTierLimits } from '@/lib/supabase/queries/draft-tier-limits';
import { getLeagueGroupCounts, getSeasonTypeAssignmentCounts, getStageGroupCounts } from '@/lib/supabase/queries/format-studio';
import { getStagesBySeasonIds } from '@/lib/supabase/queries/tournaments';
import type { SeasonFormatType, SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import { describeLegacy } from './legacy/describe-legacy';
import type { LegacyFacts } from './legacy/types';
import { toLegacyInput } from './legacy-input';
import { legacyCompileEnv, toFormatView, type FormatView } from './view';

export type EditorAdapter = 'epb' | 'legacy_draft' | 'core_liga';

export type LeagueFormatResult =
  | { kind: 'ok'; view: FormatView; editorLinks: Partial<Record<EditorAdapter, string>> }
  | { kind: 'no_phases' };

export type PairingKind = 'round_robin' | 'swiss' | 'single_elim' | 'double_elim';

export interface LeagueFormatSummary {
  id: string;
  name: string;
  formatType: SeasonFormatType;
  isTest: boolean;
  stageCount: number;
  /** The pairing of each phase, in phase order. */
  pairings: PairingKind[];
  errors: number;
  warnings: number;
  coverage: Coverage | null;
}

/** Stored ruleset names the descriptor refers to, for the ruleset sentences (no extra read). */
function rulesetNames(league: SeasonWithDetails, stages: readonly TournamentWithDetails[]): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  if (league.ruleset_id && league.ruleset_name) byId.set(league.ruleset_id, league.ruleset_name);
  for (const stage of stages) {
    if (stage.ruleset_id && stage.ruleset_name) byId.set(stage.ruleset_id, stage.ruleset_name);
  }
  return [...byId].map(([id, name]) => ({ id, name }));
}

/** The league admin tab where each legacy module is edited, when the league's format has that tab. */
function editorLinksFor(
  league: SeasonWithDetails,
  definition: FormatDefinition | null,
): Partial<Record<EditorAdapter, string>> {
  const tabs = availableLeagueAdminTabs(league.format_type);
  const link = (tab: LeagueAdminTab): string | undefined => (tabs.includes(tab) ? leagueAdminHref(league.id, tab) : undefined);
  const out: Partial<Record<EditorAdapter, string>> = {};
  for (const mod of definition?.modules ?? []) {
    const href = mod.adapter === 'core_liga' ? link('participants') : link('rules');
    if (href !== undefined) out[mod.adapter] = href;
  }
  return out;
}

/** The per-format reads of one league; each runs in the same wave as the stage reads. */
function readFacts(league: SeasonWithDetails): Promise<Partial<LegacyFacts>> {
  switch (league.format_type) {
    case 'evolution_point_buy':
      return getFormatRules(league.id).then((formatRules) => ({ formatRules }));
    case 'draft':
      return Promise.all([getSeasonTypeAssignmentCounts(league.id), getTierLimits(league.id)]).then(
        ([typeAssignments, limits]) => ({
          typeAssignments,
          draftTierLimits: limits.map((l) => ({ tier: l.power_tier, maxPicks: l.max_picks })),
        }),
      );
    default:
      return getSeasonTypeAssignmentCounts(league.id).then((typeAssignments) => ({ typeAssignments }));
  }
}

/**
 * One league's format view. The caller has passed the live admin gate for this league. Zero phases returns
 * `no_phases` without compiling: the descriptor of a league without phases is an empty (invalid) definition by
 * design, and its schema diagnostics are not for the owner to read.
 */
export async function loadLeagueFormat(league: SeasonWithDetails): Promise<LeagueFormatResult> {
  const [stagesBySeason, stageGroupCounts, leagueGroupCounts, facts] = await Promise.all([
    getStagesBySeasonIds([league.id]),
    getStageGroupCounts([league.id]),
    getLeagueGroupCounts([league.id]),
    readFacts(league),
  ]);

  const stages = stagesBySeason.get(league.id) ?? [];
  if (stages.length === 0) return { kind: 'no_phases' };

  const definition = describeLegacy(
    toLegacyInput({
      league,
      stages,
      stageGroupCounts,
      leagueGroupCount: leagueGroupCounts.get(league.id) ?? 0,
      facts,
      epb: epbPack,
    }),
  );
  const result = compile(definition, legacyCompileEnv(league.participant_count));
  const view = toFormatView(result, { rulesets: rulesetNames(league, stages) });
  return { kind: 'ok', view, editorLinks: editorLinksFor(league, view.definition) };
}

function summaryRow(league: SeasonWithDetails, view: FormatView | null): LeagueFormatSummary {
  const base = { id: league.id, name: league.name, formatType: league.format_type, isTest: league.is_test_season };
  if (view === null) return { ...base, stageCount: 0, pairings: [], errors: 0, warnings: 0, coverage: null };
  const pairings: PairingKind[] = [];
  for (const stage of view.definition?.stages ?? []) {
    if (stage.pairing.kind !== 'manual') pairings.push(stage.pairing.kind);
  }
  return {
    ...base,
    stageCount: view.definition?.stages.length ?? 0,
    pairings,
    errors: view.diagnostics.filter((d) => d.severity === 'error').length,
    warnings: view.diagnostics.filter((d) => d.severity === 'warning').length,
    coverage: view.coverage,
  };
}

/**
 * Whether the Core Liga module depends on the type assignment counts: only a classic league without a core pool
 * (a configured pool adds the module on its own, and the other formats never have it).
 */
function needsTypeAssignments(league: SeasonWithDetails): boolean {
  const classic = league.format_type === 'singles' || league.format_type === 'doubles' || league.format_type === 'draft';
  return classic && league.core_pool === null;
}

/**
 * The gallery's league list: one compiled descriptor per league, three reads for any number of leagues (phases by
 * league ids, phase group counts, league group counts). The only per-league extra is the type assignment counts of
 * a classic league without a core pool: they decide whether the Core Liga module exists, and a module is one unit
 * of the coverage line, so the card must read them to agree with the league's own page. The other extras (format
 * rules, tier limits) only feed module facts and never change a count, so they are NOT read here; a module adds no
 * diagnostic, so the error and warning counts are the same with or without any of them.
 */
export async function loadLeagueFormatSummaries(leagues: readonly SeasonWithDetails[]): Promise<LeagueFormatSummary[]> {
  if (leagues.length === 0) return [];
  const ids = leagues.map((l) => l.id);
  const [stagesBySeason, stageGroupCounts, leagueGroupCounts, assignments] = await Promise.all([
    getStagesBySeasonIds(ids),
    getStageGroupCounts(ids),
    getLeagueGroupCounts(ids),
    Promise.all(leagues.map((l) => (needsTypeAssignments(l) ? getSeasonTypeAssignmentCounts(l.id) : null))),
  ]);

  return leagues.map((league, index) => {
    const stages = stagesBySeason.get(league.id) ?? [];
    if (stages.length === 0) return summaryRow(league, null);
    const typeAssignments = assignments[index];
    const definition = describeLegacy(
      toLegacyInput({
        league,
        stages,
        stageGroupCounts,
        leagueGroupCount: leagueGroupCounts.get(league.id) ?? 0,
        facts: typeAssignments === null ? {} : { typeAssignments },
        epb: epbPack,
      }),
    );
    const view = toFormatView(compile(definition, legacyCompileEnv(league.participant_count)), {
      rulesets: rulesetNames(league, stages),
    });
    return summaryRow(league, view);
  });
}

let presetMemo: { id: string; view: FormatView }[] | null = null;

/**
 * The kit presets compiled once per process (they are constants, so the memo never goes stale). Locale-free and
 * public data, but only the admin routes show it, so there is nothing to cache across requests.
 */
export function presetViews(): { id: string; view: FormatView }[] {
  presetMemo ??= PRESETS.map((preset) => ({ id: preset.id, view: toFormatView(compile(preset.definition)) }));
  return presetMemo;
}
