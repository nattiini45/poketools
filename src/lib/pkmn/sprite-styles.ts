/**
 * Pokémon sprite styles (docs/pkmn.md, "Sprite styles"). Client-safe: no
 * `server-only`, no `next/*`, no React, no `@pkmn/dex`.
 *
 * Every Pokémon sprite URL in the app resolves through this module:
 *  - `broadcast`: the high-resolution broadcast renders, self-hosted by the
 *    deployment in the Supabase Storage bucket `sprites` (or the local mirror
 *    `/sprites` in dev). Available only when `NEXT_PUBLIC_SPRITES_URL` is set AND
 *    the species is in the generated map `sprite-maps/broadcast.json`; never
 *    shiny. Object paths carry the set's content hash, so they are cached for a year.
 *  - `home`: the HOME 3D renders (img.pokemondb.net), the universal fallback.
 *  - `animated`: Showdown's animated battle sprites.
 *  - `pixel`: Showdown's static Gen 5 pixel sprites.
 *
 * A style that cannot serve a species returns `null` from `spriteUrlFor`; the
 * ordered candidate list (`spriteCandidates`) walks the fallback chain, then the
 * HOME render of the base form, then a placeholder, so an `<img onError>` can step
 * down the list without a layout shift.
 *
 * The viewer's preference ('site' or a style): the `plc_sprite_style` cookie is
 * the server-render source of truth, read by the root layout into
 * `SpriteStyleProvider` (`src/components/shared/SpriteStyleProvider.tsx`). A
 * signed-in player's account value (`players.sprite_style`) reaches that cookie
 * when it is saved, at sign-in and through the once-per-tab client reconcile.
 * Viewerless output (API payloads for overlays, server-rendered images) uses the
 * site default.
 */

import broadcastMapJson from './sprite-maps/broadcast.json';
import showdownIdsJson from './sprite-maps/showdown-ids.json';
import { getBaseFormName, normalizeName } from './sprites';

// ─── Styles and preferences ────────────────────────────────────────

export const SPRITE_STYLES = ['broadcast', 'home', 'animated', 'pixel'] as const;
export type SpriteStyle = (typeof SPRITE_STYLES)[number];

/** A viewer's stored choice: a style, or 'site' = follow the deployment default. */
export const SPRITE_STYLE_PREFERENCES = ['site', ...SPRITE_STYLES] as const;
export type SpriteStylePreference = (typeof SPRITE_STYLE_PREFERENCES)[number];

/** The deployment default (owner decision 2026-10-18: broadcast renders wherever possible). */
export const SITE_DEFAULT_SPRITE_STYLE: SpriteStyle = 'broadcast';
/** Column default of `players.sprite_style` and the value for a missing or invalid cookie. */
export const DEFAULT_SPRITE_STYLE_PREFERENCE: SpriteStylePreference = 'site';

/** The SSR source of truth; written by `POST /api/sprite-style` and the sign-in sync (`sprite-style-signin.server.ts`). */
export const SPRITE_STYLE_COOKIE = 'plc_sprite_style';
/** One year, in seconds (same lifetime as the language cookies). */
export const SPRITE_STYLE_COOKIE_MAX_AGE = 31_536_000;

/**
 * The species the sprite-style previews show (settings card). A display choice,
 * not data: validated against `@pkmn/dex` and present in every style's source
 * by `src/lib/pkmn/__tests__/sprite-styles.test.ts`.
 */
export const SPRITE_PREVIEW_SPECIES = 'Charizard';

export function isSpriteStyle(value: unknown): value is SpriteStyle {
  return typeof value === 'string' && (SPRITE_STYLES as readonly string[]).includes(value);
}

export function isSpriteStylePreference(value: unknown): value is SpriteStylePreference {
  return typeof value === 'string' && (SPRITE_STYLE_PREFERENCES as readonly string[]).includes(value);
}

/** The style a preference renders with ('site' -> the site default). */
export function resolveSpriteStyle(preference: SpriteStylePreference): SpriteStyle {
  return preference === 'site' ? SITE_DEFAULT_SPRITE_STYLE : preference;
}

// ─── Sources (every sprite base URL lives here) ────────────────────

export const SPRITE_SOURCES = {
  /** HOME 3D renders: `{home}/{normal|shiny}/{pokemondb name}.png`. */
  home: 'https://img.pokemondb.net/sprites/home',
  /** Showdown sprites: `{showdown}/{ani|ani-shiny}/{id}.gif`, `{showdown}/{gen5|gen5-shiny}/{id}.png`. */
  showdown: 'https://play.pokemonshowdown.com/sprites',
} as const;

/** Last resort when every style failed (Showdown's substitute doll). */
export const SPRITE_PLACEHOLDER_URL = `${SPRITE_SOURCES.showdown}/gen5/substitute.png`;

