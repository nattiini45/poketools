/**
 * Shared helpers for the sprite-style maps (docs/pkmn.md, "Sprite styles").
 *
 * Node only; nothing here is imported by the app. The key and id rules mirror
 * src/lib/pkmn/sprite-styles.ts (`spriteKey`, `naiveShowdownSpriteId`); the
 * map checks in src/lib/pkmn/__tests__/sprite-styles.test.ts hold both sides
 * to the same output.
 */

import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');
export const SCRIPT_DIR = __dirname;
export const CACHE_DIR = join(__dirname, '.cache', 'broadcast');
export const MIRROR_DIR = join(ROOT, 'public', 'sprites', 'broadcast');
export const MAPS_DIR = join(ROOT, 'src', 'lib', 'pkmn', 'sprite-maps');
export const BROADCAST_MAP_FILE = join(MAPS_DIR, 'broadcast.json');
export const SHOWDOWN_IDS_FILE = join(MAPS_DIR, 'showdown-ids.json');

/** Storage bucket and object prefix of the broadcast renders (NEXT_PUBLIC_SPRITES_URL points at the bucket root). */
export const BUCKET = 'sprites';
export const BROADCAST_PREFIX = 'broadcast';
/** The two published variants: grids, cards and chips use `256`; hero, detail and overlays use `full`. */
export const VARIANTS = ['256', 'full'];
/** Length of the set version (hex) in the map and in object paths (`broadcast/{version}/{variant}/{stem}.webp`). */
export const VERSION_LENGTH = 12;
/** Map schema; `BROADCAST_MAP_SCHEMA` in src/lib/pkmn/sprite-styles.ts must match. */
export const MAP_SCHEMA = 2;

/** sha256 hex of a buffer. */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The set version: a content hash over every published file, so it changes
 * when any file changes (and with it every object path, which busts the
 * one-year caches). `files` = [{ logical: '{variant}/{stem}.webp', sha256 }];
 * order does not matter. The empty set's version is sha256('') (the committed
 * empty map's `version`).
 */
export function setVersion(files) {
  const lines = files.map((f) => `${f.logical} ${f.sha256}\n`).sort();
  return sha256(lines.join('')).slice(0, VERSION_LENGTH);
}

/** Accents off (Flabébé -> Flabebe), the way @pkmn ids treat them. */
export function stripDiacritics(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** The @pkmn/Showdown id rule (lowercase, only a-z and 0-9), after stripping accents. */
export function toID(text) {
  return stripDiacritics(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Showdown's sprite id: toID(baseSpecies), plus `-toID(forme)` for a forme. */
export function showdownSpriteId(species) {
  return toID(species.baseSpecies) + (species.baseSpecies !== species.name ? `-${toID(species.forme)}` : '');
}

/** The naive id the app derives from a name alone: split at the first hyphen. */
export function naiveShowdownSpriteId(name) {
  const ascii = stripDiacritics(name);
  const dash = ascii.indexOf('-');
  if (dash <= 0) return toID(ascii);
  return `${toID(ascii.slice(0, dash))}-${toID(ascii.slice(dash + 1))}`;
}

/** Species @pkmn/dex knows that have a sprite: real dex numbers, no CAP. */
export function spriteSpecies(Dex) {
  return Dex.species.all().filter((s) => s.exists && s.num > 0 && s.isNonstandard !== 'CAP');
}

/** JSON with keys sorted at every level and a trailing newline (deterministic output). */
export function stableJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function log(...args) {
  console.log(...args);
}
