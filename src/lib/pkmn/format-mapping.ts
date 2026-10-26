import { generationOrDefault, parseFormatId } from './format-id';

/**
 * Maps a ruleset's base_format to the closest data.pkmn.cc stats format.
 * Used to connect our rulesets to external usage data. Format ids are read with the one parser,
 * `parseFormatId` (./format-id.ts), after lower-casing.
 */

// Common aliases: our base_format → data.pkmn.cc format slug
const FORMAT_ALIASES: Record<string, string> = {
  'gen9vgc': 'gen9vgc2025',
  'gen8vgc': 'gen8vgc2022',
  'gen7vgc': 'gen7vgc2019',
};

/**
 * Maps a ruleset base_format to the closest data.pkmn.cc stats format.
 * Falls back to the gen's OU if no exact match.
 */
export function resolveStatsFormat(baseFormat: string): string | null {
  if (!baseFormat) return null;

  const normalized = baseFormat.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Direct match (e.g. 'gen9ou' → 'gen9ou')
  // This covers most cases since our base_format keys match data.pkmn.cc
  if (normalized.startsWith('gen')) {
    // Check alias first
    if (FORMAT_ALIASES[normalized]) {
      return FORMAT_ALIASES[normalized];
    }
    return normalized;
  }

  return null;
}

/**
 * Extract generation number from a base_format string.
 */
export function getGenFromBaseFormat(baseFormat: string): number {
  return generationOrDefault(baseFormat.toLowerCase()); // default to gen 9
}

/**
 * Extract the tier portion from a base_format string.
 * e.g. 'gen9ou' → 'ou', 'gen9vgc2025' → 'vgc2025'
 */
export function getTierFromBaseFormat(baseFormat: string): string {
  const id = baseFormat.toLowerCase();
  return parseFormatId(id)?.key ?? id;
}

/**
 * Normalize a format tier for matching against smogon_sample_sets format column.
 * The sets table stores just the tier (e.g. 'ou'), not the full format (e.g. 'gen9ou').
 * Also handles VGC year variants → 'vgc'.
 */
export function normalizeTierForSets(tier: string): string {
  // VGC variants all map to the same set pool
  if (tier.startsWith('vgc')) return 'vgc';
  return tier;
}
