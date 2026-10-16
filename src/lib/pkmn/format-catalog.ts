import type { BaseFormat } from '@/types/ruleset';

// Client-safe format catalog: generations, tier labels, clause templates and
// format names. It imports neither ./tiers nor ./dex, so 'use client' modules
// (format pickers, ruleset builder) can use it without pulling @pkmn/dex into
// their bundles. The ban lists that need the dex live in ./formats, which
// re-exports everything here (server API unchanged).

export interface FormatDefaults {
  name: string;
  gen: number;
  tier: string;       // Display tier name (e.g. 'OU', 'VGC')
  is_doubles: boolean;
  clauses: string[];
  banned_pokemon: string[];
  banned_moves: string[];
  banned_items: string[];
}

/** The dex-free part of a format: what pickers and summaries display. */
export type FormatSummary = Pick<FormatDefaults, 'name' | 'gen' | 'tier' | 'is_doubles' | 'clauses'>;

// ── Generation metadata ──────────────────────────────────────────────

export interface GenerationInfo {
  num: number;
  shortName: string; // e.g. 'RBY', 'SV'
  label: string;     // e.g. 'Gen 1 (RBY)'
  tiers: string[];   // tier keys available in this gen
}

export const GENERATIONS: GenerationInfo[] = [
  { num: 1, shortName: 'RBY',  label: 'Gen 1 (RBY)',   tiers: ['ou', 'uu', 'nu', 'lc', 'ubers'] },
  { num: 2, shortName: 'GSC',  label: 'Gen 2 (GSC)',   tiers: ['ou', 'uu', 'nu', 'lc', 'ubers'] },
  { num: 3, shortName: 'ADV',  label: 'Gen 3 (ADV)',   tiers: ['ou', 'uu', 'nu', 'lc', 'ubers', 'doublesou'] },
  { num: 4, shortName: 'DPP',  label: 'Gen 4 (DPP)',   tiers: ['ou', 'uu', 'nu', 'lc', 'ubers', 'doublesou'] },
  { num: 5, shortName: 'BW',   label: 'Gen 5 (BW)',    tiers: ['ou', 'uu', 'ru', 'nu', 'lc', 'ubers', 'doublesou'] },
  { num: 6, shortName: 'ORAS', label: 'Gen 6 (ORAS)',  tiers: ['ou', 'uu', 'ru', 'nu', 'pu', 'lc', 'ubers', 'ag', 'doublesou', 'vgc', 'monotype', '1v1'] },
  { num: 7, shortName: 'SM',   label: 'Gen 7 (SM)',    tiers: ['ou', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nfe', 'ubers', 'ag', 'cap', 'doublesou', 'vgc', 'monotype', '1v1'] },
  { num: 8, shortName: 'SwSh', label: 'Gen 8 (SwSh)',  tiers: ['ou', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nfe', 'ubers', 'ag', 'cap', 'doublesou', 'vgc', 'monotype', '1v1', 'nationaldex'] },
  { num: 9, shortName: 'SV',   label: 'Gen 9 (SV)',    tiers: ['ou', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nfe', 'ubers', 'ag', 'cap', 'doublesou', 'vgc', 'monotype', '1v1', 'nationaldex'] },
];

// ── Tier metadata ────────────────────────────────────────────────────

export interface TierInfo {
  key: string;
  label: string;
  is_doubles: boolean;
}

const TIER_DEFS: TierInfo[] = [
  { key: 'ou',          label: 'OU',           is_doubles: false },
  { key: 'uu',          label: 'UU',           is_doubles: false },
  { key: 'ru',          label: 'RU',           is_doubles: false },
  { key: 'nu',          label: 'NU',           is_doubles: false },
  { key: 'pu',          label: 'PU',           is_doubles: false },
  { key: 'lc',          label: 'LC',           is_doubles: false },
  { key: 'ubers',       label: 'Ubers',        is_doubles: false },
  { key: 'ag',          label: 'AG',           is_doubles: false },
  { key: 'doublesou',   label: 'Doubles OU',   is_doubles: true },
  { key: 'vgc',         label: 'VGC',          is_doubles: true },
  { key: 'monotype',    label: 'Monotype',      is_doubles: false },
  { key: '1v1',         label: '1v1',           is_doubles: false },
  { key: 'nationaldex', label: 'National Dex',  is_doubles: false },
  { key: 'zu',          label: 'ZU',            is_doubles: false },
  { key: 'nfe',         label: 'NFE',           is_doubles: false },
  { key: 'cap',         label: 'CAP',           is_doubles: false },
];

const TIER_MAP = new Map(TIER_DEFS.map(t => [t.key, t]));

/** Tier metadata for a tier key ('ou', 'doublesou', …), or undefined. */
export function getTierInfo(tierKey: string): TierInfo | undefined {
  return TIER_MAP.get(tierKey);
}

// ── Clause templates per tier type ───────────────────────────────────

const STANDARD_CLAUSES = [
  'Species Clause',
  'Sleep Clause Mod',
  'OHKO Clause',
  'Evasion Clause',
  'Endless Battle Clause',
];

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
    case 'lc':
    case 'ou':
    case 'uu':
    case 'ru':
    case 'nu':
    case 'pu':
    case 'monotype':
    case 'nationaldex':
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
  for (const gen of GENERATIONS) {
    for (const tierKey of gen.tiers) {
      const tierInfo = TIER_MAP.get(tierKey);
      if (!tierInfo) continue;
      summaries[`gen${gen.num}${tierKey}`] = {
        name: `Gen ${gen.num} ${tierInfo.label}`,
        gen: gen.num,
        tier: tierInfo.label,
        is_doubles: tierInfo.is_doubles,
        clauses: clausesForTier(tierKey, gen.num),
      };
    }
  }
  summaries['blank'] = BLANK_FORMAT_SUMMARY;
  return summaries;
}

/**
 * Every known format id ('gen9ou', …, 'blank') → its name, gen, tier label,
 * doubles flag and default clauses. Same keys as `FORMAT_DEFAULTS` in ./formats.
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
    const tierInfo = TIER_MAP.get(tierKey);
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
const SPECIAL_TIERS = new Set(['monotype', '1v1', 'nationaldex']);

/**
 * Given a format like "gen9ru", returns ordered fallback formats to try
 * when the primary format has no data for a Pokemon.
 * Same generation, different tiers in priority order.
 */
export function getFallbackFormats(format: string): string[] {
  const match = format.match(/^gen(\d+)(.+)$/);
  if (!match) return [];
  const gen = match[1];
  const tier = match[2];

  // Determine which tier list to use
  let pool: string[];
  if (DOUBLES_PRIORITY.includes(tier)) {
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
  const match = format.match(/^gen(\d+)(.+)$/);
  if (!match) return format;
  const gen = match[1];
  const tier = match[2];
  const tierInfo = TIER_MAP.get(tier);
  return `Gen ${gen} ${tierInfo?.label ?? tier.toUpperCase()}`;
}

export const ALL_CLAUSES = [
  'Species Clause',
  'Sleep Clause Mod',
  'OHKO Clause',
  'Evasion Clause',
  'Moody Clause',
  'Endless Battle Clause',
  'Dynamax Clause',
  'Terastal Clause',
  'Item Clause',
  'Batonpass Clause',
];
