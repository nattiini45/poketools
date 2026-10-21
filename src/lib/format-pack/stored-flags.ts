/**
 * Pack line rules -> the stored `point_buy_list_entries.special_rules` jsonb flags. Client-safe,
 * pure, and free of `@format-pack`: the example fixture generator
 * (`scripts/draft/make-example-list-fixtures.ts`) imports it next to the example pack.
 */
import type { EpbLineRule } from './types';

/**
 * Public flag name -> stored jsonb key. The keys are DB data (SQL reads `no_redraft`) and keep
 * their names whatever a pack calls the rule.
 */
export const STORED_FLAG = {
  participationPoints: 'cosmog',
  redraftLocked: 'no_redraft',
  instantFinalStage: 'scatterbug',
  noCocoon: 'no_cocoon_rule',
} as const satisfies Record<keyof Omit<EpbLineRule, 'base' | 'expectedThresholds'>, string>;

/**
 * The stored flags of one line rule, in the importer's historical key order (instant final stage,
 * no cocoon, participation, redraft lock); null when the rule (or the line) sets none.
 */
export function storedFlagsOf(rule: EpbLineRule | null | undefined): Record<string, boolean> | null {
  if (!rule) return null;
  const flags: Record<string, boolean> = {};
  if (rule.instantFinalStage) flags[STORED_FLAG.instantFinalStage] = true;
  if (rule.noCocoon) flags[STORED_FLAG.noCocoon] = true;
  if (rule.participationPoints) flags[STORED_FLAG.participationPoints] = true;
  if (rule.redraftLocked) flags[STORED_FLAG.redraftLocked] = true;
  return Object.keys(flags).length > 0 ? flags : null;
}
