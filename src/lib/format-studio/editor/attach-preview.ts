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
  type DiagnosticCode,
  type Locale,
} from '@/lib/format-kit/client';
import type { EngineGap } from '@/lib/format-studio/library-types';
import { planStages } from '@/lib/format-studio/materialise';
import type { BracketType } from '@/types/tournament';

/** Stands in for the league's ruleset when it has none; `planStages` only needs an id to avoid its guard. */
const PLACEHOLDER_RULESET_ID = '00000000-0000-0000-0000-000000000000';

export interface AttachPreviewStage {
  key: string;
  /** The phase order, counted from 1. */
  order: number;
  /** The phase name in the league's language. */
  name: string;
  bracketType: BracketType;
  bestOf: number;
  doubles: boolean;
  /** `named`: the stage names its own ruleset; `league`: it uses the league's. */
  ruleset: 'league' | 'named';
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
    seasonLanguage: input.seasonLanguage,
    specHash: input.specHash,
  });
  const stageByKey = new Map(definition.stages.map((stage) => [stage.key, stage]));
  const stages = planned.stages.map((row): AttachPreviewStage => ({
    key: row.key,
    order: row.stage_order,
    name: row.name,
    bracketType: row.bracket_type,
    bestOf: row.best_of_default,
    doubles: row.is_doubles,
    ruleset: stageByKey.get(row.key)?.ruleset.kind === 'ruleset' ? 'named' : 'league',
  }));
  const leagueRulesetMissing =
    input.seasonRulesetId === null ? definition.stages.filter((stage) => stage.ruleset.kind === 'season_default').length : 0;
  return { ok: true, stages, warnings: planned.warnings, leagueRulesetMissing };
}
