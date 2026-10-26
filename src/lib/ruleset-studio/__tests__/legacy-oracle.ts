/**
 * The OLD behaviour, kept verbatim as the oracle of the Ruleset Studio migration (test code only, never imported by the app).
 *
 *  - `LegacyRow` is a row of the dropped `rulesets` table; `legacyView` is the old `toRuleset` (names in lists);
 *  - `isCustomLeagueRuleset` and `resolveEffective` are the old resolver of `src/lib/supabase/queries/rulesets.ts`, run over
 *    in-memory rows instead of queries (same precedence: the phase's own custom ruleset, the league's custom ruleset, a
 *    custom ruleset named like the league for group-phase brackets, the phase's own);
 *  - `legacyRuleIssues` is the ban and clause part of the old `validateTeam`: lower-case NAME comparison of species,
 *    moves, items and abilities, and the two enforced clauses;
 *  - `convertLegacyRow` is the TypeScript twin of the SQL conversion in `supabase/migrations/20261026100100`.
 *
 * The migration is behaviour-exact when the SQL pins equal `resolveEffective` for every phase and league, the SQL
 * `resolved` equals `convertLegacyRow` for every row, and `validateTeam` of the converted rules equals `legacyRuleIssues`.
 */
import { toID } from '@/lib/pkmn/i18n/id';
import { generationOrDefault } from '@/lib/pkmn/format-id';
import { getAbility, getItem, getMove, getSpecies } from '@/lib/pkmn/dex';
import type { PokemonSet } from '@/types/team';

export interface LegacyRow {
  id: string;
  name: string;
  base_format: string;
  is_doubles: boolean;
  clauses: string[];
  banned_pokemon: string[];
  banned_moves: string[];
  banned_items: string[];
  banned_abilities: string[];
  added_pokemon: string[];
  custom_rules_string: string;
  min_shared_type_pct: number;
  team_constraints: unknown;
  created_at: string;
}

// ── The old resolver ─────────────────────────────────────────────────

/** The old `isCustomLeagueRuleset`: team constraints set, custom rules not blank (JS `trim`), or added Pokémon. */
export function isCustomLeagueRuleset(row: LegacyRow): boolean {
  if (row.team_constraints) return true;
  if (row.custom_rules_string && row.custom_rules_string.trim().length > 0) return true;
  return (row.added_pokemon?.length ?? 0) > 0;
}

export interface LegacyPhase {
  ruleset_id: string;
  bracket_type: string;
}

export interface LegacySeason {
  name: string;
  ruleset_id: string | null;
}

const isPlayoffBracketType = (bracketType: string | null | undefined): boolean => {
  if (!bracketType) return false;
  const bt = bracketType.toLowerCase();
  return bt === 'single_elim' || bt === 'double_elim' || bt === 'swiss';
};

/**
 * The id of the ruleset the old resolver enforced for a phase: its own if custom; else the league's if custom; else (not
 * for playoff brackets) the OLDEST custom ruleset named like the league (the old code took the first of an unordered
 * `limit 5`; the migration documents the oldest); else the phase's own.
 */
export function resolveEffective(phase: LegacyPhase, season: LegacySeason | null, rows: readonly LegacyRow[]): string {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const own = byId.get(phase.ruleset_id);
  if (own && isCustomLeagueRuleset(own)) return own.id;
  if (season?.ruleset_id) {
    const league = byId.get(season.ruleset_id);
    if (league && isCustomLeagueRuleset(league)) return league.id;
  }
  if (!isPlayoffBracketType(phase.bracket_type) && season?.name) {
    const named = rows
      .filter((r) => r.name === season.name && isCustomLeagueRuleset(r))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    if (named[0]) return named[0].id;
  }
  return phase.ruleset_id;
}

/** The ruleset the migration gives a league as its default: its own if custom, else a custom one named like it, else its own. */
export function resolveLeagueDefault(season: LegacySeason, rows: readonly LegacyRow[]): string | null {
  if (season.ruleset_id === null) return null;
  const own = rows.find((r) => r.id === season.ruleset_id);
  if (own && isCustomLeagueRuleset(own)) return own.id;
  const named = rows
    .filter((r) => r.name === season.name && isCustomLeagueRuleset(r))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return named[0]?.id ?? season.ruleset_id;
}

// ── The old validator (bans and clauses) ─────────────────────────────

