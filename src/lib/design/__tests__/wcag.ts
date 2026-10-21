/**
 * Test-only WCAG 2.x contrast helpers (relative luminance in sRGB,
 * `(L1 + 0.05) / (L2 + 0.05)`), with alpha compositing for translucent
 * foregrounds and tints. Used by site-palettes.test.ts.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse `#rgb`, `#rrggbb`, `rgb(…)` or `rgba(…)` (comma or space separated). */
export function parseColor(input: string): Rgba {
  const c = input.trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fnMatch = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (fnMatch) {
    // Plain numbers only: `Number('75%')` is NaN, and a NaN channel makes every
    // `contrastRatio(...) < floor` check false, so a bad colour would pass.
    const p = fnMatch[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if ((p.length !== 3 && p.length !== 4) || !p.every(Number.isFinite)) {
      throw new Error(`unsupported colour: ${input}`);
    }
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  throw new Error(`unsupported colour: ${input}`);
}

function toHex({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Composite `fg` (may be translucent) over an opaque `bg`; returns opaque hex. */
export function over(fg: string, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (b.a !== 1) throw new Error(`background must be opaque: ${bg}`);
  const a = f.a;
  return toHex({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
}

/** `color` at `alpha` (what `bg-x/NN` paints), as an rgba() string. */
export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function luminance(color: string): number {
  const { r, g, b } = parseColor(color);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast of `fg` on opaque `bg`; a translucent `fg` is composited over `bg` first. */
export function contrastRatio(fg: string, bg: string): number {
  const solid = parseColor(fg).a < 1 ? over(fg, bg) : fg;
  const l1 = luminance(solid);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
