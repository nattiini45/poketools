import {
  BALL_SPRITE_CELL,
  BALL_SPRITE_COORDS,
  BALL_SPRITE_SHEET_URL,
  type BallItemId,
} from '@/lib/pkmn/ball-sprites';
import type { RatingTier } from '@/lib/rating/tiers';

/** Accept either rating-tier ids or Showdown item ids and resolve both to the same item id. */
const BALL_LOOKUP: Record<RatingTier | BallItemId, BallItemId> = {
  poke: 'pokeball',
  great: 'greatball',
  ultra: 'ultraball',
  master: 'masterball',
  pokeball: 'pokeball',
  greatball: 'greatball',
  ultraball: 'ultraball',
  masterball: 'masterball',
};

interface PokeballIconProps {
  /** Rating tier (`poke | great | ultra | master`) or Showdown item id directly. */
  ball: RatingTier | BallItemId;
  /** Rendered side length in CSS pixels. Defaults to the spritesheet cell size. */
  size?: number;
  className?: string;
}

/**
 * Server-safe Pokéball icon. Renders one cell of the Showdown itemicons
 * spritesheet at the given size using fixed background-position offsets from
 * {@link BALL_SPRITE_COORDS}. No hooks, no effects, no network requests — usable
 * in server components and inside broadcast overlays where SSR is required.
 */
export default function PokeballIcon({
  ball,
  size = BALL_SPRITE_CELL,
  className = '',
}: PokeballIconProps) {
  const coords = BALL_SPRITE_COORDS[BALL_LOOKUP[ball]];
  const scale = size / BALL_SPRITE_CELL;

  return (
    <span
      className={`inline-block overflow-hidden ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        style={{
          display: 'block',
          width: BALL_SPRITE_CELL,
          height: BALL_SPRITE_CELL,
          imageRendering: 'pixelated',
          background: `transparent url(${BALL_SPRITE_SHEET_URL}) no-repeat scroll ${coords.left}px ${coords.top}px`,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
        }}
      />
    </span>
  );
}
