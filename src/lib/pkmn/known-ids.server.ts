import 'server-only';
/**
 * The ids the dex knows for a category, generation and universe. Server only.
 *
 * The ruleset compiler uses it for the `unknown_entry` warning: an id in a ban, unban or allow list that is not in
 * the set is probably a typo or an entry of another generation. The set is the same universe the preset resolves
 * over: `standard` is what the generation itself has, `national` adds what it dropped (past species, moves, items
 * and abilities, and the unobtainable ones).
 *
 * `presetKnownIds` is the set for one preset. It is `knownIds` of the preset's generation and universe, plus, for a
 * Champions preset, the ids of the roster: the roster has Mega Evolutions and abilities that the dex files under
 * `Future` or lacks altogether (it is older than the Showdown commit the roster was read from), and for that format
 * the roster is the truth, not the dex.
 *
 * Memoised per process; the sets are immutable per deploy.
 */
import { getGeneration, listNationalAbilities, listNationalItems, listNationalMoves, listNationalSpecies } from './dex';
import type { RulesetPreset, RulesetUniverse } from './format-catalog';
import { CHAMPIONS_ROSTER } from './preset-data/champions';

export type KnownIdKind = 'pokemon' | 'moves' | 'items' | 'abilities';

const cache = new Map<string, ReadonlySet<string>>();

function standardIds(kind: KnownIdKind, gen: number): string[] {
  const generation = getGeneration(gen);
  switch (kind) {
    case 'pokemon': return Array.from(generation.species, (s) => s.id);
    case 'moves': return Array.from(generation.moves, (m) => m.id);
    case 'items': return Array.from(generation.items, (i) => i.id);
    case 'abilities': return Array.from(generation.abilities, (a) => a.id);
  }
}

function nationalIds(kind: KnownIdKind, gen: number): string[] {
  switch (kind) {
    case 'pokemon': return listNationalSpecies(gen).map((s) => s.id);
    case 'moves': return listNationalMoves(gen).map((m) => m.id);
    case 'items': return listNationalItems(gen).map((i) => i.id);
    case 'abilities': return listNationalAbilities(gen).map((a) => a.id);
  }
}

/** The ids of `kind` that exist in generation `gen` under `universe`. */
export function knownIds(kind: KnownIdKind, gen: number, universe: RulesetUniverse): ReadonlySet<string> {
  const key = `${kind}:${gen}:${universe}`;
  let ids = cache.get(key);
  if (ids === undefined) {
    ids = new Set(universe === 'national' ? nationalIds(kind, gen) : standardIds(kind, gen));
    cache.set(key, ids);
  }
  return ids;
}

/** The ids of `kind` that exist for `preset`: its generation and universe, and for the Champions mod also its roster. */
export function presetKnownIds(preset: Pick<RulesetPreset, 'gen' | 'universe' | 'mod'>, kind: KnownIdKind): ReadonlySet<string> {
  const base = knownIds(kind, preset.gen, preset.universe);
  if (preset.mod !== 'champions') return base;
  const key = `champions:${kind}:${preset.gen}:${preset.universe}`;
  let ids = cache.get(key);
  if (ids === undefined) {
    ids = new Set([...base, ...CHAMPIONS_ROSTER[kind]]);
    cache.set(key, ids);
  }
  return ids;
}
