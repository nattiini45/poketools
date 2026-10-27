/**
 * The shapes a preset resolves to. Types only (client-safe): the resolution itself needs the dex and lives in
 * `./preset-rules.server.ts`; a client receives these shapes from the server and never computes them.
 *
 * Entries are dex ids (`toID`): `tapukoko`, `stealthrock`, `focussash`, never display names. A name is looked up
 * through the name resolver (`src/lib/pkmn/i18n`) when it is shown.
 */
import type { PresetFacts, PresetMod, PresetSource, RulesetUniverse } from './format-catalog';

/**
 * One category (Pokémon, moves, items, abilities) of a preset: `block` means the ids are banned and everything else
 * is legal; `allow` means only the ids are legal (a roster, or Little Cup's first stages).
 */
export interface PresetList {
  mode: 'block' | 'allow';
  /** Sorted, unique. */
  ids: string[];
}

/** What a preset rules out, resolved for its mod and universe. */
export interface PresetRules {
  id: string;
  name: string;
  gen: number;
  mod: PresetMod;
  universe: RulesetUniverse;
  doubles: boolean;
  source: PresetSource;
  /** Clause ids (`toID` of the Showdown name), in the preset's order. */
  clauses: string[];
  pokemon: PresetList;
  moves: PresetList;
  items: PresetList;
  abilities: PresetList;
  /** The rule facts that are not ban lists (level, team size, ...), copied from the catalog. */
  facts: PresetFacts;
  /** Combination bans the format has and the app does not model, in Showdown's notation. */
  combination_bans: string[];
  /** `PRESET_RULES_VERSION` the rules were resolved with. */
  catalog_version: string;
}

/** The documented Smogon tournament extras of a preset, resolved to ids: what "add Smogon tour bans" applies. */
export interface TourOverlayRules {
  /** The preset the extras belong to. */
  preset: string;
  clausesAdd: string[];
  clausesRemove: string[];
  /** Ids banned in addition to the preset (the overlay bans no Pokémon). Sorted, unique; item groups are expanded. */
  moves: string[];
  items: string[];
  abilities: string[];
  /** The threads the extras come from. */
  sources: string[];
  skipped: string[];
  unresolved: string[];
  catalog_version: string;
}
