/**
 * The effective rules of a document: ONE pure function used by the server (at publish, with the dex-backed
 * `PresetRules`) and by the browser (the live summary, with the same `PresetRules` fetched from the server). Nothing
 * here reads the dex or the clock.
 *
 * Per category, in BLOCK mode (the document has no allowlist):
 *   banned = (base banned ∪ ban) \ unban                 (an unban wins over the base, a ban wins over nothing: the
 *                                                          compile reports an id that is in both `ban` and `unban`)
 * in ALLOW mode (the document's `allow` is non-null): the allowed ids are exactly `allow`; the base is ignored.
 * A preset whose own list is an allowlist (a roster, Little Cup) keeps that mode: allowed = (base ∪ unban) \ ban.
 *
 * Clauses: (base clauses ∪ add) \ remove. Generation, universe and game type come from the preset, or from the blank
 * base. Every list in the result is sorted and unique, so equal rules hash equal.
 */
import { parseFormatId } from '@/lib/pkmn/format-id';
import { toID } from '@/lib/pkmn/i18n/id';
import type { PresetList, PresetRules } from '@/lib/pkmn/preset-rules';
import type { TeamConstraints } from '@/types/ruleset';
import {
  RULESET_CATEGORIES,
  type CategoryRules,
  type ResolvedList,
  type ResolvedRules,
  type RulesetCategory,
  type RulesetDocument,
  type RulesetUniverse,
} from './types';

export const RESOLVED_RULES_VERSION = 1;

export function sortedUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

function without(ids: readonly string[], removed: readonly string[]): string[] {
  if (removed.length === 0) return sortedUnique(ids);
  const drop = new Set(removed);
  return sortedUnique(ids.filter((id) => !drop.has(id)));
}

function resolveList(rules: CategoryRules, base: PresetList | null): ResolvedList {
  if (rules.allow !== null) return { mode: 'allow', ids: sortedUnique(rules.allow) };
  if (base !== null && base.mode === 'allow') return { mode: 'allow', ids: without([...base.ids, ...rules.unban], rules.ban) };
  return { mode: 'block', ids: without([...(base?.ids ?? []), ...rules.ban], rules.unban) };
}

/**
 * The format key of a blank base: the `based_on` catalog id when it is one, else the singles or doubles OU of the
 * generation. Usage statistics, tier columns and AI context read it.
 */
export function blankFormatKey(basedOn: string | undefined, gen: number, doubles: boolean): string {
  if (basedOn !== undefined && parseFormatId(basedOn) !== null) return basedOn;
  return `gen${gen}${doubles ? 'doublesou' : 'ou'}`;
}

/**
 * Computes the effective rules of `doc`. `preset` must be the resolved rules of the document's base preset when the base
 * is one (`resolvePresetRules`); a missing preset for a preset base is a programming error and throws (the compile
 * reports `preset_unknown` before it ever gets here).
 */
export function computeEffective(doc: RulesetDocument, preset: PresetRules | null): ResolvedRules {
  let gen: number;
  let universe: RulesetUniverse;
  let doubles: boolean;
  let formatKey: string;
  let baseClauses: readonly string[];
  if (doc.base.kind === 'preset') {
    if (preset === null) throw new Error(`computeEffective: preset ${doc.base.preset} is not resolved`);
    gen = preset.gen;
    universe = preset.universe;
    doubles = preset.doubles;
    formatKey = preset.id;
    baseClauses = preset.clauses;
  } else {
    gen = doc.base.gen;
    universe = doc.base.universe;
    doubles = doc.base.doubles;
    formatKey = blankFormatKey(doc.identity.based_on, gen, doubles);
    baseClauses = [];
  }
  const useBase = doc.base.kind === 'preset' ? preset : null;
  return {
    v: RESOLVED_RULES_VERSION,
    gen,
    format_key: formatKey,
    universe,
    doubles,
    clauses: without([...baseClauses, ...doc.clauses.add], doc.clauses.remove),
    pokemon: resolveList(doc.pokemon, useBase?.pokemon ?? null),
    moves: resolveList(doc.moves, useBase?.moves ?? null),
    items: resolveList(doc.items, useBase?.items ?? null),
    abilities: resolveList(doc.abilities, useBase?.abilities ?? null),
    added_pokemon: sortedUnique(doc.pokemon.unban),
    min_shared_type_pct: doc.min_shared_type_pct,
    team_constraints: doc.team_constraints,
    custom_rules: doc.custom_rules,
  };
}

// ── Synthetic rules (a ruleset that is not a stored document) ────────

