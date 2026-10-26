/**
 * The explicit rule tables of the Showdown ladder formats: the move, item and ability bans of the tier families and
 * the banlists of the formats that have their own (Little Cup, Monotype, 1v1, the National Dex family, the doubles
 * formats). Names are Showdown's English names; `../preset-rules.server.ts` folds them to ids.
 *
 * Source: smogon/pokemon-showdown `config/formats.ts` at `PRESET_DATA_PIN` (./pin.ts); the line of each format at
 * the pin is in the comment above its table. Pokémon bans that follow from a tier (Uber, UUBL, ND OU, ...) are not
 * here: they come from the dex tier data (`getBannedPokemonForTier`).
 *
 * The tables of the pre-existing tier families (`LC`, `Monotype`, `1v1`, the move and item bans of OU to PU) were
 * moved here unchanged from `formats.ts`; they are an older, partly approximate transcription (the diff against
 * the pin is listed in docs/ruleset-presets.md) and stay as they are until each is verified. The National Dex
 * tables, the doubles Ubers and the doubles LC format are new and verified against the pin.
 */

export interface RuleNames {
  readonly pokemon: readonly string[];
  readonly moves: readonly string[];
  readonly items: readonly string[];
  readonly abilities: readonly string[];
}

export const NO_BANS: RuleNames = { pokemon: [], moves: [], items: [], abilities: [] };

// ── Tier families (moved from formats.ts) ────────────────────────────

/** `King's Rock` and `Razor Fang`, banned in OU, UU, NU (and below). */
export const STANDARD_ITEMS_BAN: readonly string[] = ["King's Rock", 'Razor Fang'];

/** Maps our tier keys to the @pkmn/dex tier name used for the dynamic Pokémon lookup. */
export const TIER_KEY_TO_DEX_TIER: Readonly<Record<string, string>> = {
  ou: 'OU',
  uu: 'UU',
  ru: 'RU',
  nu: 'NU',
  pu: 'PU',
  zu: 'ZU',
  ubers: 'Uber',
  ag: 'AG',
};

/** Move bans per tier family (`config/formats.ts` L74-L106 at the pin, gens 6 and up; older generations have none). */
export function ladderMoveBans(tier: string, gen: number): string[] {
  if (gen < 6) return [];
  switch (tier) {
    case 'ou': return ['Baton Pass', 'Last Respects', 'Shed Tail'];
    case 'ubers': return gen === 9 ? ['Baton Pass', 'Last Respects'] : [];
    case 'uu': return ['Baton Pass', 'Shed Tail'];
    case 'ru': return ['Baton Pass'];
    case 'nu': return ['Baton Pass'];
    case 'pu': return ['Baton Pass'];
    default: return [];
  }
}

/** Item bans per tier family (`config/formats.ts` L74-L106 at the pin, gens 6 and up). */
export function ladderItemBans(tier: string, gen: number): string[] {
  if (gen < 6) return [];
  switch (tier) {
    case 'ou':
    case 'uu':
    case 'nu':
      return [...STANDARD_ITEMS_BAN];
    case 'ru':
      return [...STANDARD_ITEMS_BAN, 'Light Clay'];
    case 'pu':
      return [...STANDARD_ITEMS_BAN, 'Damp Rock'];
    default:
      return [];
  }
}

// ── Explicit banlists (Gen 9; moved from formats.ts) ─────────────────

/** `[Gen 9] LC`, `config/formats.ts` L110. */
export const GEN9_LC_BANS: RuleNames = {
  pokemon: [
    'Aipom', 'Basculin-White-Striped', 'Cutiefly', 'Diglett', 'Dunsparce',
    'Duraludon', 'Flittle', 'Gastly', 'Girafarig', 'Gligar', 'Magby',
    'Meditite', 'Misdreavus', 'Murkrow', 'Porygon', 'Qwilfish-Hisui',
    'Rufflet', 'Scraggy', 'Scyther', 'Shellder', 'Sneasel', 'Sneasel-Hisui',
    'Snivy', 'Stantler', 'Torchic', 'Voltorb-Hisui', 'Vulpix', 'Vulpix-Alola',
    'Yanma',
  ],
  moves: ['Baton Pass', 'Sticky Web'],
  items: ['Heat Rock'],
  abilities: [],
};

