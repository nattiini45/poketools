/**
 * Namespace `ruleset-studio/diagnostics`: one sentence per diagnostic code of the ruleset compile
 * (`src/lib/ruleset-kit/compile.ts`), the names of the structure problems, the fix labels and the category words the
 * sentences use. The compile reports codes and parameters only; the editor fills `{name}` with the localized entry name,
 * `{category}` with a word from `category.*` and `{clause}` with the clause name.
 */
export default {
  category: {
    pokemon: 'Pokémon',
    moves: 'moves',
    items: 'items',
    abilities: 'abilities',
    clauses: 'clauses',
  },
  code: {
    invalid_structure: 'The document has a structure problem: {issue}.',
    preset_unknown: 'The base preset {preset} is not in the catalog.',
    entry_in_ban_and_unban: '{name} is both banned and unbanned in {category}.',
    allowlist_with_bans: 'The {category} allowlist is on, but there are also bans or unbans. An allowlist replaces them.',
    allowlist_empty: 'The {category} allowlist is empty, so nothing would be legal.',
    duplicate_entry: '{name} is listed twice in {category}.',
    unknown_clause: 'The clause {clause} is not known.',
    clause_in_add_and_remove: 'The clause {clause} is both added and removed.',
    unknown_entry: '{name} is not a known entry of this generation and universe.',
    ban_redundant: '{name} is already banned by the preset, so banning it again changes nothing.',
    unban_not_banned: '{name} is not banned by the preset, so unbanning it changes nothing.',
    clause_informational: 'The clause {clause} is shown on the rules page but the team validator does not check it.',
  },
  structure: {
    not_object: 'a value that must be an object is not',
    unknown_key: 'a member that does not exist',
    bad_schema_version: 'an unsupported schema version',
    bad_text: 'a text that is not a valid bilingual text',
    bad_based_on: 'an invalid "based on" id',
    bad_base: 'an invalid base',
    bad_list: 'a list that is not a list of ids',
    list_too_long: 'a list that is too long',
    bad_id: 'an id with characters that are not allowed',
    bad_percent: 'a percentage outside 0 to 100',
    bad_team_constraints: 'invalid team constraints',
    bad_custom_rules: 'invalid notes',
  },
  fix: {
    remove: 'Remove the entry',
    clear: 'Clear the bans and unbans',
    blank: 'Switch to a blank base',
  },
} as const;
