import type { BaseFormat } from '@/types/ruleset';
import { parseFormatId } from './format-id';

// Client-safe format catalog: generations, tier labels, clause templates, format names and the PRESETS, the one
// catalog of rule presets (Showdown's ladder formats and the Smogon draft formats). It imports neither ./tiers nor
// ./dex, so 'use client' modules (format pickers, the ruleset builder and the studios) can use it without pulling
// @pkmn/dex into their bundles. A preset carries only what is cheap and dex-free: id, name, generation, mod, game
// type, source, family, universe, clause names and the rule FACTS (level, team size, source generation, ...). The
// ban lists a preset implies are NOT here: they need the dex, and they are resolved on the server per mod by
// `resolvePresetRules` (./preset-rules.server.ts). The ban lists that need the dex live in ./formats, which
// re-exports everything here (server API unchanged).
//
// Format ids: `gen` + one generation digit + tier key (./format-id.ts is the one parser). A key may start with a
// digit (`gen91v1`), which is why nothing may read an id with a greedy digit pattern.

export interface FormatDefaults {
  name: string;
  gen: number;
  tier: string;       // Display tier name (e.g. 'OU', 'VGC')
  is_doubles: boolean;
  clauses: string[];
  banned_pokemon: string[];
  banned_moves: string[];
  banned_items: string[];
  banned_abilities: string[];
}

/** The dex-free part of a format: what pickers and summaries display. */
export type FormatSummary = Pick<FormatDefaults, 'name' | 'gen' | 'tier' | 'is_doubles' | 'clauses'>;

// ── Preset model ─────────────────────────────────────────────────────

/** Which species, moves, items and abilities a preset's lookups read: the generation's own, or its whole National Dex. */
export type RulesetUniverse = 'standard' | 'national';

/** Where a preset comes from: a Pokémon Showdown format, or one of the Smogon draft league formats. */
export type PresetSource = 'showdown' | 'smogon-draft';

/** The Showdown mod whose rules a preset resolves with: one per generation, and the Pokémon Champions mod. */
export type PresetMod = 'gen1' | 'gen2' | 'gen3' | 'gen4' | 'gen5' | 'gen6' | 'gen7' | 'gen8' | 'gen9' | 'champions';

export type PresetGameType = 'singles' | 'doubles';

/** The group a preset is listed under inside its source and generation. */
export type PresetFamily =
  | 'singles'
  | 'doubles'
  | 'national'
  | 'other'
  | 'draft'
  | 'draft-national'
  | 'draft-doubles'
  | 'draft-champions';

/**
 * Documented rules of the source format that the app does not model. The ruleset editor lists them so an admin
 * knows what the preset does NOT enforce.
 *  - `combination_bans`: bans of a combination (an ability with a move, two abilities) of the older draft formats;
 *  - `min_source_gen`: "obtainable from generation N or later" (it cannot be derived from the dex);
 *  - `lgpe_species`: the Let's Go Pikachu/Eevee species the Gen 7 draft re-allows;
 *  - `champions_natdex_roster`: the National Dex pool of the Champions NatDex Draft (only the species side is known);
 *  - `champions_move_legality`: which species may learn which move in Champions (the move list is the union).
 */
export type PresetUnmodelled =
  | 'combination_bans'
  | 'min_source_gen'
  | 'lgpe_species'
  | 'champions_natdex_roster'
  | 'champions_move_legality';

/**
 * The rule facts of a preset that are not a ban list: what a team and a battle look like under it. They are
 * documentation and pre-picks (the app enforces the species and item clauses and the ban lists, nothing here).
 */
export interface PresetFacts {
  teamPreview: boolean;
  /** Adjust Level: every Pokémon plays at this level. */
  level: number | null;
  /** Little Cup: no Pokémon above this level. */
  maxLevel: number | null;
  /** How many Pokémon a player brings out of team preview. */
  pickedTeamSize: number | null;
  /** The smallest team. */
  minTeamSize: number | null;
  /** `Item Clause = N`: at most N of each item; null when the preset has no Item Clause. */
  itemClauseLimit: number | null;
  /** Pokémon must be obtainable from this generation on (a documented rule; see `min_source_gen`). */
  minSourceGen: number | null;
  /** Only unevolved Pokémon that have an evolution. */
  littleCup: boolean;
  unmodelled: readonly PresetUnmodelled[];
}

