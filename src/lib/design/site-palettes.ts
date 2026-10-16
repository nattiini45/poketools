/**
 * Site palettes — the per-device colour scheme for the whole site (not the
 * league worlds, which keep their own dialect). The CSS lives in
 * src/app/globals.css (Layer 0 cores, Layer 2 html[data-palette] blocks);
 * the full token mirror for tests is ./site-palette-tokens.ts. See
 * docs/design.md § Site palettes.
 */

export const SITE_PALETTE_IDS = ['plaza', 'sakura', 'mountain', 'clouds'] as const;
export type SitePaletteId = (typeof SITE_PALETTE_IDS)[number];
export type SitePaletteMode = 'light' | 'dark';

export const DEFAULT_SITE_PALETTE: SitePaletteId = 'plaza';
/** localStorage key (per device). Same `poketools:` prefix as the world override. */
export const SITE_PALETTE_STORAGE_KEY = 'poketools:site-palette';
/** Attribute on <html>; absent = DEFAULT_SITE_PALETTE. */
export const SITE_PALETTE_ATTRIBUTE = 'data-palette';

export function isSitePaletteId(value: unknown): value is SitePaletteId {
  return typeof value === 'string' && (SITE_PALETTE_IDS as readonly string[]).includes(value);
}

export interface SitePaletteMeta {
  id: SitePaletteId;
  /* Picker words live in `ui.palette` (viewer's language), keyed by id. */
  /** The world tokenNamespace whose dialect this palette carries. */
  world: 'evoliga' | 'sakura' | 'mountain' | 'clouds';
}

export const SITE_PALETTES: readonly SitePaletteMeta[] = [
  { id: 'plaza', world: 'evoliga' },
  { id: 'sakura', world: 'sakura' },
  { id: 'mountain', world: 'mountain' },
  { id: 'clouds', world: 'clouds' },
];

export function getSitePaletteMeta(id: SitePaletteId): SitePaletteMeta {
  // SITE_PALETTES covers every id (unit-tested), so find() cannot miss.
  return SITE_PALETTES.find((p) => p.id === id) ?? SITE_PALETTES[0];
}

/** Palette-core roles (globals.css Layer 0). */
export type SitePaletteCoreRole =
  | 'ground' | 'surface' | 'elevated' | 'ink' | 'ink-secondary'
  | 'accent' | 'accent-strong' | 'focus' | 'live' | 'border';

/** CSS reference to a palette's core colour in the CURRENT light/dark mode —
 *  used by the picker swatches so they need no hex and no mode logic. */
export function sitePaletteSwatchVar(id: SitePaletteId, role: SitePaletteCoreRole): string {
  return `var(--palette-${id}-${role})`;
}

/** Every literal-valued base token each palette defines in BOTH modes (43; [v2 C2] + --poke-yellow-ink,
 *  + the three component inks that replaced static Tailwind red-500 / red-400 / amber-600). */
export const BASE_TOKEN_NAMES = [
  '--background', '--foreground',
  '--poke-base', '--poke-surface', '--poke-elevated', '--poke-muted', '--poke-inverse',
  '--poke-text-primary', '--poke-text-secondary', '--poke-text-muted', '--poke-text-tertiary',
  '--poke-border', '--poke-border-strong',
  '--poke-accent', '--poke-accent-strong', '--poke-accent-light', '--poke-focus', '--poke-live', '--poke-glow',
  '--poke-blue', '--poke-blue-hover', '--poke-green', '--poke-green-hover', '--poke-yellow',
  '--poke-danger', '--poke-danger-hover', '--poke-plum',
  '--poke-blue-light', '--poke-green-light', '--poke-yellow-light', '--poke-danger-light', '--poke-plum-light',
  '--poke-yellow-ink', '--poke-danger-ink', '--poke-danger-tint-ink', '--poke-amber-ink',
  '--poke-on-blue', '--poke-on-green', '--poke-on-danger',
  '--primary-foreground', '--secondary-foreground', '--destructive', '--destructive-foreground',
] as const;
export type BaseTokenName = (typeof BASE_TOKEN_NAMES)[number];
