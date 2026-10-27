import 'server-only';
/**
 * Resolves a catalog preset to the rules it implies: which Pokémon, moves, items and abilities it rules out (or,
 * for a roster, rules in), per mod. Server only: it reads the dex.
 *
 * WHERE THE DATA COMES FROM. The dex-free catalog (`PRESETS`, ./format-catalog.ts) carries the clauses and the rule
 * facts. The ban data is split by what it needs:
 *  - tier-derived Pokémon bans (Uber, UUBL, ND OU, ...) are read from the dex tier fields (`getBannedPokemonForTier`),
 *    over the preset's UNIVERSE: a National Dex preset reads the whole National Dex, past species included;
 *  - explicit move, item and ability bans are the tables in ./preset-data (`standard.ts`, `draft.ts`), transcribed
 *    from Pokémon Showdown at the pin in `pin.ts` and integrity-tested against the dex;
 *  - the Champions roster is the generated `./preset-data/champions-roster.generated.ts`, an ALLOWLIST;
 *  - a Little Cup preset allows exactly the first stages that have an evolution (the ladder Little Cup only those the
 *    dex tiers as `LC`, which leaves out Showdown's LC Uber species); the ladder NFE allows every species that has an
 *    evolution.
 *
 * RESOLUTION IS PER MOD, never "the base rulesets only": a mod can replace a rule (the gen 3 mod replaces Standard
 * Draft, the champions mod has its own Standard AG and Flat Rules), so the catalog entry's `mod` selects the table:
 * Champions presets use the roster, the other draft presets the draft tables, the ladder presets the tier tables.
 *
 * The result is memoised per process: the data is immutable per deploy. `presetBanNames` is the same data with display
 * names for the legacy flat shape (`FORMAT_DEFAULTS`, `FormatDefaults.banned_*`); an allowlist cannot be written in
 * that shape, so a roster or Little Cup preset shows only its explicit bans there and its allowlist only here.
 */
import { clauseId } from './clauses';
import { getGeneration, listNationalItems, listNationalSpecies } from './dex';
import { getPreset, type RulesetPreset } from './format-catalog';
import { toID } from './i18n/id';
import { CHAMPIONS_ROSTER } from './preset-data/champions';
import { DRAFT_BANS, DRAFT_COMBINATION_BANS, DRAFT_TIER_BANS } from './preset-data/draft';
import { PRESET_RULES_VERSION } from './preset-data/pin';
import {
  GEN9_1V1_BANS,
  GEN9_DOUBLES_LC_BANS,
  GEN9_LC_BANS,
  GEN9_MONOTYPE_BANS,
  GEN9_NATIONAL_DEX_DOUBLES_UBERS_BANS,
  NATIONAL_DEX_BANS,
  NATIONAL_DEX_TIER_BASE,
  NO_BANS,
  TIER_KEY_TO_DEX_TIER,
  ladderItemBans,
  ladderMoveBans,
  type RuleNames,
} from './preset-data/standard';
import { getTourOverlay } from './preset-data/tour-overlay';
import type { PresetList, PresetRules, TourOverlayRules } from './preset-rules';
import { getBannedPokemonForTier } from './tiers';

type Category = 'pokemon' | 'moves' | 'items' | 'abilities';

/** What a preset bans (display names, block lists) and which categories it restricts to a list instead (ids). */
interface Collected {
  names: RuleNames;
  allow: Partial<Record<Category, readonly string[]>>;
}

// ── Little Cup ───────────────────────────────────────────────────────

interface SpeciesLike {
  id: string;
  tier?: string;
  battleOnly?: unknown;
  prevo?: string;
  evos?: readonly string[];
}

function universeSpecies(gen: number, universe: RulesetPreset['universe']): readonly SpeciesLike[] {
  return universe === 'national' ? listNationalSpecies(gen) : Array.from(getGeneration(gen).species);
}

/** The species of the universe that have an evolution in it. Battle-only formes are never a team member, so they are not listed. */
function speciesWithEvolution(gen: number, universe: RulesetPreset['universe']): SpeciesLike[] {
  const species = universeSpecies(gen, universe);
  const ids = new Set(species.map((s) => s.id));
  return species.filter((s) => !s.battleOnly && (s.evos ?? []).some((evo) => ids.has(toID(evo))));
}

/**
 * Showdown's `Little Cup` species rule: the first stage of an evolution line that has an evolution (in the universe
 * being read).
 */