/** One rule preset of the catalog. */
export interface RulesetPreset {
  /** `gen9ou`, `gen9natdexdraft`: a valid format id. */
  id: string;
  /** `Gen 9 OU`, `Gen 9 NatDex Draft`. Showdown names stay English in every language. */
  name: string;
  gen: number;
  mod: PresetMod;
  gameType: PresetGameType;
  source: PresetSource;
  family: PresetFamily;
  /** The tier key (`ou`, `doublesou`, `natdexdraft`). */
  tier: string;
  /** The tier label (`OU`, `Doubles OU`, `NatDex Draft`). */
  tierLabel: string;
  universe: RulesetUniverse;
  /** Clause NAMES (`Species Clause`), the legacy shape; `clauseId` (./clauses.ts) turns one into its id. */
  clauses: string[];
  rules: PresetFacts;
  /** Showdown's own id of the format, or null where the catalog id stands in for several (VGC regulations). */
  showdownId: string | null;
  /** False for a format Showdown keeps off the ladder search (every draft format, challenge and tournament only). */
  searchShow: boolean;
  /** Whether `tour-overlay.ts` documents Smogon tournament extras for it (the "add Smogon tour bans" toggle). */
  tourOverlay: boolean;
}

/** The families of a source in listing order, with the English label they are searched and (as a fallback) shown by. */
export const PRESET_FAMILIES: readonly { key: PresetFamily; source: PresetSource; label: string }[] = [
  { key: 'singles', source: 'showdown', label: 'Singles' },
  { key: 'doubles', source: 'showdown', label: 'Doubles' },
  { key: 'national', source: 'showdown', label: 'National Dex' },
  { key: 'other', source: 'showdown', label: 'Other' },
  { key: 'draft', source: 'smogon-draft', label: 'Draft' },
  { key: 'draft-national', source: 'smogon-draft', label: 'NatDex Draft' },
  { key: 'draft-doubles', source: 'smogon-draft', label: 'Doubles Draft' },
  { key: 'draft-champions', source: 'smogon-draft', label: 'Champions Draft' },
];

// ── Generation metadata ──────────────────────────────────────────────

export interface GenerationInfo {
  num: number;
  shortName: string; // e.g. 'RBY', 'SV'
  label: string;     // e.g. 'Gen 1 (RBY)'
  tiers: string[];   // tier keys available in this gen (derived from the presets)
}

const GENERATION_NAMES: readonly { num: number; shortName: string; label: string }[] = [
  { num: 1, shortName: 'RBY',  label: 'Gen 1 (RBY)' },
  { num: 2, shortName: 'GSC',  label: 'Gen 2 (GSC)' },
  { num: 3, shortName: 'ADV',  label: 'Gen 3 (ADV)' },
  { num: 4, shortName: 'DPP',  label: 'Gen 4 (DPP)' },
  { num: 5, shortName: 'BW',   label: 'Gen 5 (BW)' },
  { num: 6, shortName: 'ORAS', label: 'Gen 6 (ORAS)' },
  { num: 7, shortName: 'SM',   label: 'Gen 7 (SM)' },
  { num: 8, shortName: 'SwSh', label: 'Gen 8 (SwSh)' },
  { num: 9, shortName: 'SV',   label: 'Gen 9 (SV)' },
];

// ── Tier metadata ────────────────────────────────────────────────────

export interface TierInfo {
  key: string;
  label: string;
  is_doubles: boolean;
}

