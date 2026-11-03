import { ABILITY_IDS, HIDDEN_POWER_TYPES, ITEM_IDS, MOVE_IDS, SPECIES_IDS } from './wiki-overlay-ids.generated';

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

const KNOWN_SPECIES_IDS = new Set(SPECIES_IDS.split('|'));

const HIDDEN_POWER_TYPE_IDS = new Set(HIDDEN_POWER_TYPES.split('|'));

const TERA_IDS = new Set(WIKI_OVERLAY_TERA_TYPES.map((type) => type.toLowerCase()));

const WIKI_OVERLAY_PATH = /^\/broadcast\/wiki\/(moves|abilities|items|tera)\/([^/]+)\/?$/;

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Nidoran♀ and Nidoran♂ are the only species names whose id needs a symbol read as a letter; @pkmn reads
// them as nidoranf and nidoranm. Accents are dropped so Flabébé reaches flabebe.
function toSpeciesId(name: string): string {
  return toId(name.normalize('NFD').replace(/\p{M}+/gu, '').replace(/♀/g, 'f').replace(/♂/g, 'm'));
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
  // @pkmn reads "Hidden Power <Type> <base>" by its leading letters: a known type resolves however it is followed, an
  // unknown type or anything glued on without a digit does not. The id list holds only the base move.
  if (kind === 'moves' && id.startsWith('hiddenpower')) {
    const head = /^[a-z]*/.exec(id)![0];
    const type = head.slice('hiddenpower'.length);
    return type !== '' && !HIDDEN_POWER_TYPE_IDS.has(type);
  }
  return !KNOWN_IDS[kind].has(id);
}

const PUBLIC_WIKI_PATH = /^\/wiki\/(moves|abilities|items)\/([^/]+)\/?$/;
const POKEMON_PATH = /^\/pokemon\/([^/]+)\/?$/;

/**
 * True when pathname is a public wiki detail page (/wiki/{moves,abilities,items}/<name>) or a species page
 * (/pokemon/<name>) whose name resolves to no entity. The public pages resolve a name with the same NatDex walk as
 * the overlays, so the move, item and ability rules above apply unchanged; the tera pages stay with the page, which
 * matches a spelling more loosely than the overlay does.
 *
 * A species name is checked by its id. @pkmn also resolves a few spellings that are not ids: Mega-<name>, Primal-<name>
 * and Gigantamax-<name> are left to the page, and Nidoran♀ / Nidoran♂ and accented letters (Flabébé) are mapped to
 * their ids by `toSpeciesId`. Any other non-ASCII name resolves to no id and gets the 404.
 */
export function isUnknownWikiDetailName(pathname: string): boolean {
  const wiki = PUBLIC_WIKI_PATH.exec(pathname);
  if (wiki) return isUnknownWikiOverlayName('/broadcast' + pathname);

  const species = POKEMON_PATH.exec(pathname);
  if (!species) return false;
  let name: string;
  try {
    name = decodeURIComponent(species[1]);
  } catch {
    return true;
  }
  const id = toSpeciesId(name);
  if (id === '') return true;
  if (/^(mega|primal|gigantamax)/.test(id)) return false;
  return !KNOWN_SPECIES_IDS.has(id);
}