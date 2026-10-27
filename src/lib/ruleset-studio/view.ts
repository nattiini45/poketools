import 'server-only';
/**
 * The `Ruleset` read model of a stored version (`src/types/ruleset.ts`). The frozen resolved rules are the enforcement
 * source (`rules`); the name-based members are derived from them with display names hydrated from the dex.
 *
 * A category in allowlist mode has an empty `bans` list and its entries in `allow`. `additions.pokemon` are the Pokémon
 * made legal although the format key's tier bans them (`rules.added_pokemon`).
 */
import type { Json } from '@/types/database';
import type { Ruleset } from '@/types/ruleset';
import { readResolvedRules } from '@/lib/ruleset-kit/resolved';
import type { ResolvedList, RulesetCategory } from '@/lib/ruleset-kit/types';
import { clauseNames, entryNames } from './names.server';

/** The columns a view needs from a version row (never `spec`). */
export interface RulesetVersionViewRow {
  id: string;
  definition_id: string;
  version_no: number;
  name_text: string;
  resolved: Json;
  created_by: string | null;
  created_at: string;
}

export const RULESET_VERSION_VIEW_COLUMNS = 'id, definition_id, version_no, name_text, resolved, created_by, created_at';

function blocked(category: RulesetCategory, list: ResolvedList): string[] {
  return list.mode === 'block' ? entryNames(category, list.ids) : [];
}

function allowed(category: RulesetCategory, list: ResolvedList): string[] | null {
  return list.mode === 'allow' ? entryNames(category, list.ids) : null;
}

export function toRulesetView(row: RulesetVersionViewRow): Ruleset {
  const rules = readResolvedRules(row.resolved);
  return {
    id: row.id,
    name: row.name_text,
    base_format: rules.format_key,
    is_doubles: rules.doubles,
    clauses: clauseNames(rules.clauses),
    bans: {
      pokemon: blocked('pokemon', rules.pokemon),
      moves: blocked('moves', rules.moves),
      items: blocked('items', rules.items),
      abilities: blocked('abilities', rules.abilities),
    },
    additions: { pokemon: entryNames('pokemon', rules.added_pokemon) },
    allow: {
      pokemon: allowed('pokemon', rules.pokemon),
      moves: allowed('moves', rules.moves),
      items: allowed('items', rules.items),
      abilities: allowed('abilities', rules.abilities),
    },
    custom_rules_string: rules.custom_rules,
    min_shared_type_pct: rules.min_shared_type_pct,
    team_constraints: rules.team_constraints,
    gen: rules.gen,
    universe: rules.universe,
    rules,
    version: { definition_id: row.definition_id, version_no: row.version_no },
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

/** The legacy flat JSON the public ruleset routes answer with: the view without the frozen rules. */
export type PublicRuleset = Omit<Ruleset, 'rules'>;

export function toPublicRuleset(ruleset: Ruleset): PublicRuleset {
  const { rules: _rules, ...rest } = ruleset;
  return rest;
}