interface TierDef extends TierInfo {
  source: PresetSource;
  family: PresetFamily;
  universe: RulesetUniverse;
  /** The generations that have the tier. */
  gens: readonly number[];
  /** Showdown's id per generation; omitted: `gen<N><key>`; null: the id stands in for several Showdown formats. */
  showdownId?: (gen: number) => string | null;
  mod?: (gen: number) => PresetMod;
  searchShow?: boolean;
  /** Facts that differ from the generation's defaults. */
  rules?: (gen: number) => Partial<PresetFacts>;
  /** The generations whose preset has documented Smogon tournament extras (`preset-data/tour-overlay.ts`). */
  tourOverlay?: readonly number[];
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function ladder(
  key: string,
  label: string,
  gens: readonly number[],
  extra: Partial<Omit<TierDef, 'key' | 'label' | 'gens' | 'is_doubles' | 'source'>> & { is_doubles?: boolean } = {},
): TierDef {
  const { is_doubles = false, family = is_doubles ? 'doubles' : 'singles', universe = 'standard', ...rest } = extra;
  return { key, label, is_doubles, source: 'showdown', family, universe, gens, ...rest };
}

function draft(
  key: string,
  label: string,
  gens: readonly number[],
  extra: Partial<Omit<TierDef, 'key' | 'label' | 'gens' | 'source'>> & { showdownId: (gen: number) => string },
): TierDef {
  const { is_doubles = false, family = 'draft', universe = 'standard', ...rest } = extra;
  return { key, label, is_doubles, source: 'smogon-draft', family, universe, gens, searchShow: false, ...rest };
}

const ANYTHING_GOES = (gen: number) => `gen${gen}anythinggoes`;

/**
 * Every tier, in the order a gen lists them (ladder first, then the National Dex and the draft formats). The
 * generation table (`GENERATIONS`) is derived from `gens`, so a tier is added in exactly one place.
 */
const TIER_DEFS: readonly TierDef[] = [
  ladder('ou', 'OU', range(1, 9)),
  ladder('uu', 'UU', range(1, 9)),
  ladder('ru', 'RU', range(5, 9)),
  ladder('nu', 'NU', range(1, 9)),
  ladder('pu', 'PU', range(6, 9)),
  ladder('zu', 'ZU', range(7, 9)),
  ladder('lc', 'LC', range(1, 9), { rules: () => ({ littleCup: true, maxLevel: 5 }) }),
  ladder('nfe', 'NFE', range(7, 9)),
  ladder('ubers', 'Ubers', range(1, 9)),
  ladder('ag', 'AG', range(6, 9), { showdownId: ANYTHING_GOES }),
  ladder('cap', 'CAP', range(7, 9)),
  ladder('doublesou', 'Doubles OU', range(3, 9), { is_doubles: true }),
  ladder('doublesubers', 'Doubles Ubers', [9], { is_doubles: true }),
  ladder('doubleslc', 'Doubles LC', [9], { is_doubles: true, searchShow: false, rules: () => ({ littleCup: true, maxLevel: 5 }) }),
  ladder('vgc', 'VGC', range(6, 9), {
    is_doubles: true,
    showdownId: () => null,
    rules: () => ({ level: 50, pickedTeamSize: 4, itemClauseLimit: 1 }),
  }),
  ladder('monotype', 'Monotype', range(6, 9), { family: 'other' }),
  ladder('1v1', '1v1', range(6, 9), { family: 'other', rules: () => ({ pickedTeamSize: 1 }) }),
  ladder('nationaldex', 'National Dex', [8, 9], { family: 'national', universe: 'national' }),
  ladder('nationaldexubers', 'National Dex Ubers', [8, 9], { family: 'national', universe: 'national', searchShow: false }),
  ladder('nationaldexuu', 'National Dex UU', [8, 9], { family: 'national', universe: 'national', searchShow: false }),
  ladder('nationaldexru', 'National Dex RU', [8, 9], { family: 'national', universe: 'national', searchShow: false }),
  ladder('nationaldexag', 'National Dex AG', [9], { family: 'national', universe: 'national', searchShow: false }),
  ladder('nationaldexdoublesubers', 'National Dex Doubles Ubers', [9], {
    is_doubles: true,
    family: 'national',
    universe: 'national',
  }),

  // The Smogon draft league formats (Showdown's "Draft" section; challenge and tournament only). Showdown-faithful:
  // only the rules the source defines. The documented tournament extras are `tour-overlay.ts`.
  draft('draft', 'Draft', range(3, 9), {
    showdownId: (gen) => `gen${gen}draft`,
    rules: (gen) => ({
      teamPreview: gen >= 5,
      minSourceGen: gen === 9 ? 9 : null,
      unmodelled: gen <= 5 ? ['combination_bans'] : gen === 7 ? ['lgpe_species'] : gen === 9 ? ['min_source_gen'] : [],
    }),
  }),
  draft('natdexdraft', 'NatDex Draft', [8, 9], {
    family: 'draft-national',
    universe: 'national',
    showdownId: (gen) => `gen${gen}natdexdraft`,
    rules: (gen) => ({ minSourceGen: gen === 9 ? 1 : null }),
    tourOverlay: [9],
  }),
  draft('natdexlcdraft', 'NatDex LC Draft', [9], {
    family: 'draft-national',
    universe: 'national',
    showdownId: () => 'gen9natdexlcdraft',
    rules: () => ({ minSourceGen: 1, littleCup: true, maxLevel: 5, itemClauseLimit: 2 }),
    tourOverlay: [9],
  }),
  draft('doublesdraft', '6v6 Doubles Draft', [9], {
    is_doubles: true,
    family: 'draft-doubles',
    showdownId: () => 'gen96v6doublesdraft',
    rules: () => ({ minSourceGen: 9, unmodelled: ['min_source_gen'] }),
    tourOverlay: [9],
  }),
  draft('natdexdoublesdraft', 'NatDex 6v6 Doubles Draft', [9], {
    is_doubles: true,
    family: 'draft-doubles',
    universe: 'national',
    showdownId: () => 'gen9natdex6v6doublesdraft',
    rules: () => ({ minSourceGen: 3 }),
  }),
  draft('doubles4draft', '4v4 Doubles Draft', [9], {
    is_doubles: true,
    family: 'draft-doubles',
    showdownId: () => 'gen94v4doublesdraft',
    rules: () => ({ level: 50, pickedTeamSize: 4, itemClauseLimit: 1, minSourceGen: 9, unmodelled: ['min_source_gen'] }),
  }),
  draft('natdexdoubles4draft', 'NatDex 4v4 Doubles Draft', [8], {
    is_doubles: true,
    family: 'draft-doubles',
    universe: 'national',
    showdownId: () => 'gen8natdex4v4doublesdraft',
    rules: () => ({ level: 50, pickedTeamSize: 4, itemClauseLimit: 1 }),
  }),
  draft('championsdraft', 'Champions Draft', [9], {
    family: 'draft-champions',
    mod: () => 'champions',
    // The roster has species outside the Gen 9 dex (past Pokémon, Megas): lookups read the National Dex universe
    // and the preset's allowlists keep it to the roster.
    universe: 'national',
    showdownId: () => 'gen9championsdraft',
    rules: () => ({ level: 50, minTeamSize: 6, unmodelled: ['champions_move_legality'] }),
  }),
  draft('championsnatdexdraft', 'Champions NatDex Draft', [9], {
    family: 'draft-champions',
    mod: () => 'champions',
    universe: 'national',
    showdownId: () => 'gen9championsnatdexdraft',
    rules: () => ({ level: 50, minTeamSize: 6, unmodelled: ['champions_natdex_roster', 'champions_move_legality'] }),
  }),
  draft('champions4doublesdraft', 'Champions 4v4 Doubles Draft', [9], {
    is_doubles: true,
    family: 'draft-champions',
    mod: () => 'champions',
    universe: 'national',
    showdownId: () => 'gen9champions4v4doublesdraft',
    rules: () => ({ level: 50, minTeamSize: 6, pickedTeamSize: 4, itemClauseLimit: 1, unmodelled: ['champions_move_legality'] }),
  }),
];

const TIER_MAP = new Map<string, TierDef>(TIER_DEFS.map((t) => [t.key, t]));

/** Tier metadata for a tier key ('ou', 'doublesou', …), or undefined. */
export function getTierInfo(tierKey: string): TierInfo | undefined {
  const def = TIER_MAP.get(tierKey);
  return def === undefined ? undefined : { key: def.key, label: def.label, is_doubles: def.is_doubles };
}

/** Which source a tier key belongs to, or undefined for a key the catalog does not know. */
export function getTierSource(tierKey: string): PresetSource | undefined {
  return TIER_MAP.get(tierKey)?.source;
}

export const GENERATIONS: GenerationInfo[] = GENERATION_NAMES.map((generation) => ({
  ...generation,
  tiers: TIER_DEFS.filter((def) => def.gens.includes(generation.num)).map((def) => def.key),
}));

// ── Clause templates per tier type ───────────────────────────────────

const STANDARD_CLAUSES = [
  'Species Clause',
  'Sleep Clause Mod',
  'OHKO Clause',
  'Evasion Clause',
  'Endless Battle Clause',
];

/** Showdown's `Standard Draft`: no Species Clause, no Moody Clause, no Item Clause (a league adds what it wants). */
const DRAFT_CLAUSES = ['Nickname Clause', 'Sleep Clause Mod', 'OHKO Clause', 'Evasion Clause', 'Endless Battle Clause'];

/** Showdown's `Standard Doubles` less the Gravity Sleep Clause, as the doubles Ubers format uses it. */
const DOUBLES_CLAUSES = ['Species Clause', 'Nickname Clause', 'OHKO Clause', 'Evasion Moves Clause', 'Endless Battle Clause'];

/** Showdown's `Standard NatDex`. */
const NATIONAL_DEX_CLAUSES = ['Species Clause', 'Nickname Clause', 'OHKO Clause', 'Evasion Clause', 'Sleep Clause Mod', 'Endless Battle Clause'];

function draftClauses(gen: number): string[] {
  switch (gen) {
    case 3:
      // The Gen 3 mod replaces Standard Draft: four more clauses.
      return [...DRAFT_CLAUSES, 'One Boost Passer Clause', 'Freeze Clause Mod', 'Accuracy Moves Clause', 'Baton Pass Trap Clause'];
    case 4:
      // `!Evasion Abilities Clause` leaves the item and move halves of the Evasion Clause.
      return [
        'Nickname Clause', 'Sleep Clause Mod', 'OHKO Clause', 'Evasion Items Clause', 'Evasion Moves Clause',
        'Endless Battle Clause', 'DryPass Clause', 'Accuracy Moves Clause',
      ];
    case 5:
      return [...DRAFT_CLAUSES, 'DryPass Clause', 'Gems Clause', 'Sleep Moves Clause'];
    case 8:
      return [...DRAFT_CLAUSES, 'Dynamax Clause'];
    default:
      return [...DRAFT_CLAUSES];
  }
}

/** Default clause set for a tier key in a generation. */
export function clausesForTier(tier: string, gen: number): string[] {
  switch (tier) {
    case 'ag':
      return ['Endless Battle Clause'];
    case 'vgc':
      return ['Species Clause', 'Item Clause'];
    case 'ubers':
      return [...STANDARD_CLAUSES];
    case '1v1':
      return ['Species Clause', 'Endless Battle Clause'];
    case 'doublesou':
      return [...STANDARD_CLAUSES];
    case 'doublesubers':
      return [...DOUBLES_CLAUSES];
    case 'doubleslc':
      return [...DOUBLES_CLAUSES, 'Gravity Sleep Clause', 'Sleep Clause Mod'];
    case 'nationaldex':
    case 'nationaldexuu':
    case 'nationaldexru':
      return [...NATIONAL_DEX_CLAUSES, gen === 8 ? 'Dynamax Clause' : 'Terastal Clause'];
    case 'nationaldexubers':
      // `!Evasion Clause` + the item and move clauses; Gen 8 keeps the ability clause instead of the item one.
      return [
        'Species Clause', 'Nickname Clause', 'OHKO Clause', 'Sleep Clause Mod', 'Endless Battle Clause', 'Evasion Moves Clause',
        gen === 8 ? 'Evasion Abilities Clause' : 'Evasion Items Clause', 'Mega Rayquaza Clause',
        ...(gen === 8 ? ['Dynamax Clause'] : []),
      ];
    case 'nationaldexag':
      return ['Endless Battle Clause'];
    case 'nationaldexdoublesubers':
      return [...DOUBLES_CLAUSES];
    case 'draft':
      return draftClauses(gen);
    case 'natdexdraft':
      return draftClauses(gen === 8 ? 8 : 9);
    case 'natdexlcdraft':
      return [...DRAFT_CLAUSES, 'Item Clause'];
    case 'doublesdraft':
    case 'natdexdoublesdraft':
      // Sleep Clause Mod and Evasion Clause are repealed.
      return ['Nickname Clause', 'OHKO Clause', 'Endless Battle Clause'];
    case 'doubles4draft':
      return ['Nickname Clause', 'Item Clause', 'Endless Battle Clause'];
    case 'natdexdoubles4draft':
      // Only `!Evasion Moves Clause`: the ability and item halves of the Evasion Clause stay.
      return ['Nickname Clause', 'Item Clause', 'Evasion Abilities Clause', 'Evasion Items Clause', 'Endless Battle Clause'];
    case 'championsdraft':
    case 'championsnatdexdraft':
      // The Champions mod's Standard AG brings the Species Clause (Item Clause repealed).
      return ['Species Clause', ...DRAFT_CLAUSES];
    case 'champions4doublesdraft':
      return ['Species Clause', 'Nickname Clause', 'Item Clause'];
    case 'lc':
    case 'ou':
    case 'uu':
    case 'ru':
    case 'nu':
    case 'pu':
    case 'monotype':
    default: {
      const clauses = [...STANDARD_CLAUSES, 'Moody Clause'];
      // Gen 8 specific
      if (gen === 8) clauses.push('Dynamax Clause');
      // Gen 9 specific
      if (gen === 9 && tier !== 'ag') clauses.push('Terastal Clause');
      return clauses;
    }
  }
}

// ── Presets ──────────────────────────────────────────────────────────

const DEFAULT_FACTS: Omit<PresetFacts, 'teamPreview'> = {
  level: null,
  maxLevel: null,
  pickedTeamSize: null,
  minTeamSize: null,
  itemClauseLimit: null,
  minSourceGen: null,
  littleCup: false,
  unmodelled: [],
};

function buildPreset(def: TierDef, gen: number): RulesetPreset {
  const id = `gen${gen}${def.key}`;
  const clauses = clausesForTier(def.key, gen);
  const overrides = def.rules?.(gen) ?? {};
  const rules: PresetFacts = {
    teamPreview: gen >= 5,
    ...DEFAULT_FACTS,
    itemClauseLimit: clauses.includes('Item Clause') ? 1 : null,
    ...overrides,
  };
  return {
    id,
    name: `Gen ${gen} ${def.label}`,
    gen,
    mod: def.mod?.(gen) ?? (`gen${gen}` as PresetMod),
    gameType: def.is_doubles ? 'doubles' : 'singles',
    source: def.source,
    family: def.family,
    tier: def.key,
    tierLabel: def.label,
    universe: def.universe,
    clauses,
    rules,
    showdownId: def.showdownId === undefined ? id : def.showdownId(gen),
    searchShow: def.searchShow ?? true,
    tourOverlay: def.tourOverlay?.includes(gen) ?? false,
  };
}

/** Every preset of the catalog, generation by generation in the tier order of `TIER_DEFS`. */
export const PRESETS: readonly RulesetPreset[] = GENERATIONS.flatMap((generation) =>
  generation.tiers.map((tier) => buildPreset(TIER_MAP.get(tier) as TierDef, generation.num)),
);

const PRESET_MAP: ReadonlyMap<string, RulesetPreset> = new Map(PRESETS.map((preset) => [preset.id, preset]));

/** The preset of a format id, or `undefined` for an unknown id (and for the ruleset builder's `blank`). */
export function getPreset(id: unknown): RulesetPreset | undefined {
  return typeof id === 'string' ? PRESET_MAP.get(id) : undefined;
}

/** All presets, in listing order. */
export function listPresets(): readonly RulesetPreset[] {
  return PRESETS;
}

// ── Format summaries (no bans) ──────────────────────────────────────

/** The custom blank template's summary. */
export const BLANK_FORMAT_SUMMARY: FormatSummary = {
  name: 'Custom Format',
  gen: 9,
  tier: 'Custom',
  is_doubles: false,
  clauses: [],
};

function buildFormatSummaries(): Record<string, FormatSummary> {
  const summaries: Record<string, FormatSummary> = {};
  for (const preset of PRESETS) {
    summaries[preset.id] = {
      name: preset.name,
      gen: preset.gen,
      tier: preset.tierLabel,
      is_doubles: preset.gameType === 'doubles',
      clauses: preset.clauses,
    };
  }
  summaries['blank'] = BLANK_FORMAT_SUMMARY;
  return summaries;
}

/**
 * Every known format id ('gen9ou', …, 'blank') → its name, gen, tier label, doubles flag and default clauses.
 * Same keys as `FORMAT_DEFAULTS` in ./formats.
 */
export const FORMAT_SUMMARIES: Record<string, FormatSummary> = buildFormatSummaries();

// ── Public helpers ───────────────────────────────────────────────────

/** Summary of a known format id, or undefined. */
export function getFormatSummary(format: string): FormatSummary | undefined {
  return FORMAT_SUMMARIES[format];
}

export function getFormatName(format: BaseFormat): string {
  return FORMAT_SUMMARIES[format]?.name ?? format;
}

/** All valid format IDs (for API validation) */
export function getValidFormats(): string[] {
  return Object.keys(FORMAT_SUMMARIES);
}

/** Get the list of tier options for a given generation number */
export function getTiersForGen(gen: number): { formatId: string; tier: string; label: string }[] {
  const genInfo = GENERATIONS.find(g => g.num === gen);
  if (!genInfo) return [];

  return genInfo.tiers.map(tierKey => {
    const tierInfo = getTierInfo(tierKey);
    return {
      formatId: `gen${gen}${tierKey}`,
      tier: tierKey,
      label: tierInfo?.label ?? tierKey,
    };
  });
}

// ── Fallback format ordering for usage data ─────────────────────────

const SINGLES_PRIORITY = ['ou', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nfe', 'ubers', 'ag', 'cap'];
const DOUBLES_PRIORITY = ['doublesou', 'vgc'];
const SPECIAL_TIERS = new Set(['monotype', '1v1', 'nationaldex', 'nationaldexubers', 'nationaldexuu', 'nationaldexru', 'nationaldexag']);

/**
 * Given a format like "gen9ru", returns ordered fallback formats to try
 * when the primary format has no data for a Pokemon.
 * Same generation, different tiers in priority order. A draft format has no usage statistics of its own and no
 * fallback.
 */
export function getFallbackFormats(format: string): string[] {
  const parsed = parseFormatId(format);
  if (parsed === null || parsed.key === '') return [];
  const { gen, key: tier } = parsed;

  // Determine which tier list to use
  let pool: string[];
  if (getTierSource(tier) === 'smogon-draft') {
    return [];
  } else if (DOUBLES_PRIORITY.includes(tier) || getTierInfo(tier)?.is_doubles === true) {
    pool = DOUBLES_PRIORITY;
  } else if (SPECIAL_TIERS.has(tier)) {
    // Special formats fall back to the singles ladder
    pool = [tier, ...SINGLES_PRIORITY];
  } else if (SINGLES_PRIORITY.includes(tier)) {
    pool = SINGLES_PRIORITY;
  } else {
    // Unknown tier — try OU as last resort
    pool = ['ou'];
  }

  return pool
    .filter((t) => t !== tier)
    .map((t) => `gen${gen}${t}`);
}

/** Extract display label for a format ID, e.g. "gen9ou" → "Gen 9 OU" */
export function formatDisplayName(format: string): string {
  const parsed = parseFormatId(format);
  if (parsed === null || parsed.key === '') return format;
  const tierInfo = getTierInfo(parsed.key);
  return `Gen ${parsed.gen} ${tierInfo?.label ?? parsed.key.toUpperCase()}`;
}