/** `[Gen 9] Monotype`, `config/formats.ts` L121. */
export const GEN9_MONOTYPE_BANS: RuleNames = {
  pokemon: [
    'Annihilape', 'Arceus', 'Baxcalibur', 'Blaziken', 'Calyrex-Ice',
    'Calyrex-Shadow', 'Chi-Yu', 'Chien-Pao', 'Deoxys', 'Deoxys-Attack',
    'Dialga', 'Dialga-Origin', 'Espathra', 'Eternatus', 'Giratina',
    'Giratina-Origin', 'Gouging Fire', 'Groudon', 'Ho-Oh', 'Iron Bundle',
    'Kingambit', 'Koraidon', 'Kyogre', 'Kyurem-Black', 'Kyurem-White',
    'Lugia', 'Lunala', 'Magearna', 'Mewtwo', 'Miraidon',
    'Necrozma-Dawn-Wings', 'Necrozma-Dusk-Mane', 'Palafin', 'Palkia',
    'Palkia-Origin', 'Rayquaza', 'Reshiram', 'Shaymin-Sky', 'Solgaleo',
    'Ursaluna-Bloodmoon', 'Urshifu', 'Zacian', 'Zacian-Crowned',
    'Zamazenta', 'Zamazenta-Crowned', 'Zekrom',
  ],
  moves: ['Baton Pass', 'Last Respects', 'Shed Tail'],
  items: [
    'Booster Energy', 'Damp Rock', 'Focus Band', "King's Rock",
    'Quick Claw', 'Razor Fang', 'Smooth Rock',
  ],
  abilities: [],
};

/** `[Gen 9] 1v1`, `config/formats.ts` L348. */
export const GEN9_1V1_BANS: RuleNames = {
  pokemon: [
    'Arceus', 'Archaludon', 'Calyrex-Ice', 'Calyrex-Shadow', 'Chi-Yu',
    'Cinderace', 'Deoxys', 'Deoxys-Attack', 'Deoxys-Defense', 'Deoxys-Speed',
    'Dialga', 'Dialga-Origin', 'Dragonite', 'Eternatus', 'Flutter Mane',
    'Gholdengo', 'Giratina', 'Giratina-Origin', 'Gouging Fire', 'Groudon',
    'Ho-Oh', 'Jirachi', 'Koraidon', 'Kyogre', 'Kyurem-Black', 'Kyurem-White',
    'Lugia', 'Lunala', 'Magearna', 'Meloetta', 'Mew', 'Mewtwo', 'Mimikyu',
    'Miraidon', 'Necrozma', 'Necrozma-Dawn-Wings', 'Necrozma-Dusk-Mane',
    'Ogerpon-Cornerstone', 'Ogerpon-Hearthflame', 'Palkia', 'Palkia-Origin',
    'Rayquaza', 'Regidrago', 'Reshiram', 'Scream Tail', 'Shaymin-Sky',
    'Snorlax', 'Solgaleo', 'Terapagos', 'Zacian', 'Zacian-Crowned',
    'Zamazenta', 'Zamazenta-Crowned', 'Zekrom',
  ],
  moves: ['Perish Song'],
  items: [
    'Custap Berry', 'Focus Band', 'Focus Sash', "King's Rock",
    'Quick Claw', 'Razor Fang',
  ],
  abilities: [],
};

// ── Doubles formats ──────────────────────────────────────────────────

/** `[Gen 9] Doubles LC`, `config/formats.ts` L193: the explicit species bans (Little Cup itself is the species rule). */
export const GEN9_DOUBLES_LC_BANS: RuleNames = {
  pokemon: [
    'Basculin-White-Striped', 'Dunsparce', 'Duraludon', 'Girafarig', 'Gligar', 'Misdreavus', 'Murkrow', 'Qwilfish-Hisui',
    'Scyther', 'Sneasel', 'Sneasel-Hisui', 'Stantler', 'Vulpix', 'Vulpix-Alola', 'Yanma',
  ],
  moves: [],
  items: [],
  abilities: [],
};

