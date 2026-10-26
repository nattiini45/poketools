/**
 * Test helper: the `Ruleset` read model of a legacy row converted by `convertLegacyRow` (the TypeScript twin of the SQL
 * conversion). Built with `makeRuleset`, whose `rules` override takes the converted rules as they are; the name-based
 * members come from the legacy lists.
 */
import { readResolvedRules } from '@/lib/ruleset-kit/resolved';
import { makeRuleset } from '@/test/ruleset-fixtures';
import type { Ruleset } from '@/types/ruleset';
import type { LegacyRow } from './legacy-oracle';

export function toRulesetFromRules(legacy: LegacyRow, resolved: Record<string, unknown>): Ruleset {
  const rules = readResolvedRules(resolved);
  return makeRuleset({
    id: legacy.id,
    name: legacy.name,
    base_format: rules.format_key,
    is_doubles: rules.doubles,
    gen: rules.gen,
    universe: rules.universe,
    clauses: legacy.clauses,
    bans: { pokemon: legacy.banned_pokemon, moves: legacy.banned_moves, items: legacy.banned_items, abilities: legacy.banned_abilities },
    additions: { pokemon: legacy.added_pokemon },
    rules,
  });
}
