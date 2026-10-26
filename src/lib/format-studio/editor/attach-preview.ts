/**
 * The attach preview: which phases attaching a published format would create in a league, computed in the browser
 * with the same planner the server uses (`planStages`), so the preview and the attach cannot disagree. The compile
 * has no roster size, exactly like attach.
 *
 * Pure and client-safe. A spec that does not compile cleanly is not planned; the first error code is reported.
 */
import {
  CURRENT_ENV,
  compile,
  getRulesetPreset,
  presetsOf,
  type DiagnosticCode,
  type Locale,
} from '@/lib/format-kit/client';
import type { EngineGap } from '@/lib/format-studio/library-types';
import { planStages } from '@/lib/format-studio/materialise';
import type { BracketType } from '@/types/tournament';

/** Stands in for a ruleset id the preview does not have (the league's, a preset's); `planStages` only needs an id to avoid its guard. */
const PLACEHOLDER_RULESET_ID = '00000000-0000-0000-0000-000000000000';

/** The definition ids of the stored rulesets the stages name. */
function namedRulesetsOf(definition: { stages: readonly { ruleset: { kind: string; id?: string } }[] }): string[] {
  const ids = new Set<string>();
  for (const stage of definition.stages) {
    if (stage.ruleset.kind === 'ruleset' && stage.ruleset.id !== undefined) ids.add(stage.ruleset.id);
  }
  return [...ids];
}

/** A stored ruleset by name and version, for the preview's wording. */
export interface RulesetLabel {
  name: string;
  version_no: number;
}

export interface AttachPreviewStage {
  key: string;
  /** The phase order, counted from 1. */
  order: number;
  /** The phase name in the league's language. */
  name: string;
  bracketType: BracketType;
  bestOf: number;
  doubles: boolean;
  /** `named`: the stage names its own stored ruleset; `preset`: a rule preset (`presetName`); `league`: it uses the league's. */
  ruleset: 'league' | 'named' | 'preset';
  /** The ruleset a `named` stage uses (its newest published version) or the league's pinned one; absent when unknown. */
  rulesetLabel?: RulesetLabel;
  /** The catalog name of the rule preset ('Gen 9 OU'); set when `ruleset` is `preset`. */
  presetName?: string;
}

export type AttachPreview =
  | { ok: false; reason: 'invalid'; firstError: DiagnosticCode }
  | {
      ok: true;
      stages: AttachPreviewStage[];
      warnings: EngineGap[];
      /** Stages that use the league's ruleset while the league has none. */
      leagueRulesetMissing: number;
    };

export function previewAttach(input: {
  spec: unknown;
  seasonRulesetId: string | null;
  seasonLanguage: Locale;
  specHash: string;
  /** The name and version of the league's own ruleset, for the stages that use it. */
  seasonRuleset?: RulesetLabel | null;
  /** The stored rulesets a stage may name, by DEFINITION id: name and newest published version (what attach pins). */
  namedRulesets?: ReadonlyMap<string, RulesetLabel>;
}): AttachPreview {
  const result = compile(input.spec, CURRENT_ENV);
  const firstError = result.diagnostics.find((d) => d.severity === 'error');
  if (firstError !== undefined || !result.ok || result.definition === null || result.graph === null || result.plan === null) {
    return { ok: false, reason: 'invalid', firstError: firstError?.code ?? 'schema_refine' };
  }
  const { definition } = result;
  const planned = planStages({
    definition,
    graphOrder: result.graph.order,
    plan: result.plan,
    seasonRulesetId: input.seasonRulesetId ?? PLACEHOLDER_RULESET_ID,
    // Attach creates one ruleset per rule preset; the preview only needs the plan to go through.
    namedRulesetVersionIds: new Map(namedRulesetsOf(definition).map((id) => [id, PLACEHOLDER_RULESET_ID])),
    presetRulesetIds: new Map(presetsOf(definition).map((preset) => [preset, PLACEHOLDER_RULESET_ID])),
    seasonLanguage: input.seasonLanguage,
    specHash: input.specHash,
  });
  const stageByKey = new Map(definition.stages.map((stage) => [stage.key, stage]));
  const stages = planned.stages.map((row): AttachPreviewStage => {
    const ruleset = stageByKey.get(row.key)?.ruleset;
    const base = { key: row.key, order: row.stage_order, name: row.name, bracketType: row.bracket_type, bestOf: row.best_of_default, doubles: row.is_doubles };
    if (ruleset?.kind === 'preset') {
      return { ...base, ruleset: 'preset', presetName: getRulesetPreset(ruleset.preset)?.name ?? ruleset.preset };
    }
    if (ruleset?.kind === 'ruleset') {
      const label = input.namedRulesets?.get(ruleset.id);
      return { ...base, ruleset: 'named', ...(label === undefined ? {} : { rulesetLabel: label }) };
    }
    return { ...base, ruleset: 'league', ...(input.seasonRuleset ? { rulesetLabel: input.seasonRuleset } : {}) };
  });
  const leagueRulesetMissing =
    input.seasonRulesetId === null ? definition.stages.filter((stage) => stage.ruleset.kind === 'season_default').length : 0;
  return { ok: true, stages, warnings: planned.warnings, leagueRulesetMissing };
}
