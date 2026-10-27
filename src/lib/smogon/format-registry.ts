/**
 * Maps our internal format keys to data.pkmn.cc stats format slugs.
 * Cross-referenced with /stats/index.json at import time.
 */

// Formats to attempt importing from data.pkmn.cc
// Keyed by our internal gen+tier format string
export const STATS_FORMATS: string[] = [
  // Gen 1
  'gen1ou', 'gen1uu',
  // Gen 2
  'gen2ou', 'gen2uu',
  // Gen 3
  'gen3ou', 'gen3uu', 'gen3ubers',
  // Gen 4
  'gen4ou', 'gen4uu', 'gen4ubers', 'gen4lc',
  // Gen 5
  'gen5ou', 'gen5uu', 'gen5ru', 'gen5nu', 'gen5ubers', 'gen5lc',
  // Gen 6
  'gen6ou', 'gen6uu', 'gen6ru', 'gen6nu', 'gen6pu', 'gen6ubers', 'gen6lc',
  'gen6monotype', 'gen6doublesou',
  // Gen 7
  'gen7ou', 'gen7uu', 'gen7ru', 'gen7nu', 'gen7pu', 'gen7ubers', 'gen7lc',
  'gen7monotype', 'gen7doublesou',
  // Gen 8
  'gen8ou', 'gen8uu', 'gen8ru', 'gen8nu', 'gen8pu', 'gen8ubers', 'gen8lc',
  'gen8monotype', 'gen8nationaldex', 'gen8doublesou',
  // Gen 9
  'gen9ou', 'gen9uu', 'gen9ru', 'gen9nu', 'gen9pu', 'gen9ubers', 'gen9lc',
  'gen9monotype', 'gen9nationaldex', 'gen9doublesou',
  'gen9vgc2024', 'gen9vgc2025', 'gen91v1',
];

/**
 * Fetch the available format list from data.pkmn.cc/stats/index.json.
 * Returns an array of format slugs that have data.
 */
export async function fetchAvailableStatsFormats(): Promise<string[]> {
  const res = await fetch('https://pkmn.github.io/smogon/data/stats/index.json');
  if (!res.ok) {
    throw new Error(`Failed to fetch stats index: ${res.status} ${res.statusText}`);
  }
  const index: Record<string, number> = await res.json();
  return Object.keys(index);
}

/**
 * Pattern for format slugs we care about. Matching against the live index
 * (rather than a static list) means newly published metas — e.g. a fresh
 * gen9vgc2027 — get imported automatically without a code change.
 */
const IMPORTABLE_FORMAT_PATTERN =
  /^gen\d(ou|uu|ru|nu|pu|zu|ubers|lc|nfe|monotype|nationaldex|doublesou|1v1|ag|cap|vgc20\d\d)$/;

/** Whether a data.pkmn.cc stats slug is one we import. */
export function isImportableFormat(slug: string): boolean {
  return IMPORTABLE_FORMAT_PATTERN.test(slug);
}

/**
 * Returns every format published on data.pkmn.cc that matches our pattern.
 * Falls back to the static STATS_FORMATS list if the index can't be fetched.
 */
export async function getImportableFormats(): Promise<string[]> {
  try {
    const available = await fetchAvailableStatsFormats();
    const matched = available.filter(isImportableFormat);
    if (matched.length > 0) return matched.sort();
  } catch {
    // index unreachable — fall through to the static list
  }
  return [...STATS_FORMATS];
}
