/**
 * Hardcoded Showdown itemicons spritesheet coordinates for the four Pokéballs
 * used by the rating tier system.
 *
 * Coordinates were captured once by calling `Icons.getItem(id)` from
 * `@pkmn/img` (the same library the `/api/pkmn/item-sprite` route uses).
 * Pinning them avoids shipping `@pkmn/img` to the client bundle and avoids a
 * network round-trip for the rating badge that renders dozens of times per
 * page on the leaderboard.
 *
 * To regenerate (e.g. if the sheet URL ever changes):
 *
 *   node -e "const {Icons}=require('@pkmn/img');
 *     for(const id of ['pokeball','greatball','ultraball','masterball'])
 *       console.log(JSON.stringify({id, ...Icons.getItem(id)}))"
 */

export const BALL_SPRITE_SHEET_URL =
  'https://play.pokemonshowdown.com/sprites/itemicons-sheet.png';

/** Each cell in the Showdown itemicons sheet is 24×24 pixels. */
export const BALL_SPRITE_CELL = 24;

export type BallItemId = 'pokeball' | 'greatball' | 'ultraball' | 'masterball';

export interface BallSpriteCoords {
  /** background-position-y in CSS pixels (already negative). */
  top: number;
  /** background-position-x in CSS pixels (already negative). */
  left: number;
}

export const BALL_SPRITE_COORDS: Record<BallItemId, BallSpriteCoords> = {
  pokeball: { top: -504, left: -216 },
  greatball: { top: -240, left: -336 },
  ultraball: { top: -768, left: -216 },
  masterball: { top: -408, left: -96 },
};
