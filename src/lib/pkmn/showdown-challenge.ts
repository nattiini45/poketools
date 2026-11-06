/**
 * Copyable Pokémon Showdown challenge rules for a frozen ruleset. Pure and client-safe: resolved rules store dex ids,
 * and Showdown applies the same id folding to custom-rule entries. Allowlists first rule out the whole category.
 */
import { clauseName } from './clauses';
import type { ResolvedList, ResolvedRules, RulesetCategory } from '@/lib/ruleset-kit/types';

const ALL: Record<RulesetCategory, string> = {
  pokemon: 'All Pokemon',
  moves: 'All Moves',
  items: 'All Items',
  abilities: 'All Abilities',
};

function listRules(category: RulesetCategory, list: ResolvedList): string[] {
  if (list.mode === 'allow') return [`-${ALL[category]}`, ...list.ids.map((id) => `+${id}`)];
  return list.ids.map((id) => `-${id}`);
}

/** `gen9nationaldexag @@@ …`, with deterministic comma-separated custom rules. */
export function toShowdownChallenge(resolved: ResolvedRules): string {
  const rules = (['pokemon', 'moves', 'items', 'abilities'] as const).flatMap((category) => listRules(category, resolved[category]));
  rules.push(...resolved.clauses.map(clauseName));
  return `gen9nationaldexag @@@ ${rules.join(', ')}`;
}
