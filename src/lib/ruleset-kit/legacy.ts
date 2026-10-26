/**
 * The flat shape of the legacy ruleset builder (`RulesetFormData`: names, one list per category) as a document.
 *
 * Used by the builder bridge (the old admin form keeps working until the studio replaces it) and mirrored by the SQL
 * conversion of the stored rows (`ruleset_legacy_spec` in supabase/migrations/20261026100100): a blank base of the
 * old generation and game type, the STANDARD universe, every list as ids (`toID`, the same fold as the SQL
 * `epb_fold_id`), the old added Pokémon minus the banned ones as `unban` (the ban won before and still wins), the old
 * base format kept in `identity.based_on`. No preset is ever guessed from the old base format: the old preset data was a
 * hand-curated approximation, so re-expressing a stored list against the corrected presets would change what is
 * enforced.
 */
import { generationOrDefault } from '@/lib/pkmn/format-id';
import { toID } from '@/lib/pkmn/i18n/id';
import type { RulesetFormData } from '@/types/ruleset';
import { normalizeTeamConstraints } from '@/lib/pkmn/team-constraints';
import { sortedUnique } from './effective';
import { RULESET_SCHEMA_VERSION, type RulesetDocument } from './types';

function ids(names: readonly string[]): string[] {
  return sortedUnique(names.map(toID).filter((id) => id !== ''));
}

/** The document equal to a flat legacy form. `team_constraints` of an empty block is stored as `null`. */
export function legacyFormToDocument(form: RulesetFormData): RulesetDocument {
  const banned = ids(form.banned_pokemon);
  const bannedSet = new Set(banned);
  const baseFormat = form.base_format.trim();
  return {
    schema_version: RULESET_SCHEMA_VERSION,
    identity: {
      name: { base: 'en', en: { v: form.name.trim() === '' ? 'Ruleset' : form.name.trim(), s: 'human' } },
      ...(baseFormat !== '' && baseFormat !== 'blank' ? { based_on: baseFormat } : {}),
    },
    base: { kind: 'blank', gen: generationOrDefault(baseFormat), doubles: form.is_doubles, universe: 'standard' },
    clauses: { add: ids(form.clauses), remove: [] },
    pokemon: { ban: banned, unban: ids(form.added_pokemon).filter((id) => !bannedSet.has(id)), allow: null },
    moves: { ban: ids(form.banned_moves), unban: [], allow: null },
    items: { ban: ids(form.banned_items), unban: [], allow: null },
    abilities: { ban: ids(form.banned_abilities), unban: [], allow: null },
    min_shared_type_pct: form.min_shared_type_pct,
    team_constraints: normalizeTeamConstraints(form.team_constraints),
    custom_rules: form.custom_rules_string,
  };
}
