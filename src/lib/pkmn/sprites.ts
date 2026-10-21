/**
 * Sprite name helpers. Pokémon sprite URLs are built only by `./sprite-styles`
 * (`homeSpriteUrl`, `spriteResolver`, `siteSpriteUrl`), which owns every sprite
 * base URL (docs/pkmn.md, "Sprite styles"); item and move-category icons stay here.
 */

/**
 * Normalizes a Pokémon name for PokemonDB HOME sprite URLs.
 * Lowercase, strip non-alphanumeric (keep hyphens), handle Nidoran gender forms.
 * e.g. "Rotom-Wash" → "rotom-wash", "Nidoran♀" → "nidoran-f", "Mr. Mime" → "mr-mime"
 */
export function normalizeName(name: string): string {
  if (!name) return '';

  let normalized = name.toLowerCase();

  // Handle Nidoran gender symbols/suffixes → hyphenated form
  normalized = normalized
    .replace(/nidoran\s*[♀f]/i, 'nidoran-f')
    .replace(/nidoran\s*[♂m]/i, 'nidoran-m');

  // Transliterate accented chars (é→e, etc.) then strip remaining non-ASCII
  normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Replace spaces/dots/special chars with hyphens, then collapse & trim hyphens
  normalized = normalized
    .replace(/[.']+/g, '')           // strip apostrophes and dots (Farfetch'd → farfetchd, Mr. Mime → mr mime)
    .replace(/[^a-z0-9-]/g, '-')     // non-alphanumeric → hyphen
    .replace(/-{2,}/g, '-')          // collapse consecutive hyphens
    .replace(/^-|-$/g, '');          // trim leading/trailing hyphens

  // Map @pkmn regional abbreviations → PokemonDB expanded form names
  const REGIONAL_SUFFIX_MAP: Record<string, string> = {
    '-galar': '-galarian',
    '-alola': '-alolan',
    '-hisui': '-hisuian',
    '-paldea': '-paldean',
  };
  for (const [abbrev, expanded] of Object.entries(REGIONAL_SUFFIX_MAP)) {
    if (normalized.endsWith(abbrev)) {
      normalized = normalized.slice(0, -abbrev.length) + expanded;
      break;
    }
  }

  return normalized;
}

/**
 * Normalizes an item name for the Showdown CDN sprite URL.
 * e.g. "Choice Band" → "choice-band", "Life Orb" → "life-orb", "Leftovers" → "leftovers"
 */
export function normalizeItemName(item: string): string {
  if (!item) return '';
  return item
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

/**
 * Returns the Showdown CDN URL for an item icon sprite.
 * URL format: https://play.pokemonshowdown.com/sprites/itemicons/{item-name}.png
 */
export function getItemSpriteUrl(item: string): string {
  const normalized = normalizeItemName(item);
  return `https://play.pokemonshowdown.com/sprites/itemicons/${normalized}.png`;
}

/**
 * Returns the Showdown CDN URL for a move category icon (Physical/Special/Status).
 * URL format: https://play.pokemonshowdown.com/sprites/categories/{Category}.png
 */
export function getCategorySpriteUrl(category: 'Physical' | 'Special' | 'Status'): string {
  return `https://play.pokemonshowdown.com/sprites/categories/${category}.png`;
}

/**
 * Strips the form suffix to get the base species name.
 * e.g. "basculin-white-striped" → "basculin", "rotom-wash" → "rotom"
 * Returns null if there's no form suffix (already base form).
 */
export function getBaseFormName(name: string): string | null {
  const normalized = normalizeName(name);
  const dashIndex = normalized.indexOf('-');
  if (dashIndex <= 0) return null;
  return normalized.substring(0, dashIndex);
}