/** `[Gen 9] National Dex Doubles Ubers`, `config/formats.ts` L802. */
export const GEN9_NATIONAL_DEX_DOUBLES_UBERS_BANS: RuleNames = {
  pokemon: ['Shedinja'],
  moves: ['Assist'],
  items: [],
  abilities: [],
};

// ── National Dex family ──────────────────────────────────────────────

/**
 * The tier a National Dex format bans everything ABOVE (`ND Uber`/`ND AG` for the base format), as the dex tier
 * name; the Pokémon bans come from the `natDexTier` data of the whole National Dex universe.
 */
export const NATIONAL_DEX_TIER_BASE: Readonly<Record<string, string>> = {
  nationaldex: 'OU',
  nationaldexubers: 'Uber',
  nationaldexuu: 'UU',
  nationaldexru: 'RU',
};

const NATIONAL_DEX_ABILITIES = ['Arena Trap', 'Moody', 'Power Construct', 'Shadow Tag'];

/** `[Gen 9] National Dex`, `config/formats.ts` L3703: the bans besides `ND Uber` and `ND AG`. */
const GEN9_NATIONAL_DEX: RuleNames = {
  pokemon: [],
  moves: ['Assist', 'Baton Pass', 'Last Respects', 'Shed Tail'],
  items: ["King's Rock", 'Quick Claw', 'Razor Fang'],
  abilities: NATIONAL_DEX_ABILITIES,
};

/** `[Gen 8] National Dex`, `config/formats.ts` L3712 (no Assist, Last Respects or Shed Tail: they do not exist in Gen 8). */
const GEN8_NATIONAL_DEX: RuleNames = {
  pokemon: [],
  moves: ['Baton Pass'],
  items: ["King's Rock", 'Quick Claw', 'Razor Fang'],
  abilities: NATIONAL_DEX_ABILITIES,
};

const GEN9_NATIONAL_DEX_UU: RuleNames = {
  pokemon: [],
  moves: GEN9_NATIONAL_DEX.moves,
  items: [...GEN9_NATIONAL_DEX.items, 'Light Clay'],
  abilities: [...GEN9_NATIONAL_DEX.abilities, 'Drizzle', 'Drought'],
};

const GEN8_NATIONAL_DEX_UU: RuleNames = {
  pokemon: [],
  moves: GEN8_NATIONAL_DEX.moves,
  items: [...GEN8_NATIONAL_DEX.items, 'Light Clay', 'Slowbronite'],
  abilities: [...GEN8_NATIONAL_DEX.abilities, 'Drizzle', 'Drought'],
};

/**
 * The explicit (non-tier) bans of each National Dex format, by tier key and generation. UU and RU contain the base
 * format's bans (a format that lists the one below it as its ruleset inherits its banlist).
 */
export const NATIONAL_DEX_BANS: Readonly<Record<string, Readonly<Record<number, RuleNames>>>> = {
  // L3703, L3712
  nationaldex: { 9: GEN9_NATIONAL_DEX, 8: GEN8_NATIONAL_DEX },
  // L3725 (`ND AG`, Shedinja, Assist, Baton Pass) and L3942 (`ND AG`, Ultranecrozium Z, Moody, Shadow Tag, Baton Pass)
  nationaldexubers: {
    9: { pokemon: ['Shedinja'], moves: ['Assist', 'Baton Pass'], items: [], abilities: [] },
    8: { pokemon: [], moves: ['Baton Pass'], items: ['Ultranecrozium Z'], abilities: ['Moody', 'Shadow Tag'] },
  },
  // L3731, L3963
  nationaldexuu: { 9: GEN9_NATIONAL_DEX_UU, 8: GEN8_NATIONAL_DEX_UU },
  // L3737 (adds Slowbronite), L3970 (no new bans beyond the tiers)
  nationaldexru: {
    9: { ...GEN9_NATIONAL_DEX_UU, items: [...GEN9_NATIONAL_DEX_UU.items, 'Slowbronite'] },
    8: GEN8_NATIONAL_DEX_UU,
  },
  // L3833: Standard AG + NatDex Mod, no bans
  nationaldexag: { 9: NO_BANS },
};
