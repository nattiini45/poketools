/**
 * Scene colors, resolved from the world's own CSS tokens.
 *
 * The route world carries no palette of its own: it reads the computed
 * `--world-*` values off the `[data-world]` element and maps them to scene
 * roles. Two things follow, and both are the point — sunlit and moonlit
 * become the same route under different light rather than two art
 * directions.
 *
 * This module is the GENERIC core: token colors plus the illuminants derived
 * from them, and the sky zenith (the canvas clear color every theme needs).
 * Theme-owned furniture colors (plaza: sky horizon, sun/moon discs, desk /
 * board / LED phosphors, cobble pigment) live in the theme's
 * `paletteExtension` (`theme-types.ts`) and are merged over the core by the
 * `WorldStateProvider` — extension keys win.
 *
 * See `docs/design.md` § World tokens in 3D.
 */

/** The nine colors that come straight off the `--world-*` tokens. */
export interface WorldTokens {
  /** Fog and distant terrain. Matches the page ground exactly. */
  ground: string;
  /** Plaster, road, gym walls — the readable mass behind DOM copy. */
  surface: string;
  /** Trim, plinths, banner cloth. */
  elevated: string;
  /** Ink for any 3D-adjacent text treatment. */
  ink: string;
  /** Emissive practicals at rest. */
  accent: string;
  /** Emissive practicals at full power. */
  accentStrong: string;
  /** The focused-object rim. */
  focus: string;
  /** Live-fixture beam and live state signalling. */
  live: string;
  /** Hairline edges on procedural architecture. */
  border: string;
}

/**
 * Tokens plus the illuminants derived from them — the theme-agnostic core.
 *
 * The split is the whole point. A surface token is *pigment* — the moonlit
 * variant sets `--world-surface` to `#171208`, which is a correct color for a
 * panel and a catastrophic one for a light: a near-black directional lamp
 * renders the entire route near-black, on a near-black page, which reads as a
 * scene that failed to load. Illuminants therefore keep the world's hue and
 * take their luminance from the role, so sunlit and moonlit stay one route
 * under two lights rather than one route and one void.
 *
 * Themes extend this at runtime through `RouteThemeDefinition.paletteExtension`
 * (merged by the provider); theme code reads the merged object through its
 * own typed helper (plaza: `usePlazaPalette()`).
 */
export interface WorldPalette extends WorldTokens {
  /** Directional key color. Warm, near-white, hue borrowed from the accent. */
  keyLight: string;
  /** Hemisphere sky color. */
  skyLight: string;
  /** Hemisphere ground bounce — dimmer, and tinted by the actual ground. */
  bounce: string;
  /**
   * Overall light level, 0–1, inferred from how dark the world's ground is.
   *
   * This is what keeps moonlit from simply being sunlit with the lamps on:
   * the illuminants above are normalized to a fixed luminance so they stay
   * legible lights, so the day/night difference has to live in intensity.
   */
  exposure: number;
  /**
   * Canvas clear color / sky-dome zenith. Kept in the generic core because
   * the engine's `SkyClear` paints with it before any theme resolves; themes
   * may override it via their palette extension (plaza re-states the same
   * literals so one authored source owns them).
   */
  sky: string;
}

const TOKEN_FALLBACKS: WorldTokens = {
  ground: '#E8D9B5',
  surface: '#FFF8E9',
  elevated: '#FAEED6',
  ink: '#241A0C',
  accent: '#C05E0A',
  accentStrong: '#8F4206',
  focus: '#B54708',
  live: '#166534',
  border: '#E3D2AC',
};

const TOKEN_MAP: Record<keyof WorldTokens, string> = {
  ground: '--world-ground',
  surface: '--world-surface',
  elevated: '--world-elevated',
  ink: '--world-ink',
  accent: '--world-accent',
  accentStrong: '--world-accent-strong',
  focus: '--world-focus',
  live: '--world-live',
  border: '--world-border',
};

/** Luminance each illuminant is normalized to, as HSL lightness. */
const ILLUMINANT_LIGHTNESS = { key: 0.93, sky: 0.76, bounce: 0.34 } as const;

/** Parse `#rgb`, `#rrggbb` or `rgb()/rgba()` into 0–1 channels. */
export function parseColor(value: string): [number, number, number] | null {
  const text = value.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((c) => c + c)
            .join('')
        : hex[1];
    return [
      parseInt(digits.slice(0, 2), 16) / 255,
      parseInt(digits.slice(2, 4), 16) / 255,
      parseInt(digits.slice(4, 6), 16) / 255,
    ];
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length < 3) return null;
    const channels = parts.map((part) =>
      part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part) / 255,
    );
    return channels.some(Number.isNaN) ? null : [channels[0], channels[1], channels[2]];
  }

  return null;
}

