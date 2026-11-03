import { ABILITY_IDS, ITEM_IDS, MOVE_IDS } from './wiki-overlay-ids.generated';

/**
 * English type names the tera overlay accepts (the URL segment and the TypeBadge key). The proxy checks them before the
 * page streams, so the list lives here and not in the page.
 */
export const WIKI_OVERLAY_TERA_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy', 'Stellar',
] as const;

const KNOWN_IDS = {
  moves: new Set(MOVE_IDS.split('|')),
  items: new Set(ITEM_IDS.split('|')),
  abilities: new Set(ABILITY_IDS.split('|')),
};

const TERA_IDS = new Set(WIKI_OVERLAY_TERA_TYPES.map((type) => type.toLowerCase()));

const WIKI_OVERLAY_PATH = /^\/broadcast\/wiki\/(moves|abilities|items|tera)\/([^/]+)\/?$/;

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * True when `pathname` is a broadcast wiki overlay for a move, ability, item or tera type that does not resolve.
 * Valid names, every other path and the species redirect answer false, so the page stays in charge of them.
 *
 * The id lists come from @pkmn at generation time (`scripts/generate-wiki-overlay-ids.mjs`) so the proxy bundle does not
 * carry the 2 MB dex. A malformed percent escape never resolves; the page would throw on it.
 */
export function isUnknownWikiOverlayName(pathname: string): boolean {
  const match = WIKI_OVERLAY_PATH.exec(pathname);
  if (!match) return false;
  const kind = match[1] as keyof typeof KNOWN_IDS | 'tera';

  let name: string;
  try {
    name = decodeURIComponent(match[2]);
  } catch {
    return true;
  }

  // The tera page matches the lowercased name as written, the dex pages match its @pkmn id.
  if (kind === 'tera') return !TERA_IDS.has(name.toLowerCase());
  const id = toId(name);
  // @pkmn builds "Hidden Power <Type> <base>" spellings on demand; the page resolves them, the list does not.
  if (kind === 'moves' && id.startsWith('hiddenpower')) return false;
  return !KNOWN_IDS[kind].has(id);
}