/** Object prefix of the broadcast renders under the sprites base (bucket root or `/sprites`). */
export const BROADCAST_PREFIX = 'broadcast';

/**
 * `thumb` = the 256 px WebP (grids, cards, chips); `full` = the full-size WebP
 * (hero, detail, broadcast overlays). Only the broadcast style has two variants.
 */
export type SpriteVariant = 'thumb' | 'full';
/** Sprites rendered larger than this (CSS px) use the `full` variant by default. */
export const THUMB_MAX_DISPLAY_PX = 128;

export function variantForSize(size: number): SpriteVariant {
  return size > THUMB_MAX_DISPLAY_PX ? 'full' : 'thumb';
}

export interface SpriteUrlOptions {
  shiny?: boolean;
  variant?: SpriteVariant;
}

/**
 * The generated broadcast map (`scripts/sprites/mirror-broadcast.mjs`, schema 2):
 * one set `version` (a content hash over every published file) and, per @pkmn
 * species id, the source file stem (`{dex number}` or `{dex number}-{form}`).
 * Object names are `broadcast/{version}/{256|full}/{stem}.webp`, so the version
 * busts every cached URL when any file changes, and the map stays small: it
 * ships in the client bundle of every page (about 10 KB gzipped at 1,400
 * species, against about 36 KB for per-file hashes).
 */
export interface BroadcastMap {
  readonly version: string;
  readonly stems: Readonly<Record<string, string>>;
}

/** The map schema `parseBroadcastMap` accepts (`MAP_SCHEMA` in scripts/sprites/lib.mjs). */
export const BROADCAST_MAP_SCHEMA = 2;

const STEM = /^[0-9]{1,4}(-[a-z0-9]+(-[a-z0-9]+)*)?$/;
const VERSION = /^[0-9a-f]{8,64}$/;
const KEY = /^[a-z0-9]+$/;

/**
 * Validates the committed map's shape. A malformed map is a build defect (the
 * generator writes it), so this throws instead of guessing.
 */
export function parseBroadcastMap(raw: unknown): BroadcastMap {
  if (typeof raw !== 'object' || raw === null) throw new Error('[sprite-styles] broadcast map: not an object');
  const { schema, version, entries } = raw as { schema?: unknown; version?: unknown; entries?: unknown };
  if (schema !== BROADCAST_MAP_SCHEMA) throw new Error(`[sprite-styles] broadcast map: unsupported schema ${String(schema)}`);
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new Error('[sprite-styles] broadcast map: "version" must be a lowercase hex content hash');
  }
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    throw new Error('[sprite-styles] broadcast map: "entries" must be an object');
  }
  const stems: Record<string, string> = {};
  for (const [key, stem] of Object.entries(entries as Record<string, unknown>)) {
    if (!KEY.test(key) || typeof stem !== 'string' || !STEM.test(stem)) {
      throw new Error(`[sprite-styles] broadcast map: malformed entry "${key}"`);
    }
    stems[key] = stem;
  }
  return { version, stems };
}

// ─── Name keys ─────────────────────────────────────────────────────

