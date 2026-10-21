import { describe, expect, it, vi } from 'vitest';
import { Dex } from '@pkmn/dex';
import committedMap from '../sprite-maps/broadcast.json';
import committedShowdownIds from '../sprite-maps/showdown-ids.json';
import {
  SITE_DEFAULT_SPRITE_STYLE,
  SPRITE_PLACEHOLDER_URL,
  SPRITE_PREVIEW_SPECIES,
  SPRITE_SOURCES,
  SPRITE_STYLE_PREFERENCES,
  SpritesBaseConfigError,
  createSpriteResolver,
  homeSpriteUrl,
  isSpriteStyle,
  isSpriteStylePreference,
  parseBroadcastMap,
  readSpritesBase,
  resolveSpriteStyle,
  showdownSpriteId,
  siteSpriteUrl,
  spriteFallbackChain,
  spriteKey,
  spriteResolver,
  variantForSize,
} from '../sprite-styles';
// Node-only generator helpers (scripts/sprites): the app and the generator must agree.
import { buildShowdownIds } from '../../../../scripts/sprites/build-showdown-ids.mjs';
import { MAP_SCHEMA, setVersion, spriteSpecies, toID } from '../../../../scripts/sprites/lib.mjs';

const HOME = SPRITE_SOURCES.home;
const SD = SPRITE_SOURCES.showdown;

const FIXTURE_MAP = parseBroadcastMap({
  schema: 2,
  version: 'aaaaaaaaaaaa',
  entries: { charizard: '6', rattataalola: '19-regional-a' },
});
const withBucket = createSpriteResolver({
  broadcastMap: FIXTURE_MAP,
  spritesBase: 'https://proj.supabase.co/storage/v1/object/public/sprites',
});
const noBucket = createSpriteResolver({ broadcastMap: FIXTURE_MAP, spritesBase: null });

describe('preferences', () => {
  it('lists site plus the four styles; the site default is broadcast', () => {
    expect(SPRITE_STYLE_PREFERENCES).toEqual(['site', 'broadcast', 'home', 'animated', 'pixel']);
    expect(SITE_DEFAULT_SPRITE_STYLE).toBe('broadcast');
    expect(resolveSpriteStyle('site')).toBe('broadcast');
    expect(resolveSpriteStyle('pixel')).toBe('pixel');
  });

  it('guards untrusted values', () => {
    expect(isSpriteStylePreference('site')).toBe(true);
    expect(isSpriteStyle('site')).toBe(false);
    for (const bad of ['', 'gif', 'SITE', null, 3, undefined]) expect(isSpriteStylePreference(bad)).toBe(false);
  });

  it('matches the CHECK list of the players.sprite_style migration', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/20261018190000_players_sprite_style.sql', 'utf8');
    const listed = sql.match(/IN \(([^)]*)\)/)?.[1].split(',').map((v) => v.trim().replace(/'/g, ''));
    expect(listed).toEqual([...SPRITE_STYLE_PREFERENCES]);
    expect(sql).toMatch(/DEFAULT 'site'/);
  });
});

describe('broadcast style', () => {
  it('serves mapped species from the bucket under the set version: 256 for thumbs, full for large art', () => {
    expect(withBucket.urlFor('broadcast', 'Charizard')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/sprites/broadcast/aaaaaaaaaaaa/256/6.webp',
    );
    expect(withBucket.urlFor('broadcast', 'Rattata-Alola', { variant: 'full' })).toBe(
      'https://proj.supabase.co/storage/v1/object/public/sprites/broadcast/aaaaaaaaaaaa/full/19-regional-a.webp',
    );
  });

  it('misses: unmapped species, shiny, empty name, no bucket configured', () => {
    expect(withBucket.urlFor('broadcast', 'Pikachu')).toBeNull();
    expect(withBucket.urlFor('broadcast', 'Charizard', { shiny: true })).toBeNull();
    expect(withBucket.urlFor('broadcast', '')).toBeNull();
    expect(noBucket.urlFor('broadcast', 'Charizard')).toBeNull();
    expect(noBucket.hasBroadcast('Charizard')).toBe(false);
    expect(withBucket.hasBroadcast('Charizard')).toBe(true);
  });

  it('falls back to HOME (then the base form, then the placeholder)', () => {
    expect(spriteFallbackChain('broadcast')).toEqual(['broadcast', 'home']);
    expect(withBucket.candidates('Pikachu', 'broadcast')).toEqual([`${HOME}/normal/pikachu.png`, SPRITE_PLACEHOLDER_URL]);
    expect(noBucket.candidates('Rattata-Alola', 'broadcast')).toEqual([
      `${HOME}/normal/rattata-alolan.png`,
      `${HOME}/normal/rattata.png`,
      SPRITE_PLACEHOLDER_URL,
    ]);
    expect(withBucket.candidates('Charizard', 'broadcast', { shiny: true })[0]).toBe(`${HOME}/shiny/charizard.png`);
  });
});