function littleCupSpecies(gen: number, universe: RulesetPreset['universe']): string[] {
  return speciesWithEvolution(gen, universe).filter((s) => !s.prevo).map((s) => s.id);
}

// ── Per-mod collection ───────────────────────────────────────────────

/** The Pokémon Champions mod: the roster is the whole rule (data/mods/champions, see champions-roster.generated.ts). */
function collectChampions(preset: RulesetPreset): Collected {
  // The NatDex Draft widens the pool beyond the champions files; only its species side is known and not committed
  // (`champions_natdex_roster`), so it has no roster list. Draft and 4v4 Doubles Draft share one roster; the
  // Mythical and Restricted Legendary ban of the 4v4 format removes no roster species (none carries those tags).
  if (preset.tier === 'championsnatdexdraft') return { names: NO_BANS, allow: {} };
  return { names: NO_BANS, allow: CHAMPIONS_ROSTER };
}

/** The Smogon draft formats of the gen mods: the draft tables, plus Little Cup's species list for NatDex LC. */
function collectDraft(preset: RulesetPreset): Collected {
  const tierBan = DRAFT_TIER_BANS[preset.id];
  const explicit = DRAFT_BANS[preset.id] ?? NO_BANS;
  const names: RuleNames = {
    ...explicit,
    pokemon: tierBan === undefined ? explicit.pokemon : getBannedPokemonForTier(tierBan, preset.gen, 'tier', preset.universe),
  };
  return preset.rules.littleCup ? { names, allow: { pokemon: littleCupSpecies(preset.gen, preset.universe) } } : { names, allow: {} };
}

/** The ladder formats: tier families, the formats with their own banlist, the National Dex family and the doubles formats. */
function collectLadder(preset: RulesetPreset): Collected {
  const { tier, gen } = preset;

  if (tier === 'doubleslc') {
    // Little Cup, less the explicit species bans.
    const banned = new Set(GEN9_DOUBLES_LC_BANS.pokemon.map(toID));
    return {
      names: GEN9_DOUBLES_LC_BANS,
      allow: { pokemon: littleCupSpecies(gen, preset.universe).filter((id) => !banned.has(id)) },
    };
  }
  if (tier === 'lc') {
    // The ladder Little Cup: the first stages the dex tiers as LC (the dex's own LC Uber and NFE leftovers are not),
    // less the explicit species bans of the generation.
    const names = gen === 9 ? GEN9_LC_BANS : NO_BANS;
    const banned = new Set(names.pokemon.map(toID));
    const pokemon = speciesWithEvolution(gen, preset.universe)
      .filter((s) => !s.prevo && s.tier === 'LC' && !banned.has(s.id))
      .map((s) => s.id);
    return { names, allow: { pokemon } };
  }
  if (tier === 'nfe') {
    // Not Fully Evolved: every species that has an evolution.
    return { names: NO_BANS, allow: { pokemon: speciesWithEvolution(gen, preset.universe).map((s) => s.id) } };
  }
  if (tier === 'nationaldexdoublesubers') return { names: GEN9_NATIONAL_DEX_DOUBLES_UBERS_BANS, allow: {} };

  // The National Dex family: tier-derived bans over the whole National Dex, plus the explicit tables.
  if (tier in NATIONAL_DEX_BANS) {
    const explicit = NATIONAL_DEX_BANS[tier][gen] ?? NO_BANS;
    const base = NATIONAL_DEX_TIER_BASE[tier];
    return {
      names: {
        ...explicit,
        pokemon: [
          ...explicit.pokemon,
          ...(base === undefined ? [] : getBannedPokemonForTier(base, gen, 'natDexTier', 'national')),
        ].sort(),
      },
      allow: {},
    };
  }

  // Formats with explicit banlists (Gen 9 only; VGC regulations are the admin's to set).
  if (gen === 9) {
    switch (tier) {
      case 'monotype': return { names: GEN9_MONOTYPE_BANS, allow: {} };
      case '1v1': return { names: GEN9_1V1_BANS, allow: {} };
      case 'vgc': return { names: NO_BANS, allow: {} };
    }
  }

  // Anything Goes and the doubles Ubers: no bans by definition.
  if (tier === 'ag' || tier === 'doublesubers') return { names: NO_BANS, allow: {} };

  // Doubles OU: the doubles tier hierarchy.
  if (tier === 'doublesou') {
    return {
      names: { ...NO_BANS, pokemon: getBannedPokemonForTier('DOU', gen, 'doublesTier'), moves: ladderMoveBans(tier, gen), items: ladderItemBans(tier, gen) },
      allow: {},
    };
  }

  // Standard singles tier hierarchy: Pokémon from the dex tier data.
  const dexTier = TIER_KEY_TO_DEX_TIER[tier];
  if (dexTier !== undefined) {
    return {
      names: { ...NO_BANS, pokemon: getBannedPokemonForTier(dexTier, gen), moves: ladderMoveBans(tier, gen), items: ladderItemBans(tier, gen) },
      allow: {},
    };
  }

  return { names: NO_BANS, allow: {} };
}

