/**
 * Copyable Pokémon Showdown challenge rules for a frozen ruleset. Pure and client-safe: resolved rules store dex ids,
 * and Showdown applies the same id folding to custom-rule entries. Allowlists first rule out the whole category.
 *
 * Three facts about Showdown's custom-rule parser shape the output:
 *  - an id that names more than one kind of entry is refused ("More than one thing matches ... use something like
 *    -item:metronome"; `metronome` is a move and an item), so every entry carries its kind: `+pokemon:pikachu`,
 *    `-move:metronome`, `-item:metronome`;
 *  - a rule that names a BASE species (`+pokemon:rayquaza`) covers all its formes, Megas and Primals included, so an
 *    allowlist entry is followed by an explicit `-pokemon:<forme>` for every forme the ruleset does not list;
 *  - Showdown cannot tell the patterns of a cosmetic forme apart (Vivillon, Deerling and Sawsbuck seasons), so a cosmetic
 *    entry becomes its base species. The app's own team check still enforces the exact pattern.
 * The forme facts come from the dex, which this file does not import (it is client-safe): a caller that has the dex passes a
 * `lookup`. Without one the output is the plain per-entry list, which is right for a ruleset without formes.
 *
 * Not expressible in a challenge: level rules, the app's team constraints, and the per-player pools of a community preset.
 */
import { clauseName } from './clauses';
import type { ResolvedList, ResolvedRules, RulesetCategory } from '@/lib/ruleset-kit/types';

const ALL: Record<RulesetCategory, string> = {
  pokemon: 'All Pokemon',
  moves: 'All Moves',
  items: 'All Items',
  abilities: 'All Abilities',
};

/** Showdown's name for the kind of entry, the prefix that disambiguates an id. */
const KIND: Record<RulesetCategory, string> = {
  pokemon: 'pokemon',
  moves: 'move',
  items: 'item',
  abilities: 'ability',
};

/** What the dex says about a Pokémon id, as far as a challenge needs it. */
export interface ChallengeSpeciesInfo {
  /** For a cosmetic forme (a pattern or season with the same battle data), the id of its base species; else null. */
  cosmeticOf: string | null;
  /** For a base species, the ids of its other formes (Megas, Primals, Origin formes, regional formes); else empty. */
  formes: readonly string[];
}

/** The dex lookup a caller with the dex supplies; null for an id the dex does not know. */
export type ChallengeSpeciesLookup = (id: string) => ChallengeSpeciesInfo | null;

const entry = (category: RulesetCategory, id: string): string => `${KIND[category]}:${id}`;

function allowRules(list: ResolvedList, lookup: ChallengeSpeciesLookup | undefined): string[] {
  const allowed = new Set(list.ids);
  const allow = new Set<string>();
  const forbidden = new Set<string>();
  for (const id of list.ids) {
    const info = lookup?.(id) ?? null;
    allow.add(entry('pokemon', info?.cosmeticOf ?? id));
    // A base-species rule opens every forme: close the ones the ruleset does not list.
    for (const forme of info?.formes ?? []) if (!allowed.has(forme)) forbidden.add(entry('pokemon', forme));
  }
  return [`-${ALL.pokemon}`, ...[...allow].map((rule) => `+${rule}`), ...[...forbidden].map((rule) => `-${rule}`)];
}

function listRules(category: RulesetCategory, list: ResolvedList, lookup: ChallengeSpeciesLookup | undefined): string[] {
  if (list.mode === 'allow') {
    return category === 'pokemon'
      ? allowRules(list, lookup)
      : [`-${ALL[category]}`, ...list.ids.map((id) => `+${entry(category, id)}`)];
  }
  return list.ids.map((id) => `-${entry(category, id)}`);
}

/**
 * The Showdown format the challenge is added to. A format with bans of its own would keep them next to ours, so the base is
 * the least restrictive one that has the generation, universe and game type: Anything Goes (Gen 6-9), National Dex AG
 * (Gen 9), else the generation's Custom Game.
 */
export function showdownChallengeFormat(rules: Pick<ResolvedRules, 'gen' | 'universe' | 'doubles'>): string {
  const { gen, universe, doubles } = rules;
  if (!doubles && universe === 'national' && gen === 9) return 'gen9nationaldexag';
  if (!doubles && universe === 'standard' && gen >= 6 && gen <= 9) return `gen${gen}anythinggoes`;
  return `gen${gen}${doubles ? 'doubles' : ''}customgame`;
}

/** `gen9nationaldexag @@@ …`, with deterministic comma-separated custom rules. */
export function toShowdownChallenge(resolved: ResolvedRules, lookup?: ChallengeSpeciesLookup): string {
  const rules = (['pokemon', 'moves', 'items', 'abilities'] as const).flatMap((category) => listRules(category, resolved[category], lookup));
  rules.push(...resolved.clauses.map(clauseName));
  return `${showdownChallengeFormat(resolved)} @@@ ${rules.join(', ')}`;
}