export interface LegacyIssue {
  /** The old English text. */
  issue: string;
  /** The validation code the new validator reports for the same finding. */
  code: string;
  pokemon_index?: number;
}

const lower = (names: readonly string[]): ReadonlySet<string> => new Set(names.map((n) => n.toLowerCase()));

/** The ban, clause and shared-type findings of the old `validateTeam`, in the old order. */
export function legacyRuleIssues(pokemon: readonly PokemonSet[], row: LegacyRow): LegacyIssue[] {
  const gen = generationOrDefault(row.base_format);
  const bannedPokemon = lower(row.banned_pokemon);
  const bannedMoves = lower(row.banned_moves);
  const bannedItems = lower(row.banned_items);
  const bannedAbilities = lower(row.banned_abilities);
  const issues: LegacyIssue[] = [];

  pokemon.forEach((set, i) => {
    const species = getSpecies(set.species, gen);
    if (!species) {
      issues.push({ issue: `Unknown species: ${set.species}`, code: 'unknown_species', pokemon_index: i });
      return;
    }
    if (bannedPokemon.has(species.name.toLowerCase())) issues.push({ issue: `${species.name} is banned`, code: 'species_banned', pokemon_index: i });
    for (const moveName of set.moves) {
      const move = getMove(moveName, gen);
      if (!move) issues.push({ issue: `Unknown move: ${moveName}`, code: 'unknown_move', pokemon_index: i });
      else if (bannedMoves.has(move.name.toLowerCase())) issues.push({ issue: `${move.name} is banned`, code: 'move_banned', pokemon_index: i });
    }
    if (set.item) {
      const item = getItem(set.item, gen);
      if (!item) issues.push({ issue: `Unknown item: ${set.item}`, code: 'unknown_item', pokemon_index: i });
      else if (bannedItems.has(item.name.toLowerCase())) issues.push({ issue: `${item.name} is banned`, code: 'item_banned', pokemon_index: i });
    }
    if (set.ability) {
      const ability = getAbility(set.ability, gen);
      if (!ability) issues.push({ issue: `Unknown ability: ${set.ability}`, code: 'unknown_ability', pokemon_index: i });
      else if (bannedAbilities.has(ability.name.toLowerCase())) issues.push({ issue: `${ability.name} is banned`, code: 'ability_banned', pokemon_index: i });
    }
  });

  if (row.clauses.includes('Species Clause')) {
    const seen = new Set<string>();
    for (const set of pokemon) {
      const species = getSpecies(set.species, gen);
      if (!species) continue;
      const key = (species.baseSpecies ?? species.name).toLowerCase();
      if (seen.has(key)) issues.push({ issue: `Species Clause: ${key}`, code: 'species_clause' });
      else seen.add(key);
    }
  }
  if (row.clauses.includes('Item Clause')) {
    const seen = new Set<string>();
    for (const set of pokemon) {
      if (!set.item) continue;
      const key = set.item.toLowerCase();
      if (seen.has(key)) issues.push({ issue: `Item Clause: ${key}`, code: 'item_clause' });
      else seen.add(key);
    }
  }
  return issues;
}

// ── The TypeScript twin of the SQL conversion ────────────────────────

const ids = (names: readonly string[]): string[] => [...new Set(names.map(toID).filter((id) => id !== ''))].sort();

/** The `resolved` the SQL `ruleset_legacy_resolved` writes for a row. */
export function convertLegacyRow(row: LegacyRow): Record<string, unknown> {
  const banned = ids(row.banned_pokemon);
  return {
    v: 1,
    gen: /^gen([1-9])/.exec(row.base_format)?.[1] ? Number(/^gen([1-9])/.exec(row.base_format)?.[1]) : 9,
    format_key: row.base_format.trim() === '' ? 'blank' : row.base_format.trim(),
    universe: 'standard',
    doubles: row.is_doubles,
    clauses: ids(row.clauses),
    pokemon: { mode: 'block', ids: banned },
    moves: { mode: 'block', ids: ids(row.banned_moves) },
    items: { mode: 'block', ids: ids(row.banned_items) },
    abilities: { mode: 'block', ids: ids(row.banned_abilities) },
    added_pokemon: ids(row.added_pokemon).filter((id) => !banned.includes(id)),
    min_shared_type_pct: row.min_shared_type_pct ?? 0,
    team_constraints: row.team_constraints ?? null,
    custom_rules: row.custom_rules_string ?? '',
  };
}
