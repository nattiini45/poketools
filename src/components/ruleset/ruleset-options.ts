/**
 * Pure grouping of the ruleset options a select shows (`RulesetSelect`): by generation, newest first, singles before doubles
 * within a generation (the group says which, so a doubles ruleset is never mistaken for its singles twin), then by name. An
 * option is "older" when the same ruleset has a newer version in the list (a league that still pins version 1 while
 * version 2 is published), so the select can say which version a league pins instead of showing it as the current one.
 */
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';

export interface GroupedRulesetOption {
  option: RulesetOption;
  /** Another version of the same ruleset with a higher number is in the list. */
  older: boolean;
}

export interface RulesetOptionGroup {
  gen: number;
  /** A doubles group; its options are all doubles rulesets. */
  doubles: boolean;
  options: GroupedRulesetOption[];
}

export function groupRulesetOptions(options: readonly RulesetOption[]): RulesetOptionGroup[] {
  const newest = new Map<string, number>();
  for (const option of options) {
    newest.set(option.definition_id, Math.max(newest.get(option.definition_id) ?? 0, option.version_no));
  }
  const groups = new Map<string, { gen: number; doubles: boolean; entries: GroupedRulesetOption[] }>();
  for (const option of options) {
    const key = `${option.gen}:${option.is_doubles ? 'doubles' : 'singles'}`;
    const group = groups.get(key) ?? { gen: option.gen, doubles: option.is_doubles, entries: [] };
    group.entries.push({ option, older: option.version_no < (newest.get(option.definition_id) ?? option.version_no) });
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.gen - a.gen || Number(a.doubles) - Number(b.doubles))
    .map(({ gen, doubles, entries }) => ({
      gen,
      doubles,
      options: entries.sort(
        (a, b) => a.option.name.localeCompare(b.option.name) || b.option.version_no - a.option.version_no,
      ),
    }));
}