describe('home, animated, pixel', () => {
  it('builds HOME URLs (normal and shiny)', () => {
    expect(withBucket.urlFor('home', 'Mr. Mime')).toBe(`${HOME}/normal/mr-mime.png`);
    expect(homeSpriteUrl('Ponyta-Galar', { shiny: true })).toBe(`${HOME}/shiny/ponyta-galarian.png`);
  });

  it('builds Showdown animated and pixel URLs with Showdown sprite ids', () => {
    expect(withBucket.urlFor('animated', 'Rotom-Wash')).toBe(`${SD}/ani/rotom-wash.gif`);
    expect(withBucket.urlFor('animated', 'Ho-Oh', { shiny: true })).toBe(`${SD}/ani-shiny/hooh.gif`);
    expect(withBucket.urlFor('pixel', 'Necrozma-Dusk-Mane')).toBe(`${SD}/gen5/necrozma-duskmane.png`);
    expect(withBucket.urlFor('pixel', 'Kommo-o-Totem', { shiny: true })).toBe(`${SD}/gen5-shiny/kommoo-totem.png`);
    expect(withBucket.urlFor('pixel', 'Flabébé')).toBe(`${SD}/gen5/flabebe.png`);
  });

  it('chains a failed animated/pixel sprite to HOME', () => {
    expect(withBucket.candidates('Charizard', 'animated')).toEqual([
      `${SD}/ani/charizard.gif`,
      `${HOME}/normal/charizard.png`,
      SPRITE_PLACEHOLDER_URL,
    ]);
    expect(withBucket.candidates('', 'pixel')).toEqual([SPRITE_PLACEHOLDER_URL]);
  });
});

describe('the committed maps and the app resolver', () => {
  it('ships an empty-or-valid broadcast map (the real one is generated by the maintainer)', () => {
    expect(() => parseBroadcastMap(committedMap)).not.toThrow();
  });

  it('rejects malformed maps instead of guessing', () => {
    const version = 'aaaaaaaaaaaa';
    expect(() => parseBroadcastMap({ schema: 1, version, entries: {} })).toThrow(/schema/);
    expect(() => parseBroadcastMap({ schema: 2, entries: {} })).toThrow(/version/);
    expect(() => parseBroadcastMap({ schema: 2, version: '../aaaaaaaa', entries: {} })).toThrow(/version/);
    expect(() => parseBroadcastMap({ schema: 2, version, entries: [] })).toThrow(/entries/);
    expect(() => parseBroadcastMap({ schema: 2, version, entries: { x: '../1' } })).toThrow(/malformed entry "x"/);
    expect(() => parseBroadcastMap({ schema: 2, version, entries: { x: { stem: '1' } } })).toThrow(/malformed entry "x"/);
    expect(() => parseBroadcastMap({ schema: 2, version, entries: { X: '1' } })).toThrow(/"X"/);
  });

  it('the app and the generator agree on the schema; the committed empty map carries the empty set version', () => {
    expect(MAP_SCHEMA).toBe(2);
    expect(committedMap.schema).toBe(MAP_SCHEMA);
    if (Object.keys(committedMap.entries).length === 0) expect(committedMap.version).toBe(setVersion([]));
  });

  it('every broadcast map key is a @pkmn species id', () => {
    for (const key of Object.keys(parseBroadcastMap(committedMap).stems)) expect(Dex.species.get(key).exists).toBe(true);
  });

  it('showdown-ids.json equals the derivation from @pkmn/dex (run scripts/sprites/build-showdown-ids.mjs)', () => {
    expect(committedShowdownIds).toEqual(buildShowdownIds(Dex));
  });

  it('spriteKey agrees with the generator ids for every species', () => {
    for (const species of spriteSpecies(Dex)) {
      expect(spriteKey(species.name)).toBe(species.id);
      expect(toID(species.name)).toBe(species.id);
    }
    expect(showdownSpriteId('Nidoran-F')).toBe('nidoranf');
  });

  it('the preview species exists in @pkmn/dex', () => {
    expect(Dex.species.get(SPRITE_PREVIEW_SPECIES).exists).toBe(true);
  });

  it('with no NEXT_PUBLIC_SPRITES_URL (tests, public forks) the site default resolves to HOME', () => {
    expect(siteSpriteUrl('Garchomp')).toBe(`${HOME}/normal/garchomp.png`);
    expect(spriteResolver.hasBroadcast('Garchomp')).toBe(false);
  });
});

describe('readSpritesBase', () => {
  it('accepts https URLs and root-relative paths, trims trailing slashes', () => {
    expect(readSpritesBase('https://x.supabase.co/storage/v1/object/public/sprites/')).toBe(
      'https://x.supabase.co/storage/v1/object/public/sprites',
    );
    expect(readSpritesBase('/sprites')).toBe('/sprites');
    expect(readSpritesBase('  ')).toBeNull();
    expect(readSpritesBase(undefined)).toBeNull();
  });

  it('throws on a configured but unusable base (e.g. an MSYS-converted drive path), so the build fails', () => {
    expect(() => readSpritesBase('C:/Program Files/Git/sprites')).toThrow(SpritesBaseConfigError);
    expect(() => readSpritesBase('//cdn.example/sprites')).toThrow('NEXT_PUBLIC_SPRITES_URL "//cdn.example/sprites" is not usable');
    expect(() => readSpritesBase('sprites')).toThrow(SpritesBaseConfigError);
  });

  it('fails the module import itself when the env holds an unusable value', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SPRITES_URL', 'C:/Program Files/Git/sprites');
    try {
      await expect(import('../sprite-styles')).rejects.toThrow(/NEXT_PUBLIC_SPRITES_URL/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('variantForSize', () => {
  it('uses thumbs up to 128 px', () => {
    expect(variantForSize(56)).toBe('thumb');
    expect(variantForSize(128)).toBe('thumb');
    expect(variantForSize(160)).toBe('full');
  });
});
