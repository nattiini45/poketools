// ── Tier constants (dependency-free) ────────────────────────────────
//
// This module intentionally has ZERO imports so it can be used from client
// components. The richer tier helpers in `./tiers.ts` transitively import
// `@pkmn/dex` (server-only); these pure constants are split out so the
// teambuilder picker can group/sort by tier in the browser.

// Ordered lowest → highest. For a given tier, all tiers ABOVE it are banned.
// 'ZU' is the lowest standard singles tier.
export const SINGLES_TIER_ORDER: string[] = [
  'ZU', 'PU', 'PUBL', 'NU', 'NUBL', 'RU', 'RUBL', 'UU', 'UUBL', 'OU', 'Uber', 'AG',
];

export const DOUBLES_TIER_ORDER: string[] = [
  'DPU', 'DNU', 'DRU', 'DUU', 'DOU', 'DUber',
];

/**
 * Display/grouping hierarchy, highest → lowest. Singles tiers first, then
 * doubles, with the non-hierarchy markers NFE / LC at the end. Used to order
 * tier groups in the species picker and to rank Pokémon by tier when sorting.
 *
 * A given format's list only ever contains one family (singles OR doubles), so
 * a single combined order is safe.
 */
export const TIER_GROUP_ORDER: string[] = [
  'AG', 'Uber', 'OU', 'UUBL', 'UU', 'RUBL', 'RU', 'NUBL', 'NU', 'PUBL', 'PU', 'ZU',
  'DUber', 'DOU', 'DUU', 'DRU', 'DNU', 'DPU',
  'NFE', 'LC',
];

/**
 * Rank a display tier for sorting/grouping. Lower number = higher tier.
 * Unknown/untiered (null/undefined or not in the order) sorts last.
 */
export function tierRank(tier: string | null | undefined): number {
  if (!tier) return TIER_GROUP_ORDER.length;
  const idx = TIER_GROUP_ORDER.indexOf(tier);
  return idx === -1 ? TIER_GROUP_ORDER.length : idx;
}

/** Section label for a tier group; null/untiered → '—'. */
export function tierGroupLabel(tier: string | null): string {
  return tier ?? '—';
}
