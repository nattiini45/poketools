/**
 * Test fixtures for the `Ruleset` read model (`src/types/ruleset.ts`).
 *
 * A stored ruleset carries its enforcement in `rules` (the frozen resolved rules: dex ids) next to name-based derived
 * views (`bans`, `additions`, `allow`, `clauses`). A test usually thinks in names ("Garchomp is banned"), so
 * `makeRuleset` takes the name-based fields and DERIVES `rules` from them with `rulesFromBans`, the helper the
 * synthetic rulesets of the app use (the point-buy draft room, the AI tools). Pass `rules` to set the frozen rules
 * directly (an allowlist, a National Dex universe).
 *
 * The generation defaults to the one in `base_format` (`gen9ou` is 9).
 */
import { generationOrDefault } from '@/lib/pkmn/format-id';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';
import type { ResolvedRules } from '@/lib/ruleset-kit/types';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import type { Ruleset } from '@/types/ruleset';

export type RulesetOverrides = Partial<Omit<Ruleset, 'rules'>> & { rules?: Partial<ResolvedRules> };

export function makeRuleset(overrides: RulesetOverrides = {}): Ruleset {
  const { rules: ruleOverrides, ...fields } = overrides;
  const base: Omit<Ruleset, 'rules'> = {
    id: 'ruleset-1',
    name: 'Gen 9 OU',
    base_format: 'gen9ou',
    is_doubles: false,
    clauses: ['Species Clause'],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    allow: { pokemon: null, moves: null, items: null, abilities: null },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    gen: generationOrDefault(fields.base_format ?? 'gen9ou'),
    universe: 'standard',
    version: null,
    created_by: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...fields,
  };
  const derived = rulesFromBans({
    gen: base.gen,
    formatKey: base.base_format,
    doubles: base.is_doubles,
    universe: base.universe,
    clauses: base.clauses,
    bans: base.bans,
    allow: {
      ...(base.allow.pokemon === null ? {} : { pokemon: base.allow.pokemon }),
      ...(base.allow.moves === null ? {} : { moves: base.allow.moves }),
      ...(base.allow.items === null ? {} : { items: base.allow.items }),
      ...(base.allow.abilities === null ? {} : { abilities: base.allow.abilities }),
    },
    addedPokemon: base.additions.pokemon,
    minSharedTypePct: base.min_shared_type_pct,
    teamConstraints: base.team_constraints,
    customRules: base.custom_rules_string,
  });
  return { ...base, rules: { ...derived, ...ruleOverrides } };
}

/**
 * A ruleset picker option (`RulesetOption`): the head version of a ruleset as the league, phase and tournament forms list
 * it. `definition_id` defaults to one per id, so two options with different ids are two rulesets; pass the same
 * `definition_id` for two versions of one ruleset. The generation follows `base_format`.
 */
export function makeRulesetOption(overrides: Partial<RulesetOption> = {}): RulesetOption {
  const id = overrides.id ?? 'ruleset-1';
  const baseFormat = overrides.base_format ?? 'gen9ou';
  return {
    id,
    definition_id: `definition-of-${id}`,
    name: 'Gen 9 OU',
    is_doubles: false,
    gen: generationOrDefault(baseFormat),
    base_format: baseFormat,
    version_no: 1,
    ...overrides,
  };
}