const collectedByPreset = new Map<string, Collected>();

/** The bans and allowlists of a preset, picked by its mod and memoised (the legacy flat view and the resolved rules share it). */
function collect(preset: RulesetPreset): Collected {
  let collected = collectedByPreset.get(preset.id);
  if (collected === undefined) {
    if (preset.mod === 'champions') collected = collectChampions(preset);
    else collected = preset.source === 'smogon-draft' ? collectDraft(preset) : collectLadder(preset);
    collectedByPreset.set(preset.id, collected);
  }
  return collected;
}

// ── Public API ───────────────────────────────────────────────────────

const sortedIds = (values: readonly string[]): string[] => [...new Set(values.map(toID))].sort();

/**
 * The explicit bans of a preset by display name, the legacy flat shape (`FormatDefaults.banned_*`). A category the
 * preset restricts to a list (a roster, Little Cup) shows only its explicit bans here; `resolvePresetRules` has the list.
 * `null` for an id the catalog does not know.
 */
export function presetBanNames(id: string): RuleNames | null {
  const preset = getPreset(id);
  return preset === undefined ? null : collect(preset).names;
}

const resolved = new Map<string, PresetRules>();

function listOf(category: Category, { names, allow }: Collected): PresetList {
  const allowed = allow[category];
  return allowed === undefined ? { mode: 'block', ids: sortedIds(names[category]) } : { mode: 'allow', ids: sortedIds(allowed) };
}

/** The rules a preset implies, resolved for its mod and universe; `null` for an id the catalog does not know. Memoised per catalog id. */
export function resolvePresetRules(id: string): PresetRules | null {
  // Only a catalog id is memoised (the key set is bounded by PRESETS): the id comes from public requests.
  const cached = resolved.get(id);
  if (cached !== undefined) return cached;
  const preset = getPreset(id);
  if (preset === undefined) return null;
  const collected = collect(preset);
  const rules: PresetRules = {
    id: preset.id,
    name: preset.name,
    gen: preset.gen,
    mod: preset.mod,
    universe: preset.universe,
    doubles: preset.gameType === 'doubles',
    source: preset.source,
    clauses: preset.clauses.map(clauseId),
    pokemon: listOf('pokemon', collected),
    moves: listOf('moves', collected),
    items: listOf('items', collected),
    abilities: listOf('abilities', collected),
    facts: preset.rules,
    combination_bans: [...(DRAFT_COMBINATION_BANS[preset.id] ?? [])],
    catalog_version: PRESET_RULES_VERSION,
  };
  resolved.set(id, rules);
  return rules;
}

/**
 * The documented Smogon tournament extras of a draft preset, resolved to ids (item groups expanded from the dex);
 * `null` when the preset has none. This is what "add Smogon tour bans" applies, as ordinary editable bans.
 */
export function resolveTourOverlay(id: string): TourOverlayRules | null {
  const preset = getPreset(id);
  const overlay = getTourOverlay(id);
  if (preset === undefined || overlay === undefined) return null;

  const groupItems: string[] = [];
  const items = overlay.itemGroups.length === 0 ? [] : listNationalItems(preset.gen);
  for (const group of overlay.itemGroups) {
    for (const item of items) {
      if (group === 'z-crystals' ? Boolean(item.zMove) : item.isGem && item.id !== 'normalgem') groupItems.push(item.id);
    }
  }
  return {
    preset: preset.id,
    clausesAdd: overlay.clausesAdd.map(clauseId),
    clausesRemove: overlay.clausesRemove.map(clauseId),
    moves: sortedIds(overlay.bans.moves),
    items: sortedIds([...overlay.bans.items, ...groupItems]),
    abilities: sortedIds(overlay.bans.abilities),
    sources: [...overlay.sources],
    skipped: [...overlay.skipped],
    unresolved: [...overlay.unresolved],
    catalog_version: PRESET_RULES_VERSION,
  };
}