function toHex(r: number, g: number, b: number): string {
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Re-expose a token color at a given lightness, keeping its hue and easing
 * saturation down as it brightens — a fully saturated "white" is a color cast,
 * not a light.
 */
function asIlluminant(value: string, lightness: number): string {
  const parsed = parseColor(value);
  if (!parsed) return toHex(lightness, lightness, lightness);

  const [r, g, b] = parsed;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return toHex(lightness, lightness, lightness);

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;

  // Saturation is capped so the brightest illuminants stay close to white.
  const saturation = Math.min(delta / (1 - Math.abs(2 * lightness - 1) || 1), 0.22);

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;

  const sextant = Math.floor(hue / 60) % 6;
  const rgb: [number, number, number] =
    sextant === 0 ? [c, x, 0]
    : sextant === 1 ? [x, c, 0]
    : sextant === 2 ? [0, c, x]
    : sextant === 3 ? [0, x, c]
    : sextant === 4 ? [x, 0, c]
    : [c, 0, x];

  return toHex(rgb[0] + m, rgb[1] + m, rgb[2] + m);
}

/** Perceived brightness of a color, 0–1. */
export function luminance(value: string): number {
  const parsed = parseColor(value);
  if (!parsed) return 1;
  return 0.2126 * parsed[0] + 0.7152 * parsed[1] + 0.0722 * parsed[2];
}

/** Exposure at the darkest ground the tokens can produce. */
const NIGHT_EXPOSURE = 0.45;

/**
 * Exposure below which the world reads as moonlit. The single day/night
 * switch: HDRI role, theme palette extensions and scene night branches all
 * key off this (previously duplicated as `< 0.75` across the plaza).
 */
export const NIGHT_EXPOSURE_THRESHOLD = 0.75;

/** The engine's day/night decision for a palette exposure. */
export function isNight(exposure: number): boolean {
  return exposure < NIGHT_EXPOSURE_THRESHOLD;
}

/** Attach the derived illuminants to a set of token colors. */
export function withIlluminants(tokens: WorldTokens): WorldPalette {
  const groundLuminance = luminance(tokens.ground);

  return {
    ...tokens,
    keyLight: asIlluminant(tokens.accent, ILLUMINANT_LIGHTNESS.key),
    skyLight: asIlluminant(tokens.surface, ILLUMINANT_LIGHTNESS.sky),
    bounce: asIlluminant(tokens.ground, ILLUMINANT_LIGHTNESS.bounce),
    exposure: NIGHT_EXPOSURE + (1 - NIGHT_EXPOSURE) * Math.sqrt(groundLuminance),
    sky: groundLuminance > 0.35 ? '#6eb4e0' : '#070433',
  };
}

/**
 * Sunlit fallback values, mirroring the token fallbacks in `globals.css`.
 * Used before the first read and if a token ever resolves empty — the scene
 * must never render with undefined colors.
 */
export const FALLBACK_PALETTE: WorldPalette = withIlluminants(TOKEN_FALLBACKS);

/**
 * Read the live core palette off a world element. Any token that resolves
 * empty falls back rather than producing an undefined `THREE.Color`.
 */
export function readWorldPalette(element: Element | null): WorldPalette {
  if (!element || typeof window === 'undefined') return FALLBACK_PALETTE;

  const styles = window.getComputedStyle(element);
  const tokens = {} as WorldTokens;

  for (const key of Object.keys(TOKEN_MAP) as (keyof WorldTokens)[]) {
    const value = styles.getPropertyValue(TOKEN_MAP[key]).trim();
    tokens[key] = value.length > 0 ? value : TOKEN_FALLBACKS[key];
  }

  return withIlluminants(tokens);
}

/**
 * Do two palettes describe the same light? Used to skip redundant updates.
 * Structural shallow compare so theme-extension keys (merged in by the
 * provider) participate without the engine knowing their names.
 */
export function samePalette(a: WorldPalette, b: WorldPalette): boolean {
  if (a === b) return true;
  const aRecord = a as unknown as Record<string, unknown>;
  const bRecord = b as unknown as Record<string, unknown>;
  const keys = Object.keys(aRecord);
  if (keys.length !== Object.keys(bRecord).length) return false;
  return keys.every((key) => aRecord[key] === bRecord[key]);
}
