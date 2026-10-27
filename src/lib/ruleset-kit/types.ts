/**
 * The ruleset document and the rules it resolves to. Types only; client-safe (no zod, no `@pkmn`, no server code).
 *
 * A ruleset is stored twice, on purpose:
 *  - the DOCUMENT (`RulesetDocument`) is what a person edits: a base (a catalog preset or a blank start) plus
 *    per-category changes relative to it. It is the `spec` of a published version and the draft of a definition;
 *  - the RESOLVED rules (`ResolvedRules`) are the effective rules as dex ids, computed ONCE at publish by
 *    `computeEffective` (./effective.ts) and frozen in the version row. Enforcement reads only the resolved rules, so a
 *    published version never changes when the preset catalog is corrected later ("editing never silently changes a
 *    running league"), and the validator needs neither the dex tier data nor the document.
 *
 * Entries are dex ids (`toID`: `tapukoko`, `stealthrock`, `focussash`, `moody`), never display names.
 */
import type { LText } from '@/lib/studio-core/ltext';
import type { TeamConstraints } from '@/types/ruleset';

export const RULESET_SCHEMA_VERSION = 1;

/** The four lists of a ruleset. */
export const RULESET_CATEGORIES = ['pokemon', 'moves', 'items', 'abilities'] as const;
export type RulesetCategory = (typeof RULESET_CATEGORIES)[number];

/** Which Pokémon, moves, items and abilities exist: what the generation has, or everything it ever had. */
export const RULESET_UNIVERSES = ['standard', 'national'] as const;
export type RulesetUniverse = (typeof RULESET_UNIVERSES)[number];

/**
 * One category of a document, relative to the base.
 *  - `ban`: ids banned in addition to the base; `unban`: ids the base bans, made legal;
 *  - `allow`: non-null switches the category to ALLOWLIST mode, where only the listed ids are legal; `ban` and `unban`
 *    must then be empty (the compile reports `allowlist_with_bans`).
 */
export interface CategoryRules {
  ban: string[];
  unban: string[];
  allow: string[] | null;
}

export type RulesetBase =
  /** A catalog preset (`gen9ou`, `gen9ounlimited`...): its generation, universe, game type, clauses and lists. */
  | { kind: 'preset'; preset: string }
  /** No preset: only what is stated here. */
  | { kind: 'blank'; gen: number; doubles: boolean; universe: RulesetUniverse };

export interface RulesetIdentity {
  name: LText;
  summary?: LText;
  /** The catalog id or slug this ruleset started from (informational; a blank base uses it as the format key). */
  based_on?: string;
}

export interface RulesetDocument {
  schema_version: typeof RULESET_SCHEMA_VERSION;
  identity: RulesetIdentity;
  base: RulesetBase;
  /** Clause ids (`toID` of the Showdown name), relative to the preset's clauses. */
  clauses: { add: string[]; remove: string[] };
  pokemon: CategoryRules;
  moves: CategoryRules;
  items: CategoryRules;
  abilities: CategoryRules;
  /** Integer 0..100: at least this share of the team must share a type (relaxed monotype). 0 switches it off. */
  min_shared_type_pct: number;
  team_constraints: TeamConstraints | null;
  /** Notes and custom rules: shown on the rules page, never enforced. */
  custom_rules: string;
}

/** `block`: the ids are banned and everything else is legal. `allow`: the ids are the only legal ones. */
export interface ResolvedList {
  mode: 'block' | 'allow';
  /** Sorted, unique. */
  ids: string[];
}

/** The frozen effective rules of one published version. */
export interface ResolvedRules {
  v: 1;
  gen: number;
  /**
   * The format key of usage statistics, tier columns, sample sets and AI context: the preset id, or for a blank base
   * the `based_on` catalog id, else `gen<N>ou` / `gen<N>doublesou`. A converted legacy ruleset keeps its old
   * `base_format` verbatim here (`gen9` for a point-buy ruleset).
   */
  format_key: string;
  universe: RulesetUniverse;
  doubles: boolean;
  /** Clause ids, sorted, unique. */
  clauses: string[];
  pokemon: ResolvedList;
  moves: ResolvedList;
  items: ResolvedList;
  abilities: ResolvedList;
  /** Pokémon made legal although the format key's tier bans them (`pokemon.unban` of the document). Sorted, unique. */
  added_pokemon: string[];
  min_shared_type_pct: number;
  team_constraints: TeamConstraints | null;
  custom_rules: string;
}

/** The identity and rules of a stored version, as the readers get it. */
export interface RulesetVersionRef {
  id: string;
  definition_id: string;
  version_no: number;
}
