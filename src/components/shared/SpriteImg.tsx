'use client';

import { useMemo, useState, type ImgHTMLAttributes } from 'react';
import {
  spriteResolver,
  variantForSize,
  type SpriteStyle,
  type SpriteVariant,
} from '@/lib/pkmn/sprite-styles';
import { useSpriteStyle } from './SpriteStyleProvider';

/**
 * Sprite URLs for a species in the viewer's style (docs/pkmn.md, "Sprite
 * styles"): the ordered candidates of `spriteResolver.candidates` — the style's
 * fallback chain, the base form's HOME render, the placeholder.
 *
 * `style` overrides the viewer's choice: viewerless surfaces (broadcast overlays)
 * pass `SITE_DEFAULT_SPRITE_STYLE`, art-directed ones pin `'home'`.
 */
export function useSpriteCandidates(
  name: string,
  options: { style?: SpriteStyle; shiny?: boolean; variant?: SpriteVariant } = {},
): { style: SpriteStyle; candidates: string[] } {
  const viewerStyle = useSpriteStyle();
  const style = options.style ?? viewerStyle;
  const { shiny, variant } = options;
  const candidates = useMemo(
    () => spriteResolver.candidates(name, style, { shiny, variant }),
    [name, style, shiny, variant],
  );
  return { style, candidates };
}

/**
 * The candidate to show after a load error: the next one, or the last one again
 * (the placeholder) so a broken placeholder cannot loop.
 */
export function nextSpriteIndex(index: number, count: number): number {
  return index < count - 1 ? index + 1 : index;
}

export interface SpriteImgProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  /** Canonical English species name; drives the URL (the alt text is the caller's). */
  name: string;
  /** Overrides the viewer's style (see `useSpriteCandidates`). */
  spriteStyle?: SpriteStyle;
  shiny?: boolean;
  /**
   * Default: from the numeric `width`/`height` props (`full` above 128 px, like
   * `PokemonSprite`), else the 256 px `thumb`. A caller sized only by CSS
   * classes that shows the sprite large passes `full` explicitly.
   */
  variant?: SpriteVariant;
}

function defaultVariant(width: ImgHTMLAttributes<HTMLImageElement>['width'], height: ImgHTMLAttributes<HTMLImageElement>['height']): SpriteVariant {
  const sizes = [width, height].map((v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN));
  const finite = sizes.filter((n) => Number.isFinite(n));
  return finite.length > 0 ? variantForSize(Math.max(...finite)) : 'thumb';
}

/**
 * A plain `<img>` sprite that steps down the fallback chain on a load error.
 * The caller's className / width / height size the box, so a fallback never
 * shifts the layout; `object-fit: contain` keeps non-square art inside it.
 */
export default function SpriteImg({ name, spriteStyle, shiny, variant: variantProp, ...imgProps }: SpriteImgProps) {
  const variant = variantProp ?? defaultVariant(imgProps.width, imgProps.height);
  const { style, candidates } = useSpriteCandidates(name, { style: spriteStyle, shiny, variant });
  // Remount on a new source list so the fallback index starts over.
  return <SpriteImgInner key={`${style}:${variant}:${shiny ? 's' : 'n'}:${name}`} candidates={candidates} {...imgProps} />;
}

function SpriteImgInner({
  candidates,
  style,
  ...imgProps
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & { candidates: string[] }) {
  const [index, setIndex] = useState(0);
  const src = candidates[Math.min(index, candidates.length - 1)];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- plain img: callers size it; next/image adds nothing for remote sprites (unoptimized)
    <img
      {...imgProps}
      src={src}
      style={{ objectFit: 'contain', ...style }}
      onError={() => setIndex((i) => nextSpriteIndex(i, candidates.length))}
    />
  );
}
