/**
 * The broadcast style with a configured bucket and a (fixture) map: mapped
 * species render the self-hosted WebP (256 for small sprites, full for large),
 * unmapped and shiny ones the HOME render first; the HOME render is the next
 * candidate when the bucket object fails to load.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

const BASE = vi.hoisted(() => {
  const base = 'https://proj.supabase.co/storage/v1/object/public/sprites';
  process.env.NEXT_PUBLIC_SPRITES_URL = base;
  return base;
});

vi.mock('@/lib/pkmn/sprite-maps/broadcast.json', () => ({
  default: {
    schema: 2,
    version: '0123456789ab',
    entries: { garchomp: '445' },
  },
}));

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { SPRITE_SOURCES, siteSpriteUrl, spriteResolver } from '@/lib/pkmn/sprite-styles';
import PokemonSprite from '../PokemonSprite';
import SpriteImg from '../SpriteImg';
import OverlayPokemonSprite from '@/components/broadcast/shared/OverlayPokemonSprite';
import { SpriteStyleProvider } from '../SpriteStyleProvider';

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SPRITES_URL;
});

const srcOf = (html: string) => html.match(/src="([^"]+)"/)?.[1];

describe('broadcast style with a bucket', () => {
  it('renders the 256 px render for card-sized sprites by default (site default)', () => {
    expect(srcOf(renderToStaticMarkup(<PokemonSprite name="Garchomp" size={56} />))).toBe(
      `${BASE}/broadcast/0123456789ab/256/445.webp`,
    );
  });

  it('renders the full-size render above 128 px', () => {
    expect(srcOf(renderToStaticMarkup(<PokemonSprite name="Garchomp" size={160} />))).toBe(
      `${BASE}/broadcast/0123456789ab/full/445.webp`,
    );
  });

  it('a viewer who chose HOME gets HOME even when broadcast exists', () => {
    const html = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="home">
        <PokemonSprite name="Garchomp" />
      </SpriteStyleProvider>,
    );
    expect(srcOf(html)).toBe(`${SPRITE_SOURCES.home}/normal/garchomp.png`);
  });

  it('unmapped species and shiny sprites start at HOME', () => {
    expect(srcOf(renderToStaticMarkup(<PokemonSprite name="Pikachu" />))).toBe(`${SPRITE_SOURCES.home}/normal/pikachu.png`);
    expect(srcOf(renderToStaticMarkup(<PokemonSprite name="Garchomp" shiny />))).toBe(
      `${SPRITE_SOURCES.home}/shiny/garchomp.png`,
    );
  });

  it('the HOME render is the next candidate after a failed bucket object', () => {
    expect(spriteResolver.candidates('Garchomp', 'broadcast').slice(0, 2)).toEqual([
      `${BASE}/broadcast/0123456789ab/256/445.webp`,
      `${SPRITE_SOURCES.home}/normal/garchomp.png`,
    ]);
  });

  it('viewerless payloads use the site default at full size', () => {
    expect(siteSpriteUrl('Garchomp')).toBe(`${BASE}/broadcast/0123456789ab/full/445.webp`);
  });

  it('broadcast overlays render the full-size render at every size and ignore the viewer style', () => {
    for (const size of [40, 80, 120]) {
      const html = renderToStaticMarkup(
        <SpriteStyleProvider initialPreference="pixel">
          <OverlayPokemonSprite pokemon="Garchomp" size={size} />
        </SpriteStyleProvider>,
      );
      expect(srcOf(html)).toBe(`${BASE}/broadcast/0123456789ab/full/445.webp`);
    }
  });

  it('SpriteImg picks the variant from its numeric size, like PokemonSprite', () => {
    expect(srcOf(renderToStaticMarkup(<SpriteImg name="Garchomp" alt="" width={64} height={64} />))).toBe(
      `${BASE}/broadcast/0123456789ab/256/445.webp`,
    );
    expect(srcOf(renderToStaticMarkup(<SpriteImg name="Garchomp" alt="" width={200} height={200} />))).toBe(
      `${BASE}/broadcast/0123456789ab/full/445.webp`,
    );
    expect(srcOf(renderToStaticMarkup(<SpriteImg name="Garchomp" alt="" className="h-48 w-48" variant="full" />))).toBe(
      `${BASE}/broadcast/0123456789ab/full/445.webp`,
    );
  });
});

describe('broadcast overlay sources', () => {
  // OBS browser sources are often scaled up, so every overlay sprite uses the
  // full-size render (docs/pkmn.md, "Sprite styles"). A SpriteImg sized only by
  // CSS classes would default to the 256 px thumb, so each one must say so.
  it('every SpriteImg in an overlay passes the site default style and variant="full"', () => {
    const dir = join(process.cwd(), 'src/components/broadcast/overlays');
    let checked = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(/<SpriteImg\b[^>]*?\/>/gs)) {
        checked += 1;
        expect(match[0], `${file}: ${match[0]}`).toMatch(/variant="full"/);
        expect(match[0], `${file}: ${match[0]}`).toMatch(/spriteStyle=\{SITE_DEFAULT_SPRITE_STYLE\}/);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});
