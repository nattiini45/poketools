import type { BaseFormat } from '@/types/ruleset';
import { getBannedPokemonForTier } from './tiers';
import {
  BLANK_FORMAT_SUMMARY,
  GENERATIONS,
  clausesForTier,
  getTierInfo,
  type FormatDefaults,
} from './format-catalog';

// Format metadata for the ruleset builder. Pokemon bans for standard tiers
// (OU, UU, RU, etc.) are generated dynamically from @pkmn/dex tier data.
// Non-standard formats (Monotype, 1v1, etc.) use explicit banlists from
// Pokemon Showdown's config/formats.ts.
//
// Server-side: this module reaches @pkmn/dex through ./tiers. Client code
// imports the dex-free catalog (generations, tier labels, clauses, names)
// from ./format-catalog instead; everything there is re-exported here.

export {
  ALL_CLAUSES,
  BLANK_FORMAT_SUMMARY,
  FORMAT_SUMMARIES,
  GENERATIONS,
  clausesForTier,
  formatDisplayName,
  getFallbackFormats,
  getFormatName,
  getFormatSummary,
  getTierInfo,
  getTiersForGen,
  getValidFormats,
} from './format-catalog';
export type { FormatDefaults, FormatSummary, GenerationInfo, TierInfo } from './format-catalog';

// ── Standard item/move bans shared across tiers ─────────────────────

const STANDARD_ITEMS_BAN = ['King\'s Rock', 'Razor Fang'];

// ── Explicit banlists for non-tier-based formats (Gen 9) ────────────
// Sourced from Pokemon Showdown config/formats.ts.
// These formats have their own curated banlists independent of the
// standard singles tier hierarchy.

const GEN9_LC_BANS = {
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
};

const GEN9_MONOTYPE_BANS = {
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
    'Booster Energy', 'Damp Rock', 'Focus Band', 'King\'s Rock',
    'Quick Claw', 'Razor Fang', 'Smooth Rock',
  ],
};

const GEN9_1V1_BANS = {
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
    'Custap Berry', 'Focus Band', 'Focus Sash', 'King\'s Rock',
    'Quick Claw', 'Razor Fang',
  ],
};

// ── Tier-to-dex-tier mapping ────────────────────────────────────────
// Maps our tier keys to the @pkmn/dex tier name used for dynamic lookup.

const TIER_KEY_TO_DEX: Record<string, string> = {
  ou: 'OU',
  uu: 'UU',
  ru: 'RU',
  nu: 'NU',
  pu: 'PU',
  zu: 'ZU',
  ubers: 'Uber',
  ag: 'AG',
};

// ── Move/item bans per tier (not available from @pkmn/dex) ──────────
// From Pokemon Showdown config/formats.ts — these rarely change.

function moveBansForTier(tier: string, gen: number): string[] {
  if (gen < 6) return [];
  switch (tier) {
    case 'ou': return ['Baton Pass', 'Last Respects', 'Shed Tail'];
    case 'ubers': return gen === 9 ? ['Baton Pass', 'Last Respects'] : [];
    case 'uu': return ['Baton Pass', 'Shed Tail'];
    case 'ru': return ['Baton Pass'];
    case 'nu': return ['Baton Pass'];
    case 'pu': return ['Baton Pass'];
    case 'nationaldex': return ['Baton Pass'];
    case 'doublesou': return [];
    case 'vgc': return [];
    case 'ag': return [];
    default: return [];
  }
}

function itemBansForTier(tier: string, gen: number): string[] {
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
    case 'ubers':
    case 'ag':
    case 'doublesou':
    case 'vgc':
      return [];
    case 'nationaldex':
      return [...STANDARD_ITEMS_BAN];
    default:
      return [];
  }
}

// ── Main ban builder ────────────────────────────────────────────────

function bansForFormat(tier: string, gen: number): { pokemon: string[]; moves: string[]; items: string[] } {
  // Formats with explicit (non-tier-based) banlists — Gen 9 only
  if (gen === 9) {
    switch (tier) {
      case 'lc': return GEN9_LC_BANS;
      case 'monotype': return GEN9_MONOTYPE_BANS;
      case '1v1': return GEN9_1V1_BANS;
      case 'vgc':
        // VGC uses regulation-dependent restrictions; admin customizes
        return { pokemon: [], moves: [], items: [] };
    }
  }

  // AG — no bans by definition
  if (tier === 'ag') {
    return { pokemon: [], moves: [], items: [] };
  }

  // Doubles OU — uses doublesTier hierarchy
  if (tier === 'doublesou') {
    return {
      pokemon: getBannedPokemonForTier('DOU', gen, 'doublesTier'),
      moves: moveBansForTier(tier, gen),
      items: itemBansForTier(tier, gen),
    };
  }

  // National Dex — uses natDexTier hierarchy
  if (tier === 'nationaldex') {
    return {
      pokemon: getBannedPokemonForTier('OU', gen, 'natDexTier'),
      moves: moveBansForTier(tier, gen),
      items: itemBansForTier(tier, gen),
    };
  }

  // Standard singles tier-hierarchy formats: dynamically query @pkmn/dex
  const dexTier = TIER_KEY_TO_DEX[tier];
  if (dexTier) {
    return {
      pokemon: getBannedPokemonForTier(dexTier, gen),
      moves: moveBansForTier(tier, gen),
      items: itemBansForTier(tier, gen),
    };
  }

  return { pokemon: [], moves: [], items: [] };
}

// ── Generate FORMAT_DEFAULTS from templates ──────────────────────────

function buildFormatDefaults(): Record<string, FormatDefaults> {
  const defaults: Record<string, FormatDefaults> = {};

  for (const gen of GENERATIONS) {
    for (const tierKey of gen.tiers) {
      const tierInfo = getTierInfo(tierKey);
      if (!tierInfo) continue;

      const formatId = `gen${gen.num}${tierKey}`;
      const bans = bansForFormat(tierKey, gen.num);

      defaults[formatId] = {
        name: `Gen ${gen.num} ${tierInfo.label}`,
        gen: gen.num,
        tier: tierInfo.label,
        is_doubles: tierInfo.is_doubles,
        clauses: clausesForTier(tierKey, gen.num),
        banned_pokemon: bans.pokemon,
        banned_moves: bans.moves,
        banned_items: bans.items,
      };
    }
  }

  // Custom blank template
  defaults['blank'] = {
    ...BLANK_FORMAT_SUMMARY,
    clauses: [...BLANK_FORMAT_SUMMARY.clauses],
    banned_pokemon: [],
    banned_moves: [],
    banned_items: [],
  };

  return defaults;
}

export const FORMAT_DEFAULTS: Record<string, FormatDefaults> = buildFormatDefaults();

// ── Public helpers ───────────────────────────────────────────────────

export function getFormatDefaults(format: BaseFormat): FormatDefaults {
  return FORMAT_DEFAULTS[format] ?? FORMAT_DEFAULTS['blank'];
}
