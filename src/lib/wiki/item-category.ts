/**
 * Coarse item classifier used by the wiki Items list page for facet filtering.
 *
 * `@pkmn/data` doesn't expose a single categorical enum for items, but it
 * decorates each item with structural fields (megaStone, zMove, onPlate,
 * isBerry, etc.). We bucket items into a small set of user-facing categories
 * leaning on those structural fields first and falling back to name patterns
 * only for the few categories that lack a structural marker.
 */

export const WIKI_ITEM_CATEGORIES = [
  'Berry',
  'Mega Stone',
  'Z-Crystal',
  'Plate',
  'Memory',
  'Choice',
  'Other',
] as const;

export type WikiItemCategory = (typeof WIKI_ITEM_CATEGORIES)[number];

/**
 * Message key of each category (`wikiMessages` `itemCategory.<key>`). The category values themselves stay
 * English: they are the facet's URL values (`?category=Mega Stone`) and the rows' sort keys.
 */
export const WIKI_ITEM_CATEGORY_KEYS = {
  Berry: 'berry',
  'Mega Stone': 'megaStone',
  'Z-Crystal': 'zCrystal',
  Plate: 'plate',
  Memory: 'memory',
  Choice: 'choice',
  Other: 'misc',
} as const satisfies Record<WikiItemCategory, string>;

export type WikiItemCategoryKey = (typeof WIKI_ITEM_CATEGORY_KEYS)[WikiItemCategory];

/**
 * Structural shape of a dex item that we care about. We re-declare the fields
 * we read so this module can be unit-tested with plain fixtures without
 * pulling in @pkmn/dex types.
 */
interface ClassifiableItem {
  name: string;
  isBerry?: boolean;
  naturalGift?: unknown;
  megaStone?: string;
  zMove?: string | true;
  zMoveType?: string;
  onPlate?: string;
  memory?: string;
}

const CHOICE_ITEMS: ReadonlySet<string> = new Set([
  'Choice Band',
  'Choice Scarf',
  'Choice Specs',
]);

export function classifyItem(item: unknown): WikiItemCategory {
  const it = item as ClassifiableItem;
  if (it.isBerry || it.naturalGift) return 'Berry';
  if (it.megaStone) return 'Mega Stone';
  if (it.zMove || it.zMoveType) return 'Z-Crystal';
  if (it.onPlate) return 'Plate';
  if (it.memory || it.name.endsWith(' Memory')) return 'Memory';
  if (CHOICE_ITEMS.has(it.name)) return 'Choice';
  return 'Other';
}