export interface SyntheticRulesInput {
  gen: number;
  /** The format key (`gen9ou`, `gen9`); default `gen<gen>ou`. */
  formatKey?: string;
  doubles?: boolean;
  universe?: RulesetUniverse;
  /** Clause names or ids. */
  clauses?: readonly string[];
  /** Banned display names or ids per category. */
  bans?: Partial<Record<RulesetCategory, readonly string[]>>;
  /** Display names or ids that only the allowlist makes legal, per category (an allowlist replaces bans). */
  allow?: Partial<Record<RulesetCategory, readonly string[]>>;
  addedPokemon?: readonly string[];
  minSharedTypePct?: number;
  teamConstraints?: TeamConstraints | null;
  customRules?: string;
}

/**
 * Rules for a ruleset that is built in code from names (the Evolution Point Buy draft room, the AI tools' fallback by
 * format id, test fixtures): the same `ResolvedRules` a stored version has, so one validator reads both.
 */
export function rulesFromBans(input: SyntheticRulesInput): ResolvedRules {
  const list = (category: RulesetCategory): ResolvedList => {
    const allow = input.allow?.[category];
    if (allow !== undefined) return { mode: 'allow', ids: sortedUnique(allow.map(toID).filter((id) => id !== '')) };
    return { mode: 'block', ids: sortedUnique((input.bans?.[category] ?? []).map(toID).filter((id) => id !== '')) };
  };
  return {
    v: RESOLVED_RULES_VERSION,
    gen: input.gen,
    format_key: input.formatKey ?? `gen${input.gen}ou`,
    universe: input.universe ?? 'standard',
    doubles: input.doubles ?? false,
    clauses: sortedUnique((input.clauses ?? []).map(toID).filter((id) => id !== '')),
    pokemon: list('pokemon'),
    moves: list('moves'),
    items: list('items'),
    abilities: list('abilities'),
    added_pokemon: sortedUnique((input.addedPokemon ?? []).map(toID).filter((id) => id !== '')),
    min_shared_type_pct: input.minSharedTypePct ?? 0,
    team_constraints: input.teamConstraints ?? null,
    custom_rules: input.customRules ?? '',
  };
}

// ── Version-to-version difference ───────────────────────────────────

export interface ListDifference {
  /** The mode changed (block to allow or back); the id sets are then not comparable and `added` / `removed` list both. */
  modeChanged: boolean;
  added: string[];
  removed: string[];
}

export interface RulesDifference {
  pokemon: ListDifference;
  moves: ListDifference;
  items: ListDifference;
  abilities: ListDifference;
  clausesAdded: string[];
  clausesRemoved: string[];
  /** Whether anything else (generation, game type, shared-type rule, team constraints, notes) differs. */
  otherChanged: boolean;
}

function diffList(from: ResolvedList, to: ResolvedList): ListDifference {
  const before = new Set(from.ids);
  const after = new Set(to.ids);
  return {
    modeChanged: from.mode !== to.mode,
    added: to.ids.filter((id) => !before.has(id)),
    removed: from.ids.filter((id) => !after.has(id)),
  };
}

/**
 * What changes when a league moves its pin from `from` to `to`: computed from the two FROZEN resolved rules, so a
 * republish that only picked up a corrected catalog shows up here although the documents are equal.
 */
export function diffResolved(from: ResolvedRules, to: ResolvedRules): RulesDifference {
  const fromClauses = new Set(from.clauses);
  const toClauses = new Set(to.clauses);
  return {
    pokemon: diffList(from.pokemon, to.pokemon),
    moves: diffList(from.moves, to.moves),
    items: diffList(from.items, to.items),
    abilities: diffList(from.abilities, to.abilities),
    clausesAdded: to.clauses.filter((id) => !fromClauses.has(id)),
    clausesRemoved: from.clauses.filter((id) => !toClauses.has(id)),
    otherChanged:
      from.gen !== to.gen ||
      from.universe !== to.universe ||
      from.doubles !== to.doubles ||
      from.min_shared_type_pct !== to.min_shared_type_pct ||
      from.custom_rules !== to.custom_rules ||
      JSON.stringify(from.team_constraints) !== JSON.stringify(to.team_constraints) ||
      JSON.stringify(from.added_pokemon) !== JSON.stringify(to.added_pokemon),
  };
}

/** True when the two rules enforce the same thing in every category. */
export function sameEnforcement(a: ResolvedRules, b: ResolvedRules): boolean {
  const d = diffResolved(a, b);
  return (
    !d.otherChanged &&
    d.clausesAdded.length === 0 &&
    d.clausesRemoved.length === 0 &&
    RULESET_CATEGORIES.every((c) => !d[c].modeChanged && d[c].added.length === 0 && d[c].removed.length === 0)
  );
}
