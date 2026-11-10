import { BALL_SPRITE_CELL, BALL_SPRITE_SHEET_URL, type BallSpriteCoords } from './ball-sprites';
import { getItemSpriteUrl } from './sprites';

/**
 * The item icons the redesign uses for nav, tabs, section headers and states (the approved map,
 * renders/design-direction/item-icon-map.png). Most are Showdown's per-file item icons; the four that only exist on
 * the item sheet carry pinned coordinates, captured once like `ball-sprites.ts`:
 *
 *   node -e "const {Icons}=require('@pkmn/img');
 *     for(const id of ['weaknesspolicy','abilityshield','goldbottlecap','electricseed'])
 *       console.log(JSON.stringify({id, ...Icons.getItem(id)}))"
 */
const FILE_ITEMS = [
  'amulet-coin',
  'choice-scarf',
  'dubious-disc',
  'everstone',
  'exp-share',
  'great-ball',
  'kings-rock',
  'lucky-egg',
  'metronome',
  'old-amber',
  'poke-ball',
  'poke-doll',
  'poke-flute',
  'premier-ball',
  'rare-candy',
  'rocky-helmet',
  'scope-lens',
  'star-piece',
  'town-map',
  'up-grade',
  'vs-seeker',
] as const;

const SHEET_ITEMS = {
  'ability-shield': { top: -1104, left: -240 },
  'electric-seed': { top: -984, left: -192 },
  'gold-bottle-cap': { top: -1032, left: -216 },
  'weakness-policy': { top: -912, left: -24 },
} as const satisfies Record<string, BallSpriteCoords>;

export type FileItemIconId = (typeof FILE_ITEMS)[number];
export type SheetItemIconId = keyof typeof SHEET_ITEMS;
export type ItemIconId = FileItemIconId | SheetItemIconId;

/** Item icons are 24 px pixel art; they only scale by whole multiples. */
export type ItemIconSize = 24 | 48 | 72 | 96;

export const ITEM_ICON_IDS: readonly ItemIconId[] = [...FILE_ITEMS, ...(Object.keys(SHEET_ITEMS) as SheetItemIconId[])];

export type ItemIconSource =
  | { kind: 'file'; url: string }
  | { kind: 'sheet'; url: string; cell: number; coords: BallSpriteCoords };

export function itemIconSource(item: ItemIconId): ItemIconSource {
  if (item in SHEET_ITEMS) {
    return { kind: 'sheet', url: BALL_SPRITE_SHEET_URL, cell: BALL_SPRITE_CELL, coords: SHEET_ITEMS[item as SheetItemIconId] };
  }
  return { kind: 'file', url: getItemSpriteUrl(item) };
}