function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** The @pkmn species id of a canonical English name (the map key): "Rotom-Wash" -> "rotomwash". */
export function spriteKey(name: string): string {
  return stripDiacritics(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Showdown sprite id from the name alone: split at the first hyphen ("Rotom-Wash" -> "rotom-wash"). */
export function naiveShowdownSpriteId(name: string): string {
  const ascii = stripDiacritics(name);
  const dash = ascii.indexOf('-');
  const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (dash <= 0) return id(ascii);
  return `${id(ascii.slice(0, dash))}-${id(ascii.slice(dash + 1))}`;
}

const SHOWDOWN_ID_EXCEPTIONS: Readonly<Record<string, string>> = showdownIdsJson;

/** Showdown's sprite id ("Ho-Oh" -> "hooh"); the exceptions come from `sprite-maps/showdown-ids.json`. */
export function showdownSpriteId(name: string): string {
  return SHOWDOWN_ID_EXCEPTIONS[spriteKey(name)] ?? naiveShowdownSpriteId(name);
}

// ─── Resolver ──────────────────────────────────────────────────────

/** A usable sprites base: an absolute http(s) URL or a root-relative path (not protocol-relative). */
export function isUsableSpritesBase(value: string): boolean {
  return /^https?:\/\//i.test(value) || (value.startsWith('/') && !value.startsWith('//'));
}

/** Thrown for a configured but unusable `NEXT_PUBLIC_SPRITES_URL`. */
export class SpritesBaseConfigError extends Error {
  constructor(value: string) {
    super(
      `[sprite-styles] NEXT_PUBLIC_SPRITES_URL "${value}" is not usable: set an absolute http(s) URL ` +
        '(the public bucket, e.g. https://<project>.supabase.co/storage/v1/object/public/sprites) or a root-relative ' +
        "path ('/sprites'), or unset it. A drive path here usually means Git Bash's MSYS conversion rewrote '/sprites'.",
    );
    this.name = 'SpritesBaseConfigError';
  }
}

/**
 * `NEXT_PUBLIC_SPRITES_URL` without a trailing slash, or null when unset.
 * A configured but unusable value (e.g. a drive path that Git Bash's MSYS
 * conversion baked in for `/sprites`) throws `SpritesBaseConfigError`: this
 * module evaluates it at import time, so the build (and `next dev`) fails at
 * once instead of a deployment silently serving HOME for every broadcast sprite.
 */
export function readSpritesBase(configured: string | undefined = process.env.NEXT_PUBLIC_SPRITES_URL): string | null {
  const value = configured?.trim();
  if (!value) return null;
  if (!isUsableSpritesBase(value)) throw new SpritesBaseConfigError(value);
  return value.replace(/\/+$/, '');
}

export interface SpriteResolver {
  /** URL of `name` in `style`, or null when that style cannot serve it. */
  urlFor(style: SpriteStyle, name: string, options?: SpriteUrlOptions): string | null;
  /** True when the broadcast style can serve `name` (base configured and species mapped). */
  hasBroadcast(name: string): boolean;
  /** Ordered, de-duplicated URLs to try: the style's chain, the base form's HOME render, the placeholder. */
  candidates(name: string, style: SpriteStyle, options?: SpriteUrlOptions): string[];
}

/** The order styles are tried in: the requested style, then HOME. */
export function spriteFallbackChain(style: SpriteStyle): SpriteStyle[] {
  return style === 'home' ? ['home'] : [style, 'home'];
}

/** HOME render URL (always available for a non-empty name). */
export function homeSpriteUrl(name: string, options: { shiny?: boolean } = {}): string {
  return `${SPRITE_SOURCES.home}/${options.shiny ? 'shiny' : 'normal'}/${normalizeName(name)}.png`;
}

export function createSpriteResolver(deps: { broadcastMap: BroadcastMap; spritesBase: string | null }): SpriteResolver {
  const { broadcastMap, spritesBase } = deps;

  const broadcastStem = (name: string): string | null =>
    spritesBase === null ? null : (broadcastMap.stems[spriteKey(name)] ?? null);

  const urlFor: SpriteResolver['urlFor'] = (style, name, options = {}) => {
    if (!name) return null;
    switch (style) {
      case 'broadcast': {
        // The broadcast renders have no shiny variant.
        if (options.shiny) return null;
        const stem = broadcastStem(name);
        if (!stem) return null;
        const variantDir = options.variant === 'full' ? 'full' : '256';
        return `${spritesBase}/${BROADCAST_PREFIX}/${broadcastMap.version}/${variantDir}/${stem}.webp`;
      }
      case 'home':
        return homeSpriteUrl(name, options);
      case 'animated':
        return `${SPRITE_SOURCES.showdown}/${options.shiny ? 'ani-shiny' : 'ani'}/${showdownSpriteId(name)}.gif`;
      case 'pixel':
        return `${SPRITE_SOURCES.showdown}/${options.shiny ? 'gen5-shiny' : 'gen5'}/${showdownSpriteId(name)}.png`;
    }
  };

  const candidates: SpriteResolver['candidates'] = (name, style, options = {}) => {
    const out: string[] = [];
    const push = (url: string | null) => {
      if (url && !out.includes(url)) out.push(url);
    };
    if (name) {
      for (const s of spriteFallbackChain(style)) push(urlFor(s, name, options));
      const base = getBaseFormName(name);
      if (base) push(homeSpriteUrl(base, options));
    }
    push(SPRITE_PLACEHOLDER_URL);
    return out;
  };

  return { urlFor, hasBroadcast: (name) => broadcastStem(name) !== null, candidates };
}

const COMMITTED_BROADCAST_MAP = parseBroadcastMap(broadcastMapJson);

/** The app's resolver: the committed broadcast map and `NEXT_PUBLIC_SPRITES_URL`. */
export const spriteResolver: SpriteResolver = createSpriteResolver({
  broadcastMap: COMMITTED_BROADCAST_MAP,
  spritesBase: readSpritesBase(),
});

/** First candidate of `name` in `style`, i.e. the URL to render before any load error. */
export function spriteUrl(name: string, style: SpriteStyle, options?: SpriteUrlOptions): string {
  return spriteResolver.candidates(name, style, options)[0];
}

/**
 * Viewerless sprite URL (API payloads for overlays, recaps, caster data): the
 * site default style. Overlays render large, so the default variant is `full`.
 */
export function siteSpriteUrl(name: string, options: SpriteUrlOptions = {}): string {
  return spriteUrl(name, SITE_DEFAULT_SPRITE_STYLE, { variant: 'full', ...options });
}
